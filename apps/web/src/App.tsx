import { useCallback, useEffect, useRef, useState } from 'react';
import { seedShapes } from '@board/canvas-engine';
import { THEMES, newShapeId, type Shape, type ThemeName } from '@board/shared';
import { BoardCanvas, type BoardHandles } from './canvas/BoardCanvas';
import { TextEditor } from './canvas/TextEditor';
import { PerfHUD } from './components/PerfHUD';
import { ZoomControls } from './components/ZoomControls';
import { ThemeMenu } from './components/ThemeMenu';
import { DevSeeder } from './components/DevSeeder';
import { Toolbar } from './components/Toolbar';
import { StylePanel } from './components/StylePanel';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { EmptyHint } from './components/EmptyHint';
import type { StyleDefaults, ToolId } from './canvas/tools/types';

/** Stable per-browser identity. Block C replaces the name with a real prompt. */
function getUserId(): string {
  let id = localStorage.getItem('board:userId');
  if (!id) {
    id = newShapeId();
    localStorage.setItem('board:userId', id);
  }
  return id;
}

export default function App() {
  const [handles, setHandles] = useState<BoardHandles | null>(null);
  const [hudVisible, setHudVisible] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [editing, setEditing] = useState<Shape | null>(null);
  const [theme, setTheme] = useState<ThemeName>(
    () => (document.documentElement.dataset.theme as ThemeName) ?? 'paper',
  );

  // Chrome state mirrored out of the tool manager. This is the ONLY thing React re-renders for
  // — never shape data.
  const [activeTool, setActiveTool] = useState<ToolId>('select');
  const [selectionCount, setSelectionCount] = useState(0);
  const [style, setStyle] = useState<StyleDefaults | null>(null);
  const [shapeCount, setShapeCount] = useState(0);

  const userIdRef = useRef(getUserId());

  const handleReady = useCallback((h: BoardHandles) => {
    setHandles(h);
    setStyle({ ...h.tools.style });

    h.tools.onChange = () => {
      setActiveTool(h.tools.activeToolId);
      setSelectionCount(h.tools.getSelection().length);
      setStyle({ ...h.tools.style });
    };

    // The empty-state hint needs to know when the first shape lands.
    h.doc.shapesMap.observe(() => setShapeCount(h.engine.shapes.size));

    (window as unknown as { __board: unknown }).__board = {
      shapeCount: () => h.engine.shapes.size,
      visibleCount: () => h.engine.stats.visible,
      stats: () => ({ ...h.engine.stats }),
      camera: () => h.engine.camera.serialize(),
      shapeIds: () => [...h.engine.shapes.keys()],
      shapes: () => h.engine.allShapes(),
      selection: () => h.tools.getSelection(),
      setTool: (id: ToolId) => h.tools.setTool(id),
      // Exposed so the e2e suite can drive the real style API rather than reaching into React.
      setStyle: (patch: Partial<StyleDefaults>) => h.tools.setStyle(patch),
      style: () => ({ ...h.tools.style }),
      undo: () => h.doc.undoManager.undo(),
      redo: () => h.doc.undoManager.redo(),
      seed: (n: number) => {
        h.doc.loadJSON(seedShapes({ count: n }));
        return h.engine.shapes.size;
      },
      clear: () => h.doc.loadJSON([]),
      fitAll: () => {
        const b = h.engine.index.totalBounds();
        if (b) h.engine.camera.fitTo(b, h.engine.width, h.engine.height, 0);
        h.engine.markDirty();
        return h.engine.camera.serialize();
      },
      setZoom: (z: number) => {
        h.engine.camera.zoom = z;
        h.engine.markDirty();
        return h.engine.camera.zoom;
      },
      bench: (iterations: number) => {
        const times: number[] = [];
        for (let i = 0; i < iterations; i++) {
          h.engine.camera.pan(1, 0.6);
          const t0 = performance.now();
          h.engine.renderStaticNow();
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        const mean = times.reduce((a, b) => a + b, 0) / times.length;
        return {
          mean: +mean.toFixed(3),
          p95: +times[Math.floor(times.length * 0.95)]!.toFixed(3),
          impliedFps: Math.round(1000 / mean),
          visible: h.engine.stats.visible,
          total: h.engine.stats.total,
          culledPct: +h.engine.stats.culledPct.toFixed(1),
          msCull: +h.engine.stats.msCull.toFixed(3),
          msDraw: +h.engine.stats.msDraw.toFixed(3),
        };
      },
    };
  }, []);

  const handleEditText = useCallback((shape: Shape) => setEditing(shape), []);

  useEffect(() => {
    handles?.engine.setEditing(editing?.id ?? null);
  }, [handles, editing]);

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
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
      // Shift+T cycles themes — the fastest way to eyeball all five during a design pass.
      if (e.key === 'T' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const i = THEMES.indexOf((document.documentElement.dataset.theme as ThemeName) ?? 'paper');
        applyTheme(THEMES[(i + 1) % THEMES.length]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyTheme]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <BoardCanvas
        userId={userIdRef.current}
        onReady={handleReady}
        onEditText={handleEditText}
      />

      {handles && editing && (
        <TextEditor
          engine={handles.engine}
          shape={editing}
          onCommit={(text) => {
            handles.tools.commitText(editing.id, text);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <header className="pointer-events-none absolute top-4 right-4 z-40 flex items-center gap-2">
        <ThemeMenu theme={theme} onChange={applyTheme} />
      </header>

      {style && (
        <StylePanel
          style={style}
          selectionCount={selectionCount}
          onChange={(patch) => handles?.tools.setStyle(patch)}
        />
      )}

      <Toolbar active={activeTool} onSelect={(id) => handles?.tools.setTool(id)} />

      {shapeCount === 0 && <EmptyHint />}

      <PerfHUD engine={handles?.engine ?? null} visible={hudVisible} />
      <ZoomControls engine={handles?.engine ?? null} hudVisible={hudVisible} />
      <DevSeeder engine={handles?.engine ?? null} doc={handles?.doc ?? null} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
