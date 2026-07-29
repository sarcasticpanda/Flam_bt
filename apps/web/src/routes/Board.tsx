import { useCallback, useEffect, useRef, useState } from 'react';
import { seedShapes } from '@board/canvas-engine';
import { THEMES, type Shape, type ThemeName } from '@board/shared';
import { BoardCanvas, type BoardHandles } from '../canvas/BoardCanvas';
import { TextEditor } from '../canvas/TextEditor';
import { paintOverlay } from '../canvas/overlay';
import { Session, type ConnectionStatus, type Peer } from '../collab/Session';
import { loadIdentity } from '../collab/identity';
import { api, getAuthToken, rememberBoard, wsUrl, type BoardMeta } from '../lib/api';
import { PerfHUD } from '../components/PerfHUD';
import { ZoomControls } from '../components/ZoomControls';
import { ThemeMenu } from '../components/ThemeMenu';
import { DevSeeder } from '../components/DevSeeder';
import { Toolbar } from '../components/Toolbar';
import { StylePanel } from '../components/StylePanel';
import { ShortcutsOverlay } from '../components/ShortcutsOverlay';
import { EmptyHint } from '../components/EmptyHint';
import { PresenceBar } from '../components/PresenceBar';
import { CommandBar } from '../components/CommandBar';
import { CallPanel, CallJoinButtons } from '../components/CallPanel';
import { BottomLeftStack } from '../components/BottomLeftStack';
import { ChatPanel } from '../components/ChatPanel';
import { CallManager, type CallParticipant } from '../features/call/CallManager';
import { runAIFeature } from '../features/ai/run';
import { findFreeSpace } from '../features/ai/layout';
import { TemplateGallery } from '../components/TemplateGallery';
import { BoardMenu } from '../components/BoardMenu';
import type { TemplateDef } from '../features/templates/templates';
import { exportJSON, exportPNG, importJSON } from '../features/export/exportBoard';
import type { AIFeatureId } from '@board/shared';
import type { StyleDefaults, ToolId } from '../canvas/tools/types';

export function Board({ code, onLeave }: { code: string; onLeave: () => void }) {
  const [handles, setHandles] = useState<BoardHandles | null>(null);
  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [peers, setPeers] = useState<Peer[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  const [hudVisible, setHudVisible] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
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

  const callRef = useRef<CallManager | null>(null);
  const [callParticipants, setCallParticipants] = useState<CallParticipant[]>([]);
  const [callVersion, setCallVersion] = useState(0);

  const [timeLeft, setTimeLeft] = useState(900); // 15 minutes in seconds

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
      getAuthToken() ?? '',
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

  const handleRunAI = useCallback(
    async (feature: AIFeatureId, prompt: string) => {
      if (!handles || !meta) return;
      setAiBusy(true);
      setAiError(null);
      setAiStatus('Thinking…');

      const result = await runAIFeature(feature, prompt, {
        doc: handles.doc,
        engine: handles.engine,
        room: meta.code,
        userId: identityRef.current.userId,
        selection: handles.tools.getSelection(),
      });

      setAiBusy(false);
      if (!result.ok) {
        setAiError(result.message);
        setAiStatus(null);
        return;
      }

      // Name the provider. When the answer came from the offline `demo` generator that must be
      // visible — presenting it as a live model result would be dishonest.
      const via = result.provider === 'demo' ? 'Demo mode (no live model)' : `via ${result.provider}`;
      setAiStatus(`${result.message}  ·  ${via}${result.cached ? ' · cached' : ` · ${result.ms}ms`}`);
      setAiError(null);
      // Close on success so the result is visible; failures keep the bar open to retry.
      setTimeout(() => setAiOpen(false), 900);
    },
    [handles, meta],
  );

  const handleInsertTemplate = useCallback(
    (t: TemplateDef) => {
      if (!handles) return;
      const origin = findFreeSpace(handles.engine, t.size.w, t.size.h);
      const zs = handles.doc.nextZ(48);
      const shapes = t.build(origin, (i) => zs[i] ?? `t${i}`, identityRef.current.userId);

      // One transaction: a template inserts and undoes as a single step.
      handles.doc.addMany(shapes);
      handles.engine.camera.fitTo(
        { x: origin.x, y: origin.y, w: t.size.w, h: t.size.h },
        handles.engine.width,
        handles.engine.height,
        100,
      );
      handles.engine.markDirty();
      setTemplatesOpen(false);
    },
    [handles],
  );

  const handleJoinCall = useCallback(
    (withVideo: boolean) => {
      if (!meta) return;
      if (!callRef.current) {
        const call = new CallManager(meta.code, identityRef.current, getAuthToken() ?? '');
        call.onChange = () => {
          setCallParticipants(call.getParticipants());
          setCallVersion((v) => v + 1);
        };
        // Media state travels on Yjs awareness, NOT the peer connection — one source of truth
        // for presence, and it survives a failed peer connection.
        call.onLocalMedia = (m) => sessionRef.current?.setMedia({ ...m, inCall: true });
        callRef.current = call;
      }
      void callRef.current.join(withVideo);
    },
    [meta],
  );

  const handleLeaveCall = useCallback(() => {
    callRef.current?.leave();
    sessionRef.current?.setMedia({ inCall: false, muted: true, cameraOn: false, isSpeaking: false });
    setCallParticipants([]);
    setCallVersion((v) => v + 1);
  }, []);

  // Leaving the board or closing the tab must tear the call down, or the mic stays live and
  // peers keep a ghost tile.
  useEffect(() => {
    return () => callRef.current?.leave();
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
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setAiOpen((v) => !v);
        setAiError(null);
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

  if (timeLeft === 0) {
    return (
      <div
        className="grid h-full w-full place-items-center px-6 text-center"
        style={{ background: 'var(--canvas-bg)', color: 'var(--canvas-ink)', position: 'absolute', zIndex: 9999 }}
      >
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 'bold' }}>Session Expired</h2>
          <p style={{ fontSize: 16, marginTop: 8 }}>Your 15-minute session has ended.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 rounded-lg px-6 py-3"
            style={{ background: 'var(--canvas-ink)', color: 'var(--canvas-bg)', fontSize: 16, fontWeight: 'bold' }}
          >
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

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
        <BoardMenu
          disabled={meta?.readOnly}
          onTemplates={() => setTemplatesOpen(true)}
          onAI={() => setAiOpen(true)}
          onExportPNG={(scale, transparent) => {
            if (!handles) return;
            try {
              exportPNG(handles.engine, { scale, transparent });
            } catch (err) {
              setAiError(err instanceof Error ? err.message : 'Export failed.');
              setAiOpen(true);
            }
          }}
          onExportJSON={() => handles && exportJSON(handles.doc, meta?.title ?? 'board')}
          onImportJSON={async (file) => {
            if (!handles) return;
            try {
              const n = await importJSON(handles.doc, file);
              setAiStatus(`Imported ${n} shapes.`);
            } catch (err) {
              setAiError(err instanceof Error ? err.message : 'Import failed.');
              setAiOpen(true);
            }
          }}
        />
        <div className="flex items-center justify-center rounded-full bg-red-500/10 px-3 py-1 text-sm font-semibold text-red-500 ring-1 ring-red-500/20">
          Session Ends: {formatTime(timeLeft)}
        </div>
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

      <TemplateGallery
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onInsert={handleInsertTemplate}
      />

      <CommandBar
        open={aiOpen}
        busy={aiBusy}
        error={aiError}
        status={aiStatus}
        selectionCount={selectionCount}
        onClose={() => setAiOpen(false)}
        onRun={handleRunAI}
      />

      {/* The in-call floating tile panel is independently draggable, so it stays outside the
          fixed corner stack below — only its idle "Join call" buttons live in the stack. */}
      {!meta?.readOnly && (
        <CallPanel
          call={callRef.current}
          participants={callParticipants}
          colorFor={(i) => sessionRef.current?.colorFor(i) ?? '#888'}
          onLeave={handleLeaveCall}
          version={callVersion}
        />
      )}

      {/*
        Every panel that anchors to the bottom-left corner goes through ONE stack so they can
        never silently overlap and eat each other's clicks — which is exactly what happened when
        the perf HUD, zoom controls, and the call join buttons each independently claimed
        `bottom-4 left-4`. Order here is bottom-to-top: index 0 sits flush with the corner.
      */}
      <BottomLeftStack>
        <PerfHUD engine={handles?.engine ?? null} visible={hudVisible} />
        <ZoomControls engine={handles?.engine ?? null} />
        {!meta?.readOnly && <CallJoinButtons call={callRef.current} onJoin={handleJoinCall} />}
      </BottomLeftStack>

      <DevSeeder engine={handles?.engine ?? null} doc={handles?.doc ?? null} />
      <ChatPanel doc={handles?.doc ?? null} identity={identityRef.current} readOnly={meta?.readOnly ?? false} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
