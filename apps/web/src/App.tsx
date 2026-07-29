import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine, seedShapes } from '@board/canvas-engine';
import { THEMES, type ThemeName } from '@board/shared';
import { CanvasView } from './canvas/CanvasView';
import { PerfHUD } from './components/PerfHUD';
import { ZoomControls } from './components/ZoomControls';
import { ThemeMenu } from './components/ThemeMenu';
import { DevSeeder } from './components/DevSeeder';

export default function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [hudVisible, setHudVisible] = useState(true);
  const [theme, setTheme] = useState<ThemeName>(
    () => (document.documentElement.dataset.theme as ThemeName) ?? 'paper',
  );
  const engineRef = useRef<Engine | null>(null);

  const handleReady = useCallback((e: Engine) => {
    engineRef.current = e;
    setEngine(e);

    // Dev handle for Playwright. The canvas is a bitmap — assertions cannot read the DOM, so
    // the test suite needs a way to inspect real board state. See docs/06-VERIFICATION.md.
    (window as unknown as { __board: unknown }).__board = {
      shapeCount: () => e.shapes.size,
      visibleCount: () => e.stats.visible,
      stats: () => ({ ...e.stats }),
      camera: () => e.camera.serialize(),
      shapeIds: () => [...e.shapes.keys()],
      seed: (n: number) => {
        e.setShapes(seedShapes({ count: n }));
        return e.shapes.size;
      },
      fitAll: () => {
        const b = e.index.totalBounds();
        if (b) e.camera.fitTo(b, e.width, e.height, 0);
        e.markDirty();
        return e.camera.serialize();
      },
      setZoom: (z: number) => {
        e.camera.zoom = z;
        e.markDirty();
        return e.camera.zoom;
      },
      /**
       * Synchronous cull+draw benchmark.
       *
       * Headless browsers throttle rAF to 1Hz, which makes end-to-end frame cadence useless as
       * a measure of engine cost. This times the actual work instead.
       */
      bench: (iterations: number) => {
        const times: number[] = [];
        for (let i = 0; i < iterations; i++) {
          // Nudge the camera so no frame can be trivially cached.
          e.camera.pan(1, 0.6);
          const t0 = performance.now();
          e.renderStaticNow();
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        const mean = times.reduce((a, b) => a + b, 0) / times.length;
        return {
          mean: +mean.toFixed(3),
          median: +times[Math.floor(times.length / 2)]!.toFixed(3),
          p95: +times[Math.floor(times.length * 0.95)]!.toFixed(3),
          worst: +times[times.length - 1]!.toFixed(3),
          impliedFps: Math.round(1000 / mean),
          visible: e.stats.visible,
          total: e.stats.total,
          culledPct: +e.stats.culledPct.toFixed(1),
          msCull: +e.stats.msCull.toFixed(3),
          msDraw: +e.stats.msDraw.toFixed(3),
        };
      },
    };
  }, []);

  const applyTheme = useCallback((next: ThemeName) => {
    document.documentElement.dataset.theme = next;
    localStorage.setItem('board:theme', next);
    setTheme(next);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(e.target.tagName));
      if (typing) return;

      if (e.key === '`') {
        e.preventDefault();
        setHudVisible((v) => !v);
      }
      // Cycle themes with T — the fastest way to eyeball all five during the design pass.
      if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey) {
        const i = THEMES.indexOf((document.documentElement.dataset.theme as ThemeName) ?? 'paper');
        applyTheme(THEMES[(i + 1) % THEMES.length]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyTheme]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <CanvasView onReady={handleReady} />

      <header className="pointer-events-none absolute top-4 right-4 z-40 flex items-center gap-2">
        <ThemeMenu theme={theme} onChange={applyTheme} />
      </header>

      <PerfHUD engine={engine} visible={hudVisible} />
      <ZoomControls engine={engine} hudVisible={hudVisible} />
      <DevSeeder engine={engine} />
    </div>
  );
}
