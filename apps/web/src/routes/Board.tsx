import { useCallback, useEffect, useRef, useState } from 'react';
import { seedShapes } from '@board/canvas-engine';
import { THEMES, type Shape, type ThemeName } from '@board/shared';
import { BoardCanvas, type BoardHandles } from '../canvas/BoardCanvas';
import { TextEditor } from '../canvas/TextEditor';
import { paintOverlay } from '../canvas/overlay';
import { Session, type ConnectionStatus, type Peer } from '../collab/Session';
import { loadIdentity } from '../collab/identity';
import { api, rememberBoard, wsUrl, type BoardMeta } from '../lib/api';
import { PerfHUD } from '../components/PerfHUD';
import { ZoomControls } from '../components/ZoomControls';
import { ThemeMenu } from '../components/ThemeMenu';
import { DevSeeder } from '../components/DevSeeder';
import { Toolbar } from '../components/Toolbar';
import { StylePanel } from '../components/StylePanel';
import { ShortcutsOverlay } from '../components/ShortcutsOverlay';
import { EmptyHint } from '../components/EmptyHint';
import { PresenceBar } from '../components/PresenceBar';
import type { StyleDefaults, ToolId } from '../canvas/tools/types';

export function Board({ code, onLeave }: { code: string; onLeave: () => void }) {
  const [handles, setHandles] = useState<BoardHandles | null>(null);
  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [peers, setPeers] = useState<Peer[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  const [hudVisible, setHudVisible] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [editing, setEditing] = useState<Shape | null>(null);
  const [theme, setTheme] = useState<ThemeName>(
    () => (document.documentElement.dataset.theme as ThemeName) ?? 'paper',
  );

  const [activeTool, setActiveTool] = useState<ToolId>('select');
  const [selectionCount, setSelectionCount] = useState(0);
  const [style, setStyle] = useState<StyleDefaults | null>(null);
  const [shapeCount, setShapeCount] = useState(0);

  const identityRef = useRef(loadIdentity());
  const sessionRef = useRef<Session | null>(null);

  // ---- load board metadata -------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    api
      .getBoard(code)
      .then((m) => {
        if (cancelled) return;
        setMeta(m);
        rememberBoard(m.code, m.title);
      })
      .catch(() => !cancelled && setLoadError(`No board with the code ${code}.`));
    return () => {
      cancelled = true;
    };
  }, [code]);

  // ---- open the session once the engine and metadata both exist ------------
  useEffect(() => {
    if (!handles || !meta) return;

    const session = new Session(
      handles.doc,
      handles.engine,
      meta.code,
      identityRef.current,
      meta.readOnly,
      wsUrl(),
    );
    sessionRef.current = session;

    session.onStatusChange = setStatus;
    session.onPeersChange = setPeers;

    // Remote cursors and selections live on the overlay canvas, so a peer's cursor moving at
    // 30Hz never forces the committed shapes to redraw.
    handles.engine.overlayPainter = (ctx, camera) =>
      paintOverlay(ctx, camera, handles.engine, session);
    handles.engine.markOverlayDirty();

    return () => {
      handles.engine.overlayPainter = null;
      session.destroy();
      sessionRef.current = null;
    };
  }, [handles, meta]);

  // ---- share the local selection over awareness ---------------------------
  useEffect(() => {
    sessionRef.current?.setSelection(handles?.tools.getSelection() ?? []);
  }, [handles, selectionCount]);

  const handleReady = useCallback((h: BoardHandles) => {
    setHandles(h);
    setStyle({ ...h.tools.style });

    h.tools.onChange = () => {
      setActiveTool(h.tools.activeToolId);
      setSelectionCount(h.tools.getSelection().length);
      setStyle({ ...h.tools.style });
    };
    h.doc.onShapeCount = setShapeCount;
    setShapeCount(h.engine.shapes.size);

    (window as unknown as { __board: unknown }).__board = {
      shapeCount: () => h.engine.shapes.size,
      visibleCount: () => h.engine.stats.visible,
      stats: () => ({ ...h.engine.stats }),
      camera: () => h.engine.camera.serialize(),
      shapeIds: () => [...h.engine.shapes.keys()],
      shapes: () => h.engine.allShapes(),
      selection: () => h.tools.getSelection(),
      peers: () => sessionRef.current?.getPeers().map((p) => p.state.name) ?? [],
      status: () => sessionRef.current?.status ?? 'none',
      setTool: (id: ToolId) => h.tools.setTool(id),
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
          impliedFps: Math.round(1000 / mean),
          visible: h.engine.stats.visible,
          total: h.engine.stats.total,
          culledPct: +h.engine.stats.culledPct.toFixed(1),
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
    handles?.engine.setEditing(editing?.id ?? null);
  }, [handles, editing]);

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
      if (e.key === 'T' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const i = THEMES.indexOf((document.documentElement.dataset.theme as ThemeName) ?? 'paper');
        applyTheme(THEMES[(i + 1) % THEMES.length]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyTheme]);

  if (loadError) {
    return (
      <div
        className="grid h-full w-full place-items-center px-6 text-center"
        style={{ background: 'var(--canvas-bg)', color: 'var(--canvas-ink)' }}
      >
        <div>
          <p style={{ fontSize: 16 }}>{loadError}</p>
          <button
            onClick={onLeave}
            className="mt-4 rounded-lg px-4 py-2"
            style={{ background: 'var(--canvas-ink)', color: 'var(--canvas-bg)', fontSize: 14 }}
          >
            Back to boards
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <BoardCanvas
        userId={identityRef.current.userId}
        onReady={handleReady}
        onEditText={setEditing}
        onCursor={(world) => sessionRef.current?.setCursor(world)}
        onCameraChange={() => sessionRef.current?.setCamera()}
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
        <PresenceBar
          session={sessionRef.current}
          peers={peers}
          status={status}
          code={meta?.code ?? code}
          title={meta?.title ?? ''}
          readOnly={meta?.readOnly ?? false}
          onLeave={onLeave}
          onRename={(title) => {
            setMeta((m) => (m ? { ...m, title } : m));
            api.setTitle(code, title).catch(() => {});
          }}
        />
        <ThemeMenu theme={theme} onChange={applyTheme} />
      </header>

      {style && !meta?.readOnly && (
        <StylePanel
          style={style}
          selectionCount={selectionCount}
          onChange={(patch) => handles?.tools.setStyle(patch)}
        />
      )}

      {!meta?.readOnly && (
        <Toolbar active={activeTool} onSelect={(id) => handles?.tools.setTool(id)} />
      )}

      {shapeCount === 0 && !meta?.readOnly && <EmptyHint />}

      <PerfHUD engine={handles?.engine ?? null} visible={hudVisible} />
      <ZoomControls engine={handles?.engine ?? null} hudVisible={hudVisible} />
      <DevSeeder engine={handles?.engine ?? null} doc={handles?.doc ?? null} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
