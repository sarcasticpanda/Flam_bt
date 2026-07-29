import { Children, isValidElement, useLayoutEffect, useRef, useState } from 'react';

/**
 * Stacks its children bottom-up in the bottom-left corner, each one measured and offset above
 * the ones below it.
 *
 * Three separate components (perf HUD, zoom controls, the call panel's idle "Join call"
 * buttons) all independently claimed `bottom-4 left-4` at the same z-index — a real collision
 * where the topmost one silently ate clicks meant for whatever was underneath. Hardcoding pixel
 * offsets between them is exactly how that kind of bug creeps back in the next time one panel's
 * height changes. This measures actual rendered height via ResizeObserver instead, so the stack
 * self-corrects regardless of what's currently visible or how tall it is.
 *
 * Children are rendered bottom-to-top in array order: index 0 sits flush with the corner.
 */
export function BottomLeftStack({ children }: { children: React.ReactNode }) {
  const items = Children.toArray(children).filter(isValidElement);
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const [offsets, setOffsets] = useState<number[]>(() => items.map(() => 0));

  useLayoutEffect(() => {
    const GAP = 8;
    const recompute = () => {
      let cursor = 16; // base inset from the viewport edge
      const next: number[] = [];
      for (const el of refs.current) {
        next.push(cursor);
        if (el && el.offsetHeight > 0) cursor += el.offsetHeight + GAP;
      }
      setOffsets(next);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    for (const el of refs.current) if (el) ro.observe(el);
    return () => ro.disconnect();
    // Re-measure whenever the child list or its rendered content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, children]);

  return (
    <>
      {items.map((child, i) => (
        <div
          key={child.key ?? i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="absolute left-4 z-40"
          style={{ bottom: offsets[i] ?? 16 }}
        >
          {child}
        </div>
      ))}
    </>
  );
}
