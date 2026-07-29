import { useEffect, useRef } from 'react';
import { Engine } from '@board/canvas-engine';
import type { Shape } from '@board/shared';
import { BoardDoc } from '../collab/BoardDoc';
import { ToolManager } from './tools/ToolManager';
import { TOOL_SHORTCUTS, type CanvasPointerEvent } from './tools/types';

export interface BoardHandles {
  engine: Engine;
  doc: BoardDoc;
  tools: ToolManager;
}

interface Props {
  userId: string;
  onReady: (h: BoardHandles) => void;
  onEditText: (shape: Shape) => void;
}

/**
 * Mounts the engine, the document, and the tool manager, and owns all canvas input.
 *
 * Renders ONE empty div and never re-renders when shapes change. Chrome subscribes to the tool
 * manager separately. Putting shape state in React here would re-run reconciliation on every
 * pointer move — see CLAUDE.md rule 3.
 */
export function BoardCanvas({ userId, onReady, onEditText }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const engine = new Engine(container);
    const doc = new BoardDoc(userId);
    doc.bindToEngine(engine);
    const tools = new ToolManager(engine, doc, userId);
    tools.onEditText = onEditText;

    engine.refreshTheme();
    engine.start();
    onReady({ engine, doc, tools });

    // -----------------------------------------------------------------------
    // Input. Pointer Events only — no mouse/touch duplication, stylus works free.
    // -----------------------------------------------------------------------

    let spaceHeld = false;
    let panning = false;
    let panLast = { x: 0, y: 0 };
    let lastPointer = { x: 0, y: 0 };

    const toCanvasEvent = (e: PointerEvent): CanvasPointerEvent => {
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      return {
        world: engine.camera.screenToWorld(sx, sy),
        screen: { x: sx, y: sy },
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        button: e.button,
        pointerId: e.pointerId,
        native: e,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      container.setPointerCapture(e.pointerId);
      // Space+drag and middle-drag pan from ANY tool. Losing pan while drawing is maddening.
      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        panning = true;
        panLast = { x: e.clientX, y: e.clientY };
        engine.setInteracting(true);
        e.preventDefault();
        return;
      }
      tools.pointerDown(toCanvasEvent(e));
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      lastPointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (panning) {
        engine.camera.pan(e.clientX - panLast.x, e.clientY - panLast.y);
        panLast = { x: e.clientX, y: e.clientY };
        engine.markDirty();
        engine.markOverlayDirty();
        return;
      }
      tools.pointerMove(toCanvasEvent(e));
      container.style.cursor = spaceHeld ? 'grab' : tools.cursor;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
      if (panning) {
        panning = false;
        engine.setInteracting(false);
        return;
      }
      tools.pointerUp(toCanvasEvent(e));
    };

    const onDoubleClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      tools.doubleClick({
        world: engine.camera.screenToWorld(sx, sy),
        screen: { x: sx, y: sy },
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        button: 0,
        pointerId: 0,
        native: e as unknown as PointerEvent,
      });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as a wheel event with ctrlKey set — same path as mouse zoom.
        engine.camera.zoomAt(sx, sy, Math.exp(-e.deltaY * 0.01));
      } else {
        engine.camera.pan(-e.deltaX, -e.deltaY);
      }
      engine.markDirty();
      engine.markOverlayDirty();
    };

    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName));

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;

      if (e.code === 'Space' && !spaceHeld) {
        spaceHeld = true;
        container.style.cursor = 'grab';
        e.preventDefault();
        return;
      }

      if (e.key === 'Escape') {
        tools.cancel();
        tools.setSelection([]);
        return;
      }

      if (mod) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            // Undo is scoped to this user's own origin — it can never revert a collaborator.
            if (e.shiftKey) doc.undoManager.redo();
            else doc.undoManager.undo();
            return;
          case 'y':
            e.preventDefault();
            doc.undoManager.redo();
            return;
          case 'd':
            e.preventDefault();
            tools.duplicateSelection();
            return;
          case 'c':
            tools.copySelection();
            return;
          case 'v':
            tools.paste(engine.camera.screenToWorld(lastPointer.x, lastPointer.y));
            return;
          case 'a':
            e.preventDefault();
            tools.selectAll();
            return;
          case ']':
            e.preventDefault();
            tools.bringToFront();
            return;
          case '[':
            e.preventDefault();
            tools.sendToBack();
            return;
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        tools.deleteSelection();
        return;
      }

      // Arrow-key nudge: 1px, or 10px with shift.
      const step = e.shiftKey ? 10 : 1;
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const nudge = nudges[e.key];
      if (nudge) {
        e.preventDefault();
        tools.nudge(nudge[0], nudge[1]);
        return;
      }

      const toolId = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (toolId) {
        e.preventDefault();
        tools.setTool(toolId);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld = false;
        container.style.cursor = tools.cursor;
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('dblclick', onDoubleClick);
    container.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Theme switches flip CSS variables; the engine caches resolved colours and needs a nudge.
    const themeObserver = new MutationObserver(() => engine.refreshTheme());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      themeObserver.disconnect();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('dblclick', onDoubleClick);
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      doc.destroy();
      engine.destroy();
    };
    // Mount-only: re-creating the engine on every render would defeat the entire design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ touchAction: 'none', background: 'var(--canvas-bg)' }}
    />
  );
}
