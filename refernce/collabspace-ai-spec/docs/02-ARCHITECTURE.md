# 02 — Architecture

## 1. Stack decisions (and why)

| Layer | Choice | Reasoning |
|---|---|---|
| Build | **pnpm workspaces + Vite + TypeScript (strict)** | Monorepo keeps shared types honest between client and server. |
| UI | **React 18 + Tailwind + shadcn/ui + Radix** | Chrome only. Fast, accessible primitives, no design bikeshedding. |
| Canvas | **Custom engine on Canvas 2D** | ⚠️ Deliberate. See §2. |
| Realtime | **Yjs + y-websocket (custom server)** | CRDT, offline-tolerant, awareness API for cursors is free. |
| Transport (calls/signaling) | **Socket.IO** on the same server, separate namespace | Rooms, reconnection, and broadcast semantics out of the box. |
| Media | **WebRTC mesh via `simple-peer`** | ≤6 peers. LiveKit is the documented upgrade path, not the MVP. |
| Storage | **Supabase** (Postgres + Storage) | Board rows, snapshots, uploaded files, optional auth. |
| AI | **Anthropic Claude via a server proxy** | Structured tool-use output; keys never reach the client. |
| PDF | **pdf.js** | Only real option. |
| Export | `canvas.toBlob`, custom SVG serializer, `jsPDF` | — |
| Deploy | Vercel (web) + Fly.io/Railway (server) | Server must be stateful & long-lived for websockets — **not** serverless. |

### 2. The canvas decision — read this before writing code

**Do not use tldraw SDK.** It is excellent and would give us 70% of the PRD in a weekend — which
is exactly the problem. The graded and interview-relevant parts of this project are the spatial
index, viewport culling, dirty-rect rendering, hit testing, and the CRDT shape schema. Adopting
tldraw means the honest answer to "what did you build?" is "the toolbar."

We build a small custom engine on **Canvas 2D**. Not WebGL — Canvas 2D comfortably reaches the
10k-shape target with culling, text rendering is dramatically easier, and WebGL complexity here
buys nothing we need.

**Fallback trigger:** if the engine is not stable by end of Phase 2 (day ~5), switch to
Konva.js for the scene graph and keep our own spatial index and sync layer on top. Log that
switch in `DECISIONS.md`. Do not switch to tldraw — it swallows the whole architecture.

---

## 3. Package layout

```
packages/shared/          # zero deps, imported by both apps
  shape.ts                # Shape union type + type guards
  schema.ts               # zod validators (also used for AI output validation)
  ydoc.ts                 # Yjs doc structure constants + accessor helpers
  constants.ts            # palettes, limits, room-code alphabet
  events.ts               # socket event names + payload types

packages/canvas-engine/   # no React, no Yjs — pure and testable
  Engine.ts               # rAF loop, layer orchestration, dirty tracking
  Camera.ts               # pan/zoom, screen<->world transforms
  SpatialIndex.ts         # uniform grid (see §7)
  renderers/              # one module per shape type: draw(ctx, shape, camera)
  hit.ts                  # point/rect hit testing per shape type
  geometry.ts             # bounds, transforms, intersections, arrow routing
  smoothing.ts            # RDP simplification + Catmull-Rom to Bezier
  __tests__/              # vitest — geometry and index are pure, test them

apps/web/
  src/
    canvas/               # React <-> engine bridge, tools, input handling
      tools/              # one state machine per tool
    collab/               # Yjs provider, awareness, undo manager
    features/             # ai/, files/, meeting/, history/, export/, comments/
    components/           # toolbar, panels, modals, chrome
    hooks/  lib/  routes/

apps/server/
  src/
    ws/yjs.ts             # y-websocket handler + persistence hooks
    ws/signaling.ts       # Socket.IO namespace for WebRTC
    routes/ai.ts          # POST /api/ai/:feature — validated, rate-limited
    routes/files.ts       # upload, limits, signed URLs
    routes/boards.ts      # CRUD, snapshots, share modes
    ai/                   # prompt builders + zod schemas + providers
```

---

## 4. Shape model

One flat union type. Every shape has a common base; the discriminant is `type`.

```ts
type ShapeId = string;                    // nanoid(12)

interface BaseShape {
  id: ShapeId;
  type: ShapeType;
  x: number;                              // world coords, top-left of unrotated bounds
  y: number;
  w: number;
  h: number;
  rotation: number;                       // radians
  z: number;                              // fractional index, see §5
  parentId: ShapeId | null;               // for frames/groups
  locked: boolean;
  opacity: number;                        // 0..1
  createdBy: string;                      // userId
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, unknown>;         // AI provenance, source page ref, etc.
}
```

Type-specific `props`:

| type | props |
|---|---|
| `rect` `ellipse` | `stroke, fill, strokeWidth, dash, radius?, text?, textAlign` |
| `line` `arrow` | `points: [x,y][]` (relative to x,y), `stroke, strokeWidth, dash, arrowheads: [bool,bool], bindings: {start?: ShapeId, end?: ShapeId}, label?` |
| `draw` (pen/highlighter) | `points: [x,y][]`, `stroke, strokeWidth, blend: 'normal'\|'multiply'` |
| `text` | `text, fontSize, fontFamily, color, align, autoWidth: boolean` |
| `sticky` | `text, color, tags: string[], checklist?: {done:boolean,text:string}[], reactions: Record<emoji, userId[]>` |
| `image` | `url, naturalW, naturalH, crop?` |
| `pdfPage` | `fileId, pageIndex, renderScale` |
| `frame` | `name, color, clipsContent: boolean` |
| `aiCard` | `kind: 'notes'\|'explain', markdown: string` |

Rules:
- **Never store binary in a shape.** Images and PDFs store a `url`/`fileId` only.
- `points` arrays are relative to the shape origin so a move is a two-field update, not an
  N-point rewrite. This matters enormously for CRDT payload size on pen strokes.

---

## 5. Yjs document structure

```
Y.Doc
├── shapes    : Y.Map<ShapeId, Y.Map<field, value>>   // per-shape map = field-level merging
├── bindings  : Y.Map<ShapeId, {start?, end?}>        // arrow bindings, separated to avoid churn
├── meta      : Y.Map                                  // title, background, gridMode, createdAt
├── chat      : Y.Array<ChatMessage>
├── comments  : Y.Map<CommentId, Y.Map>
└── assets    : Y.Map<FileId, {name, mime, size, url, pages?}>

awareness (ephemeral, never persisted)
└── { userId, name, color, cursor: {x,y} | null, selection: ShapeId[], camera, following, hand, isSpeaking }
```

**Why `Y.Map` per shape and not a `Y.Array` of shapes:** two users editing different properties
of the same shape merge cleanly at field level, and a shape update is O(1) rather than an array
splice. The cost is losing implicit ordering — hence:

**Z-ordering via fractional indexing.** `z` is a fractional-index string (`fractional-indexing`
package), not a number. Inserting between two shapes never requires renumbering others, which
would otherwise be a full-document write and a merge nightmare. Sort by `z` at render time.

**Transactions.** Every logical operation wraps in `ydoc.transact(fn, origin)` where `origin` is
`{ userId, source: 'user' | 'ai' | 'remote' }`. The UndoManager tracks only `source: 'user'`
transactions from the local `userId`.

**Persistence.** The websocket server debounces (5s idle, or 30s max) and writes
`Y.encodeStateAsUpdate(doc)` as a binary blob to Postgres. On room open with no live peers, load
the blob and `Y.applyUpdate`. Named snapshots are separate rows, never overwritten.

---

## 6. Rendering pipeline

Three stacked `<canvas>` elements, all absolutely positioned:

1. **Static layer** — all committed shapes. Redrawn only when the document or camera changes.
2. **Active layer** — the shape currently being drawn/dragged, selection box and handles,
   snap guides. Redrawn every frame during interaction.
3. **Overlay layer** — remote cursors, laser trails, comment pins, reactions. Its own cheap loop.

Frame loop:

```
rAF tick
  if (!dirty && !interacting) return;          // idle = zero work
  camera.applyTransform(ctx)                    // setTransform, not save/restore chains
  visible = spatialIndex.query(camera.worldViewport(padding = 200px))
  visible.sort(byZ)
  for (shape of visible) renderers[shape.type](ctx, shape, camera)
  dirty = false
```

Rules that keep this fast:
- **Cull first, sort second.** Never sort 10k shapes per frame.
- **LOD:** below 25% zoom, pen strokes render as simplified paths, text renders as a grey bar,
  sticky note text is skipped. Below 10%, shapes under 4px render as single rects.
- Batch by style: group consecutive same-stroke shapes to reduce `ctx` state changes.
- `ctx.setLineDash` and font changes are expensive — set them only when they actually change.
- Off-screen cache: rasterise `frame` contents and PDF pages to an `OffscreenCanvas` and blit,
  re-rasterising only when their content changes.
- **React never re-renders on shape change.** The bridge subscribes to Yjs, writes into the
  engine's store, and flips `dirty = true`. React re-renders only for chrome state
  (tool, selection *count*, panel open, presence list).

---

## 7. Spatial index

Uniform grid, cell size 512 world units (tuned for typical shape sizes; make it a constant).

```ts
class SpatialIndex {
  insert(id, bounds); remove(id); update(id, bounds);   // all O(cells covered)
  query(rect): ShapeId[];                                // returns candidates, dedup via Set
  queryPoint(x, y): ShapeId[];
}
```

Chosen over an R-tree because insert/update cost dominates here — shapes move constantly during
drags, and grid updates are trivially cheap while R-tree rebalancing is not. Document this
tradeoff in the README; it's a good interview answer.

Hit testing is two-phase: grid query → bounds check → precise per-type test (`hit.ts`), with
stroke hit tolerance scaled by `1/zoom` so thin lines stay clickable when zoomed out.

---

## 8. Input handling

Pointer Events only (`pointerdown/move/up`) with `setPointerCapture` — no mouse/touch duplication.
Each tool is an explicit state machine implementing:

```ts
interface Tool {
  onPointerDown(e: CanvasPointerEvent): void;
  onPointerMove(e: CanvasPointerEvent): void;
  onPointerUp(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  onCancel(): void;                    // Escape must always work
  cursor: string;
}
```

`pointermove` is coalesced with `getCoalescedEvents()` for pen strokes (captures the full
high-frequency input path) but throttled to one rAF for everything else.

Yjs writes during a drag are throttled to ~30Hz, with the authoritative final value written on
`pointerup`. Never write 120 updates/sec into the CRDT.

---

## 9. Performance strategy checklist

- [ ] Viewport culling via spatial index
- [ ] Dirty-flag rendering — idle boards cost 0% CPU
- [ ] Layer separation (static/active/overlay)
- [ ] LOD at low zoom
- [ ] Fractional z-index (no renumber writes)
- [ ] Throttled CRDT writes during drags; awareness at 30Hz
- [ ] Relative point arrays (cheap moves)
- [ ] Off-screen raster cache for frames and PDF pages
- [ ] Lazy chunks: pdf.js, WebRTC, AI panels, export
- [ ] Virtualised comment/activity lists
- [ ] Dev perf HUD: fps, ms/frame, total shapes, visible shapes, index cells hit

**Verification harness (build this in Phase 2, not at the end):** a dev-only "Generate 10,000
shapes" button that seeds a mix of rects, pen strokes, text, and stickies over a large area.
Every perf claim gets measured against it.

---

## 10. Server design

```
GET  /api/boards/:code            → metadata (404 if unknown)
POST /api/boards                  → { code, id }
POST /api/boards/:code/snapshot   → save named version
GET  /api/boards/:code/versions   → list
POST /api/files                   → multipart upload, returns { fileId, url, pages? }
POST /api/ai/:feature             → { boardId, payload } → validated structured JSON
WS   /yjs?room=CODE               → y-websocket, auth-checked for view-only mode
WS   /socket.io  (ns: /rtc)       → signaling: join, offer, answer, ice, leave, hand, speaking
```

- View-only enforcement is **server-side**: a view-only connection is given a read-only Yjs
  connection that rejects updates. Hiding buttons in the UI is not access control.
- AI routes: zod-validate input → rate-limit (in-memory token bucket keyed by room+user) →
  call provider → zod-validate output → retry once on validation failure → return.
- File uploads: MIME sniffing on actual bytes (not the filename), size check, virus-scan hook
  left as a documented TODO.

---

## 11. WebRTC flow

```
A joins /rtc room → server returns existing peer list
A creates an offer per existing peer → server relays → each answers → ICE trickles
Mesh: N peers = N-1 connections each. Hard-cap 6; refuse the 7th with a clear message.
STUN: Google public STUN. TURN: document that a TURN server is required for
      symmetric-NAT users and that we're not running one (this is the honest, common answer).
```

Media state (muted, camera off, hand raised, speaking) rides on **Yjs awareness**, not on the
peer connection — one source of truth for presence, and it survives a failed peer connection.

---

## 12. Security notes

- No API keys in the client. Ever.
- Room codes are unguessable enough for casual use (32^6 ≈ 1e9) but **are not access control** —
  say so in the README. Real auth is the documented next step.
- Sanitise all user text before rendering in HTML chrome (chat, comments). Canvas text is drawn
  as text and is inherently safe; HTML panels are not.
- Uploads served from a separate origin/bucket path; never `Content-Type: text/html`.
- Rate-limit AI and upload routes by IP as well as by user.
