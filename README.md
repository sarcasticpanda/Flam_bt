# THE———BOARD

A real-time collaborative drawing canvas. Join with a six-character code, draw together, talk
over a call, and let an AI turn the mess into a clean diagram.

Built for the Frontend R&D assignment **"Real-Time Collaborative Drawing Canvas."**

```bash
pnpm install
cp .env.example .env      # add at least one AI key (all three have free tiers)
pnpm dev                  # web :5173 · server :3001
```

Open `localhost:5173`, click **New board**, press **P** and draw. Paste the URL into a second
window to collaborate.

---

## What it does

| | |
|---|---|
| **Infinite canvas** | Pan, zoom 10–800%, dot/line grid, HiDPI-correct |
| **Paint tools** | 4 pressure-sensitive brushes, HSV colour picker, fill bucket, eyedropper |
| **Shapes** | Rect, ellipse, line, arrow with shape binding, text, sticky notes |
| **Transform** | Marquee select, 8-handle resize, rotate, alignment snapping |
| **Real-time** | Yjs CRDT over websocket — live cursors, presence, offline-tolerant |
| **Sessions** | Create/join by code, board list, leave, server-enforced view-only links |
| **AI** | ⌘K → brainstorm, cluster, diagram cleanup, mind map |
| **Calls** | WebRTC audio/video that runs *while* you keep editing |
| **Templates** | Flowchart, mind map, kanban, SWOT, retro, system diagram |
| **Export** | PNG (1–3x, transparent option) and JSON round-trip |
| **Themes** | 5 themes; participant colours stay stable across all of them |

---

## Measured performance

Not estimates. Measured at 1600×900 with 10,000 mixed shapes (boxes, pen strokes, text,
stickies, arrows) spread over 24,000 world units, via the built-in seeder and benchmark.

| View | Visible | ms/frame | fps |
|---|---|---|---|
| 100% zoom | 53 | 1.2 | **~825** |
| 30% zoom | 584 | 12.3 | ~81 |
| 15% zoom | 2,103 | 11.6 | ~86 |
| Zoomed to fit all 10k | 4,581 | 23.1 | **~43** |

Idle board: rAF early-returns, ~0% CPU. Heap at 10k shapes: **21.6MB** (budget was 400MB).

**Honest caveat:** ≥55fps holds at every realistic working zoom. The extreme "zoom out until all
10,000 shapes are simultaneously on screen" view runs ~43fps, not 55. A real 43 beats a
claimed 60.

Press `` ` `` in the app for the live HUD (fps, ms/frame, cull/draw split, visible, culled %).

---

## Architecture

```
packages/canvas-engine/   no React, no Yjs — pure and unit-testable
  Engine.ts               3 layers, dirty-flag rAF, culling, LOD
  Camera.ts               screen↔world, zoom-to-cursor
  SpatialIndex.ts         uniform grid, 512-unit cells
  geometry.ts hit.ts      bounds, rotation, hit testing
  smoothing.ts            RDP + Catmull-Rom + variable-width outlines
packages/shared/          Shape union, zod schemas, Yjs helpers, constants
apps/web/                 React chrome + tools + collab + AI + call
apps/server/              Yjs websocket, WebRTC signaling, AI proxy, SQLite
```

### Three decisions worth defending

**1. A custom Canvas 2D engine, not tldraw.**
tldraw would have delivered ~70% of this in a weekend — which is exactly why it wasn't used.
The spatial index, viewport culling, dirty-rect rendering, hit testing, and CRDT shape schema
*are* the assignment. Adopting tldraw would make the honest answer to "what did you build?"
become "the toolbar."

**2. A uniform grid, not an R-tree.**
In this workload insert/update dominates: shapes move continuously during drags, and a
multi-shape drag re-indexes every selected shape every frame. Grid updates are a few Set
operations; R-tree rebalancing is not. An R-tree wins on query for sparse, *static* data — the
opposite of a whiteboard mid-drag. The grid's weakness is real: a shape much larger than a cell
touches many cells. Frames are the only such shapes, and there are few.

**3. The model returns structure; the client computes geometry.**
Asking an LLM for pixel coordinates produces drifting, overlapping layouts and is the most
common failure mode in AI-canvas demos. Here the model returns themes, clusters, roles, and
trees — every position is computed by deterministic client code. Cleanup validates that the
returned ids are *exactly* the input ids and rejects the result otherwise, rather than silently
destroying work.

### Performance techniques

Viewport culling via the spatial index · dirty-flag rendering (idle = 0% CPU) · three-layer
canvas split (static/active/overlay) · LOD with batched far-zoom rendering · fractional z-index
(no renumber writes) · CRDT writes throttled to 30Hz during drags with an authoritative write on
pointerup · point arrays stored relative to shape origin, so moving a 400-point stroke is a
two-field update.

Two performance bugs the benchmark caught during the build, both worth knowing:

- Culling recomputed `shapeBounds()` per shape per frame, re-walking every pen-stroke point.
  **17.5ms → 0.1ms** by using the bounds the index already stores.
- Far-zoom LOD did one `fillStyle` write per shape. Batching by colour cut frame time ~40%.

---

## Zero-cost stack

Everything is free, no credit card.

| Layer | Choice |
|---|---|
| AI | Groq → Gemini → OpenRouter → deterministic local fallback |
| Realtime | Self-hosted Yjs websocket |
| Database | SQLite (`node:sqlite`, no native build) locally; free Postgres in prod |
| Calls | WebRTC mesh + Google public STUN |
| Hosting | Vercel (web) + Render (server, must be long-lived — **not** serverless) |

The AI layer falls through providers on error, timeout, or schema-validation failure. The
terminal `demo` provider is a deterministic local generator — real keyword-overlap clustering
and layout, no network — so the app never hard-fails in front of a reviewer with an exhausted
quota. **The UI always names which provider answered, and demo output is labelled as such.**

Three things verified live before any feature code was written, each of which fails *silently*:

- Retired model slugs return **404, not 401** — reads like a bad key, sends you to the wrong layer.
- Modern Gemini models are *thinking* models: at 2000 max tokens the entire budget went to
  reasoning and content came back **empty**.
- Gemini returns **multi-part** responses; reading `parts[0].text` yields truncated JSON.

---

## Testing

```bash
pnpm typecheck   # 4 packages, TS strict
pnpm test        # 54 unit tests
```

Unit tests cover the pure layers — spatial index, geometry, camera, stroke simplification —
including the cases that actually bite: negative coordinates, shapes spanning many cells,
zoom-anchor drift over 40 successive zooms, RDP on a 5,000-point stroke without blowing the
stack, and rapid create-delete-create leaving no orphan in the index.

Everything else was verified by driving the real app with Playwright: drawing with every tool,
arrow binding, undo scoping, **two windows converging on one board**, AI results applying as a
single undoable transaction, and templates inserting atomically.

---

## Known limitations

Stated plainly rather than left to be discovered.

- **Room codes are not authentication.** 31^6 ≈ 8.9e8 is unguessable enough for casual use;
  anyone with a code can edit. Real accounts are the next step.
- **No TURN server**, so calls fail between two symmetric NATs (~8–15% of real peer pairs).
  Same-network and most home connections work. Open Relay's free tier is a config change.
- **Calls are a WebRTC mesh, capped at 6.** Beyond that, upstream bandwidth on a laptop
  collapses. An SFU (LiveKit/mediasoup) is the upgrade path.
- **Single server instance.** Multi-instance needs a Redis pub/sub bridge between y-websocket
  nodes — documented rather than half-built.
- **The canvas is not screen-reader accessible.** It's a bitmap. Every canvas *action* has a
  keyboard path through the chrome, and all chrome is labelled and focus-ringed.
- **Free hosting sleeps when idle**, so the first load after a quiet period is slow.
- Board list is per-browser (`localStorage`), since boards are anonymous.

## Keyboard

`V` select · `H` pan · `P` pen · `M` highlighter · `E` eraser · `G` fill · `I` eyedropper
`R` rect · `O` ellipse · `L` line · `A` arrow · `T` text · `N` sticky
`⌘K` AI · `⌘Z`/`⌘⇧Z` undo/redo · `⌘D` duplicate · `` ` `` perf HUD · `?` all shortcuts
