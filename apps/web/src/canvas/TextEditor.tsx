import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Engine } from '@board/canvas-engine';
import type { Shape } from '@board/shared';

/**
 * Inline on-canvas text editing.
 *
 * A positioned contenteditable overlaid exactly on the shape — NOT a modal and NOT a sidebar
 * input. Editing text somewhere other than where the text lives breaks the direct-manipulation
 * feel that makes a canvas tool worth using.
 *
 * The overlay mirrors the shape's font size and position through the camera transform, so what
 * you type is already laid out the way it will render once committed.
 */
export function TextEditor({
  engine,
  shape,
  onCommit,
  onCancel,
}: {
  engine: Engine;
  shape: Shape;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const committed = useRef(false);

  const initial = 'text' in shape ? (shape.text as string) : '';

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = initial;
    el.focus();

    // Place the caret at the end rather than the start — you are almost always appending.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Mount-only: re-running would fight the user's caret on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The overlay is positioned in SCREEN space, so it must follow pan and zoom.
  useEffect(() => {
    let raf = 0;
    const track = () => {
      force((n) => n + 1);
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    return () => cancelAnimationFrame(raf);
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit(ref.current?.textContent ?? '');
  };

  /**
   * Commit when the pointer goes down anywhere outside the editor.
   *
   * `onBlur` alone is not enough: the canvas container is a plain div with no tabindex, so
   * clicking it never moves focus and never fires blur. The editor would stay open and the
   * typed text would be silently discarded — you type a sticky note, click away, and lose it.
   */
  useEffect(() => {
    const onDownOutside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) commit();
    };
    // Capture phase, so this runs before the canvas tool handles the same pointerdown and
    // possibly starts a new shape.
    document.addEventListener('pointerdown', onDownOutside, true);
    return () => document.removeEventListener('pointerdown', onDownOutside, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { camera } = engine;
  const topLeft = camera.worldToScreen(shape.x, shape.y);
  const fontSize =
    ('fontSize' in shape ? (shape.fontSize as number) : 16) * camera.zoom;

  const isSticky = shape.type === 'sticky';
  const padding = isSticky ? 12 * camera.zoom : 0;

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Edit shape text"
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation(); // keep canvas shortcuts from firing while typing
        if (e.key === 'Escape') {
          e.preventDefault();
          committed.current = true;
          onCancel();
        }
        // Enter commits; shift+Enter makes a new line. Matches every sticky-note tool.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commit();
        }
      }}
      style={{
        position: 'absolute',
        left: topLeft.x + padding,
        top: topLeft.y + padding,
        width: shape.w * camera.zoom - padding * 2,
        minHeight: fontSize * 1.35,
        maxHeight: shape.h * camera.zoom - padding * 2,
        fontSize,
        lineHeight: 1.3,
        fontFamily: '"Geist Sans", system-ui, sans-serif',
        color: isSticky ? '#14161A' : 'var(--canvas-ink)',
        textAlign: shape.type === 'text' ? (shape.align as CanvasTextAlign) : 'center',
        background: 'transparent',
        border: 'none',
        outline: '2px solid var(--canvas-ink)',
        outlineOffset: 2,
        borderRadius: 2,
        overflow: 'hidden',
        zIndex: 50,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        caretColor: isSticky ? '#14161A' : 'var(--canvas-ink)',
      }}
    />
  );
}
