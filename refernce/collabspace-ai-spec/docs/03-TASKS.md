# 03 — Task List

Work top to bottom. Tick boxes as acceptance criteria pass. Each task ID is the commit prefix.

**Phase gates:** do not start a phase until the previous phase's gate passes. The gate is the
single sentence at the end of each phase — if you can't demo that sentence, the phase isn't done.

Legend: `[P0]` MVP · `[P1]` should-have · `[P2]` nice-to-have

---

## Phase 0 — Foundation (½ day)

- [ ] **P0-01** Init pnpm workspace: `apps/web`, `apps/server`, `packages/shared`, `packages/canvas-engine`
  - Root `package.json` with `dev`, `build`, `typecheck`, `lint`, `test` scripts running across workspaces
- [ ] **P0-02** Vite + React + TS strict in `apps/web`; Tailwind + shadcn/ui initialised
- [ ] **P0-03** Express + `ws` + Socket.IO in `apps/server`, TS, `tsx watch` dev script
- [ ] **P0-04** ESLint + Prettier + `vitest` configured at root, shared config
- [ ] **P0-05** `packages/shared`: `Shape` union, `ShapeType`, zod schemas, constants (palette, limits, room-code alphabet)
- [ ] **P0-06** `.env.example`, `docs/06-SETUP.md` verified accurate, `README.md` stub
- [ ] **P0-07** `docs/DECISIONS.md` and `docs/PROGRESS.md` created with headers

> **Gate:** `pnpm dev` starts both apps, client renders a blank page, server logs a listening port, `pnpm typecheck` is clean.

---

## Phase 1 — Canvas engine core (1.5 days) `[P0]`

- [ ] **P1-01** `Camera`: `screenToWorld`, `worldToScreen`, `pan`, `zoomAt(point, delta)`, `worldViewport()`, clamp 0.1–8
- [ ] **P1-02** `Engine`: three stacked canvases, DPR scaling, `ResizeObserver`, rAF loop with dirty flag
- [ ] **P1-03** `SpatialIndex` uniform grid (512 units) — `insert/remove/update/query/queryPoint` + **unit tests**
- [ ] **P1-04** `geometry.ts`: bounds, rotated bounds, rect intersection, point-in-shape, line-point distance + **unit tests**
- [ ] **P1-05** Renderers for `rect`, `ellipse`, `line`, `text` — pure `draw(ctx, shape, camera)`
- [ ] **P1-06** Pan (space+drag, middle-drag, trackpad) and zoom-to-cursor (ctrl+wheel, pinch)
- [ ] **P1-07** Dot/line grid background that scales with zoom and fades below 30%
- [ ] **P1-08** Dev perf HUD (fps, ms/frame, total shapes, visible shapes) toggled with `` ` ``
- [ ] **P1-09** **Dev seeder: "Generate N shapes" (1k / 10k / 50k)** with a realistic shape mix
- [ ] **P1-10** React bridge: `<Canvas />` mounts the engine, forwards pointer events, never re-renders on shape change

> **Gate:** seed 10,000 shapes, pan and zoom smoothly with the HUD showing ≥55fps and visible-shape count far below total.

---

## Phase 2 — Tools & interaction (2 days) `[P0]`

- [ ] **P2-01** Tool state-machine interface + `ToolManager` + toolbar UI with keyboard shortcuts (`V H P R O L A T N E`)
- [ ] **P2-02** `select` tool: click, shift+click, marquee, hover highlight
- [ ] **P2-03** Selection overlay: bounding box, 8 resize handles, rotate handle; multi-select shared box
- [ ] **P2-04** Move / resize / rotate, with shift-constrain and alt-from-centre
- [ ] **P2-05** `rect` / `ellipse` / `line` tools (drag to draw, shift to constrain)
- [ ] **P2-06** `arrow` tool with arrowheads + shape binding (endpoint follows bound shape)
- [ ] **P2-07** `pen` tool: coalesced pointer events → RDP simplification → Catmull-Rom→Bezier smoothing; renderer
- [ ] **P2-08** `highlighter` (multiply blend, fixed alpha) and `eraser` (object erase)
- [ ] **P2-09** `text` tool: inline on-canvas editing via a positioned contenteditable overlay, auto-width then wrap
- [ ] **P2-10** `sticky` tool: fixed size, 8 colours, auto-shrinking text, double-click to edit
- [ ] **P2-11** Snapping: edge/centre alignment guides between shapes, optional grid snap, ctrl to disable
- [ ] **P2-12** Style panel (contextual): stroke, fill, width, opacity, dash, font size, align; sets defaults when nothing selected
- [ ] **P2-13** Object ops: delete, duplicate (ctrl+D, alt-drag), copy/paste as clipboard JSON, z-order (fractional index)
- [ ] **P2-14** Arrow-key nudge (1px / 10px with shift)
- [ ] **P2-15** Zoom controls cluster + zoom-to-fit + zoom-to-selection
- [ ] **P2-16** `?` shortcuts overlay

> **Gate:** a person can build a real diagram — boxes, bound arrows, labels, sticky notes, styled and arranged — entirely with keyboard and mouse, no console errors.

---

## Phase 3 — Realtime collaboration (2 days) `[P0]`

- [ ] **P3-01** Yjs doc structure per `02-ARCHITECTURE.md` §5; accessor helpers in `packages/shared/ydoc.ts`
- [ ] **P3-02** `y-websocket` server handler with room routing; client provider with reconnect/backoff
- [ ] **P3-03** Bind engine ↔ Yjs: observe deep changes → update engine store + spatial index → mark dirty
- [ ] **P3-04** Wrap every mutation in `ydoc.transact(fn, origin)`; throttle drag writes to 30Hz with authoritative write on pointerup
- [ ] **P3-05** Room codes + landing page (New board / join by code) + `/b/:code` route + invalid-code error
- [ ] **P3-06** Identity: name prompt, colour assignment avoiding collisions, `localStorage` persistence
- [ ] **P3-07** Awareness: cursor at 30Hz, interpolated remote cursor rendering with name labels
- [ ] **P3-08** Presence avatar stack, click-to-jump, follow mode
- [ ] **P3-09** Remote selection indicators in peer colours `[P1]`
- [ ] **P3-10** Undo/redo with `Y.UndoManager` scoped to local user origin; compound ops as single transactions
- [ ] **P3-11** Server persistence: debounced snapshot to Postgres, load on cold room open
- [ ] **P3-12** Connection status banner: connected / reconnecting / offline-editing
- [ ] **P3-13** Board title editing, board metadata, thumbnail on save
- [ ] **P3-14** **Two-window test suite (manual checklist in `docs/TESTING.md`)** covering every §2 operation

> **Gate:** two windows, one board. Everything syncs under 200ms. Kill the network for 30s, keep drawing in both, reconnect — documents converge with nothing lost or duplicated. Undo in window A never touches window B's work.

---

## Phase 4 — Files & annotation (1 day) `[P0]`

- [ ] **P4-01** Upload route: multipart, MIME sniffing on bytes, 10MB/file + 100MB/board enforced server-side, Supabase Storage, signed URLs
- [ ] **P4-02** Image import: drag-drop, clipboard paste, toolbar; `image` shape with URL only; aspect-locked resize
- [ ] **P4-03** pdf.js integration as a lazy chunk; render pages to `OffscreenCanvas`
- [ ] **P4-04** `pdfPage` shapes laid out vertically with gaps; re-render at higher scale when zoomed in
- [ ] **P4-05** Annotation on top of PDF/image: any shape works, anchored in world space over the page
- [ ] **P4-06** Page thumbnail rail for navigation `[P1]`
- [ ] **P4-07** Loading + failure states for large files (progress bar, clear error naming the limit)
- [ ] **P4-08** PPTX → PDF server-side conversion, or a clear "export to PDF first" message `[P2]`

> **Gate:** drag a 20-page PDF onto the board, annotate page 7 in window A, see it live in window B, reload and it's still there.

---

## Phase 5 — AI features (2 days) `[P0]` — read `04-AI-SPEC.md` first

- [ ] **P5-01** Server AI module: provider client, prompt builders, zod output schemas, one retry on validation failure, 30s timeout
- [ ] **P5-02** Rate limiting (20/room/min, 60/user/hr) + input truncation at 12k chars
- [ ] **P5-03** `POST /api/ai/:feature` route with per-feature input validation
- [ ] **P5-04** AI command bar (`cmd/ctrl+K`) with feature list, free-text prompt, inline on-canvas progress
- [ ] **P5-05** Result application layer: find free canvas space via spatial index, insert as **one** transaction with `origin.source = 'ai'`, animate in
- [ ] **P5-06** **AI Brainstorm** → themed sticky notes in columns with header notes `[P0]`
- [ ] **P5-07** **AI Mind map** → radial tree, client-side radial layout, per-node "expand branch" `[P0]`
- [ ] **P5-08** **AI Diagram cleanup** → normalise selection geometry, animate to new positions over 300ms ease-out `[P0]`
- [ ] **P5-09** **AI Sticky clustering** → send `{id, text}` only, receive clusters + labels, animate into labelled frames, handles 50+ `[P0]`
- [ ] **P5-10** **AI Flowchart generator** → model returns graph structure, client computes layered layout `[P1]`
- [ ] **P5-11** **AI Meeting notes** → chat + activity log → summary/decisions/actions card, export markdown `[P1]`
- [ ] **P5-12** **AI Explain diagram** → side panel, paragraphs hover-linked to shapes `[P1]`
- [ ] **P5-13** **AI Code to diagram** → `@babel/parser` AST client-side, model labels/groups only `[P2]`
- [ ] **P5-14** AI failure UX everywhere: error text, retry button, never an infinite spinner

> **Gate:** the four P0 AI features work end to end on a real board, each undoable with one ctrl+Z, each visible to a collaborator in the other window.

---

## Phase 6 — Meetings (1.5 days) `[P1]`

- [ ] **P6-01** Socket.IO `/rtc` namespace: join, peer list, offer/answer/ice relay, leave, hard-cap 6
- [ ] **P6-02** `simple-peer` mesh with audio tracks; join/leave call
- [ ] **P6-03** Mute/unmute + speaking detection via `AudioContext` analyser; state on Yjs awareness
- [ ] **P6-04** Video tracks, draggable floating tiles, camera toggle, collapse to audio-only
- [ ] **P6-05** Screen share (`getDisplayMedia`), one sharer at a time `[P2]`
- [ ] **P6-06** Chat panel backed by `Y.Array`, unread badge, `@mentions` `[P1]`
- [ ] **P6-07** Raise hand `[P2]`
- [ ] **P6-08** Device permission denial and "no camera found" handled with real messages
- [ ] **P6-09** Warn above 4 peers that mesh will degrade; document the LiveKit upgrade path in the README

> **Gate:** two windows on the same board hold a working audio+video call while both continue editing the canvas, and both see mute state correctly.

---

## Phase 7 — History, comments, export (1 day)

- [ ] **P7-01** Named snapshots: save with label + author, list panel, read-only preview, restore-as-new-version `[P1]`
- [ ] **P7-02** Activity feed from Yjs events, human-readable, time-bucketed `[P1]`
- [ ] **P7-03** Canvas comments: pin anywhere or on a shape, threads, `@mentions`, resolve; pins scale inversely with zoom `[P1]`
- [ ] **P7-04** Export PNG (viewport / whole board, 1–3x, transparent toggle) `[P0]`
- [ ] **P7-05** Export JSON + import JSON round-trip `[P0]`
- [ ] **P7-06** Export SVG `[P1]`
- [ ] **P7-07** Export PDF, plus flattened annotated source PDF `[P1]`
- [ ] **P7-08** Share modal: copy edit link, copy view-only link; **view-only enforced server-side** `[P0]`
- [ ] **P7-09** Playback/time-travel over periodic snapshots `[P2]`
- [ ] **P7-10** Reactions, laser pointer, timer, dot voting `[P2]`

> **Gate:** export a board to JSON, wipe it, re-import — pixel-identical. A view-only link cannot mutate the document even with devtools open.

---

## Phase 8 — Polish, performance, delivery (1 day) `[P0]`

- [ ] **P8-01** Re-run the full perf checklist in `02-ARCHITECTURE.md` §9 against the 10k seeder; record real numbers
- [ ] **P8-02** LOD rendering at low zoom; verify memory < 400MB at 10k shapes
- [ ] **P8-03** Bundle audit: lazy chunks for pdf.js / WebRTC / AI / export; initial gzip < 350KB
- [ ] **P8-04** Empty states, loading skeletons, error boundaries, offline banner
- [ ] **P8-05** Keyboard nav + visible focus rings on all chrome; `prefers-reduced-motion` respected
- [ ] **P8-06** Touch: view/pan/zoom works on tablet and phone
- [ ] **P8-07** Design pass against `05-DESIGN-SYSTEM.md` — consistent spacing, type scale, motion
- [ ] **P8-08** Deploy: web to Vercel, server to Fly.io/Railway (**persistent, not serverless**), Supabase configured, env documented
- [ ] **P8-09** README: architecture diagram, the tldraw/Konva decision, spatial-index tradeoff, measured perf numbers, honest limitations (no TURN, room codes ≠ auth, canvas not screen-reader accessible)
- [ ] **P8-10** 60–90s demo GIF/video following the script in `00-BRIEF.md`
- [ ] **P8-11** Seed a public demo board with real content so the deployed link isn't blank
- [ ] **P8-12** `docs/PROGRESS.md` final pass: what shipped, what was cut and why

> **Gate:** a stranger opens the deployed link, joins the demo board from two devices, and understands what the product is within 15 seconds.

---

## Cut order if time runs out

Cut from the bottom up, in this order — and **write down that you cut them**, which reads as
judgement rather than as an unfinished project:

1. Playback, voting, timer, laser, reactions (P7-09, P7-10)
2. Code-to-diagram (P5-13), Explain diagram (P5-12)
3. Screen share (P6-05), raise hand (P6-07)
4. Video (P6-04) — keep audio
5. PPTX (P4-08)
6. SVG/PDF export (P7-06, P7-07) — keep PNG and JSON
7. Comments (P7-03), activity feed (P7-02)

**Never cut:** Phases 1–3 in full, PDF annotation, the four P0 AI features, PNG/JSON export,
the perf numbers, and the README.
