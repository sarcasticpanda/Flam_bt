import { useEffect, useRef } from 'react';
import { Engine } from '@board/canvas-engine';

interface Props {
  onReady: (engine: Engine) => void;
}

/**
 * The React <-> engine bridge.
 *
 * This component renders ONE empty div and never re-renders when shapes change. That is the
 * whole point: React owns chrome, the engine owns the canvas. Putting shape state in React
 * state would re-run reconciliation on every pointer move at 10k shapes.
 *
 * See CLAUDE.md rule 3.
 */
export function CanvasView({ onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const engine = new Engine(container);
    engineRef.current = engine;
    engine.refreshTheme();
    engine.start();
    onReady(engine);

    // ---------------------------------------------------------------------
    // Input. Pointer Events only — no mouse/touch duplication, and stylus works free.
    // ---------------------------------------------------------------------

    let spaceHeld = false;
    let panning = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      // Middle mouse, or space+drag: the two universal pan gestures.
      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        panning = true;
        lastX = e.clientX;
        lastY = e.clientY;
        container.setPointerCapture(e.pointerId);
        engine.setInteracting(true);
        e.preventDefault();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return;
      engine.camera.pan(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
      engine.markDirty();
      engine.markOverlayDirty();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!panning) return;
      panning = false;
      engine.setInteracting(false);
      if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (e.ctrlKey || e.metaKey) {
        // ctrl+wheel is zoom on a mouse AND pinch on a trackpad — the browser reports
        // trackpad pinch as a wheel event with ctrlKey set.
        engine.camera.zoomAt(sx, sy, Math.exp(-e.deltaY * 0.01));
      } else {
        // Bare two-finger scroll pans, matching every other canvas tool.
        engine.camera.pan(-e.deltaX, -e.deltaY);
      }
      engine.markDirty();
      engine.markOverlayDirty();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceHeld) {
        spaceHeld = true;
        container.style.cursor = 'grab';
        // Stop the page scrolling under us while space is held.
        if (e.target === document.body) e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld = false;
        container.style.cursor = '';
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Theme switches flip CSS variables; the engine caches resolved colours, so it needs a nudge.
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
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      engine.destroy();
      engineRef.current = null;
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
