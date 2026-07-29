# 01 — Product Requirements

Every feature below has an ID, a priority, and acceptance criteria. The IDs are referenced by
`03-TASKS.md`. Priorities:

- **P0** — MVP. The project is not presentable without it.
- **P1** — Should-have. Ship if the schedule holds.
- **P2** — Nice-to-have. Cut without guilt.

---

## 1. Rooms & identity

### F1.1 — Anonymous join by room code (P0)
Users get in with no signup. Landing page has "New board" and a 6-character code input.

- Codes are 6 chars, uppercase, from an unambiguous alphabet (no `0/O`, `1/I/L`).
- "New board" creates a board and routes to `/b/:code` immediately.
- Joining prompts once for a display name; name and assigned colour persist in `localStorage`.
- An invalid or unknown code shows an inline error on the landing page, not a 404 route.
- Each user is assigned a colour from a fixed 12-colour palette, chosen to avoid collision with
  users already present in the room where possible.

### F1.2 — Optional accounts (P2)
Supabase email magic-link auth. Signed-in users get a dashboard of their boards with
last-edited timestamps. Anonymous boards stay reachable by code forever.

### F1.3 — Board metadata (P0)
Title (inline-editable in the header), created-at, updated-at, thumbnail (regenerated on save).

---

## 2. Canvas

### F2.1 — Infinite canvas (P0)
- Pan: space+drag, middle-mouse drag, or two-finger trackpad scroll.
- Zoom: ctrl/cmd+scroll and pinch, range **10%–800%**, zooming toward the cursor position.
- Zoom controls: `+` / `−` / `Reset to 100%` / `Zoom to fit` in a bottom-left cluster.
- The viewport is stored per-user in `localStorage` and restored on reopen.
- Canvas is HiDPI-correct (`devicePixelRatio` scaling), and resizes with the window.

### F2.2 — Shape tools (P0)
Toolbar tools: `select`, `hand`, `pen`, `highlighter`, `eraser`, `rectangle`, `ellipse`, `line`,
`arrow`, `text`, `sticky`, `frame` (P1), `image` (upload), `laser pointer` (P1, ephemeral).

Per-tool requirements:
- **Pen** — pressure-agnostic freehand, points simplified with Ramer–Douglas–Peucker on
  pointerup; stroke rendered as a smoothed path, not a polyline of segments.
- **Highlighter** — same as pen, `multiply` blend mode, fixed 40% alpha, thicker default.
- **Eraser** — two modes: *object erase* (delete whole shape on hit) and *pixel erase* for pen
  strokes only (P2). Object erase is the P0 default.
- **Rectangle / Ellipse / Line / Arrow** — drag to draw; hold `shift` to constrain to
  square/circle/45°; hold `alt` to draw from centre.
- **Arrow** — supports binding: if an endpoint is dropped on a shape, it binds to that shape and
  follows it when the shape moves. Binding point is the nearest edge intersection.
- **Text** — click to place, type inline on canvas (not in a modal). Auto-width until the user
  drags a width, then wraps. Escape or click-away commits.

### F2.3 — Selection & transform (P0)
- Click to select; shift+click to add; drag on empty canvas for a marquee.
- Selection box with 8 resize handles and a rotation handle above the top edge.
- Multi-select transforms as a group with a shared bounding box.
- Snapping: to other shapes' edges and centres, with pink alignment guides; to a grid when grid
  snapping is toggled on. Hold `ctrl` to temporarily disable snapping.
- Arrow keys nudge by 1px; shift+arrow by 10px.

### F2.4 — Style panel (P0)
Contextual panel appears when a shape is selected: stroke colour, fill colour, stroke width
(4 steps), opacity, dash style, font size, text align, and for sticky notes the note colour.
Changing a style with nothing selected sets the default for the next shape drawn.

### F2.5 — Object operations (P0/P1)
`duplicate` (ctrl+D and alt-drag), `delete`, `copy/paste` (including across boards via
clipboard JSON), `bring forward / send backward / to front / to back`, `group / ungroup` (P1),
`lock / unlock` (P1), `align` — left/centre/right/top/middle/bottom and distribute
horizontally/vertically (P1).

### F2.6 — Sticky notes (P0)
- Fixed size on creation (180×180), auto-shrinking font to fit content.
- 8 preset colours.
- Double-click to edit text inline.
- P1 additions: an author avatar chip, emoji reactions on the note, a tag string, and a
  checklist mode where lines beginning `[]` render as toggleable checkboxes.

### F2.7 — Minimap (P1)
Bottom-right, shows all shape bounds and the current viewport rect; click or drag to navigate.

### F2.8 — Grid & background (P1)
Toggle between blank, dot grid, and line grid. Grid scales with zoom and fades below 30% zoom.

---

## 3. Real-time collaboration

### F3.1 — Multiplayer document sync (P0)
Yjs CRDT over websocket. Any shape create/update/delete propagates to all peers.

**Acceptance:** two windows, one board. Every operation in §2 reflects in the other window in
under 200ms on localhost. Disconnect one window's network for 30s, keep drawing in both,
reconnect — both converge to the same document with no lost shapes and no duplicates.

### F3.2 — Live cursors (P0)
Each peer's cursor renders with their name label and colour, interpolated between updates so it
glides rather than teleports. Cursor updates throttled to ~30Hz and sent over Yjs **awareness**,
never persisted to the document.

### F3.3 — Presence (P0)
Avatar stack in the header showing who is in the room; overflow collapses to "+N". Clicking an
avatar jumps your viewport to that user. A "follow" toggle locks your viewport to theirs until
you pan away.

### F3.4 — Live selection indicators (P1)
Another user's selected shapes get a thin outline in that user's colour with their name at the
corner. Prevents two people dragging the same shape blindly.

### F3.5 — Comments (P1)
Pin a comment anywhere on the canvas or attached to a shape. Threaded replies, `@mentions`,
resolve/unresolve. Unresolved comment pins are visible at all zoom levels (they scale
inversely so they never disappear).

### F3.6 — Reactions & laser pointer (P2)
Emoji reactions that float up from the sender's cursor and fade. Laser pointer draws a trail
that fades over 1s and is never persisted.

### F3.7 — Timer, polls, voting mode (P2)
Shared countdown timer in the header. Voting mode gives each user N dot-votes to place on
shapes; totals shown per shape when voting closes.

---

## 4. Meetings

### F4.1 — Audio call (P1)
WebRTC mesh, capped at 6 peers. Join/leave, mute/unmute, per-peer speaking indicator driven by
a `AudioContext` analyser. Signaling over the existing socket connection.

### F4.2 — Video call (P1)
Adds camera tracks. Floating draggable video tiles, camera on/off, tile collapse to
audio-only. Above 4 peers, warn that mesh topology will degrade and suggest audio-only.

### F4.3 — Screen share (P2)
`getDisplayMedia`, one sharer at a time, shown as a large tile. P2 stretch: pin the shared
screen to the canvas as an annotatable live layer.

### F4.4 — Chat (P1)
Persistent per-board text chat in a side panel, stored in the Yjs doc. Unread badge.
`@mentions` highlight.

### F4.5 — Raise hand (P2)
Toggles a hand icon on your avatar and pushes you to the front of the presence stack.

---

## 5. Files & annotation

### F5.1 — Image import (P0)
Drag-drop, paste from clipboard, or toolbar upload. JPEG/PNG/WebP/SVG up to 10MB. Uploaded to
storage; the canvas shape stores a URL, never a base64 blob in the CRDT. Resizable with aspect
ratio locked by default; crop is P2.

### F5.2 — PDF import & annotation (P0)
- Rendered with `pdf.js` at a zoom-appropriate resolution.
- Each page becomes a positioned canvas layer, laid out vertically with a 24px gap.
- Any shape/pen/sticky can be drawn on top; annotations live in the normal shape layer and
  are anchored to page coordinates so they survive re-render at different zoom levels.
- Page thumbnails in a side rail for navigation.
- Export "flattened" PDF with annotations burned in (P1).

### F5.3 — PowerPoint import (P2)
Server-side conversion to PDF (LibreOffice headless) then reuse the PDF pipeline. If the
conversion service isn't available, show a clear message telling the user to export to PDF
first — do not fail silently.

### F5.4 — File limits (P0)
Per-file 10MB, per-board 100MB. Enforce **server-side**, not just in the picker. Show a clear
error naming the actual limit.

---

## 6. AI features

Full prompt/schema specs live in `04-AI-SPEC.md`. This section defines behaviour and UX.

Shared requirements for **all** AI features:
- Invoked from an AI command bar (`ctrl/cmd + K`) or from context menu items on a selection.
- Show an inline progress state on canvas at the target location, never a blocking modal.
- Every AI result is applied as **one undoable transaction** — one ctrl+Z removes the whole thing.
- Results are inserted into empty canvas space near the viewport centre, never overlapping
  existing shapes (use the spatial index to find a free rect).
- Failures show what failed and offer retry. Never leave a spinner running forever; 30s timeout.
- The AI's changes are attributed to a synthetic "AI" presence so collaborators see what happened.

### F6.1 — AI Brainstorm (P0)
Prompt → 8–15 sticky notes, grouped into 3–5 themes, laid out in themed columns with a header
note per theme. Colour per theme.

### F6.2 — AI Mind map (P0)
A central topic → a radial tree, 2 levels deep by default, expandable per-node ("expand this
branch" on a node's context menu, which sends only that branch's context).

### F6.3 — AI Diagram cleanup (P0)
Takes the current selection of rough shapes. Returns normalised geometry: aligned to a grid,
uniform sizes for shapes of the same role, even spacing, orthogonal arrow routing, and text
centred. **This is the demo moment — it must feel instant and look dramatic.** Animate shapes
to their new positions over ~300ms with an ease-out; don't teleport them.

### F6.4 — AI Sticky clustering (P0)
Select N sticky notes → the model returns cluster assignments and labels → notes animate into
labelled frames. Must handle 50+ notes (batch the text, send only `id` + `text`, never
geometry).

### F6.5 — AI Flowchart generator (P1)
Prompt ("user login flow with OTP fallback") → nodes with types (`start`, `process`,
`decision`, `end`), edges with labels, laid out with a simple layered algorithm computed
**client-side** from the returned graph — the model returns structure, the client returns
positions. This is more reliable than asking the model for coordinates.

### F6.6 — AI Meeting notes (P1)
Input: chat transcript + board activity log (shapes added, by whom) + optional speech
transcript if audio transcription is wired up. Output: a summary, decisions, action items with
owners, and open questions — rendered as a card on canvas and exportable as markdown.

### F6.7 — AI Explain diagram (P1)
Select shapes (or the whole board) → serialise to a compact structural description → the model
returns a component-by-component explanation shown in a side panel, with each paragraph
hover-linked to highlight the shape it describes.

### F6.8 — AI Code to diagram (P2)
Paste React/TS source → parse imports and component usage **client-side with a real parser**
(`@babel/parser` on the AST, not regex) → build a component graph → hand the graph to the model
only for labelling and grouping → render as a flowchart. Doing the parsing deterministically
and using the model only for judgement is the correct division of labour, and worth saying out
loud in the interview.

### F6.9 — AI guardrails (P0)
- Rate limit: 20 AI calls per room per minute, 60 per user per hour, enforced server-side.
- Max input: 12,000 characters of serialised board content per call; truncate with a notice.
- All model output validated with a zod schema before touching the document. Invalid output
  → one automatic retry with the validation error appended → then a clean user-facing failure.
- Never send image bytes or file contents to the model unless the user explicitly triggers a
  feature that requires it.

---

## 7. History

### F7.1 — Undo / redo (P0)
`ctrl+Z` / `ctrl+shift+Z`. Uses `Y.UndoManager` scoped to **the local user's own origin only** —
undo must never revert a collaborator's work. Compound operations (AI results, multi-shape
transforms) are captured as single transactions.

### F7.2 — Named snapshots (P1)
"Save version" stores a full Yjs state vector snapshot with a label and author. Version list in
a side panel; preview a version read-only; restore creates a new version rather than destroying
forward history.

### F7.3 — Activity feed (P1)
A chronological, human-readable log: "Ana added 4 shapes", "AI clustered 32 notes",
"Ravi restored version 'pre-review'". Collapsed into time buckets.

### F7.4 — Playback / time travel (P2)
Scrub through the board's history with a timeline slider and a play button. Implemented over
periodic snapshots (every 200 ops or 60s), interpolating between them.

---

## 8. Export & sharing

### F8.1 — Export (P0)
- **PNG** — current viewport or whole board, 1x/2x/3x, transparent-background toggle.
- **SVG** — vector export of all shapes (P1).
- **PDF** — whole board, or annotated source PDF flattened (P1).
- **JSON** — full board document; a matching import restores it exactly. This doubles as a
  backup/debug tool, so build it early.

### F8.2 — Share (P0)
Copy link with the room code. Access modes: `edit` (anyone with the link) and `view-only`
(separate code that disables all mutating tools server-side, not just in the UI).

---

## 9. Performance requirements (P0 — these are graded)

| Metric | Target |
|---|---|
| Shapes on one board before degradation | 10,000+ |
| Pan/zoom frame rate at 10k shapes | ≥55fps sustained on a mid-range laptop |
| Initial board load (1k shapes) | < 1.5s to interactive |
| Local edit → remote render, same LAN | < 200ms p95 |
| Memory at 10k shapes | < 400MB tab footprint |
| Bundle (initial, gzipped) | < 350KB — pdf.js, WebRTC, and AI panels are lazy chunks |

A visible dev-only perf HUD (fps, shape count, visible-shape count, draw calls, ms/frame) is
part of the deliverable. It's the fastest way to prove the claim in a demo.

---

## 10. Quality bar

- **Keyboard:** every toolbar tool has a single-key shortcut (`V H P R O L A T N E`), shown in
  tooltips and in a `?` shortcuts overlay.
- **Accessibility:** all chrome is keyboard-navigable with visible focus rings; `prefers-reduced-motion`
  disables AI animations and cursor interpolation. The canvas itself is not screen-reader
  accessible — say so honestly in the README rather than pretending otherwise.
- **Empty states:** a new board shows a quiet hint about the toolbar and the AI command bar,
  which disappears on first shape.
- **Errors:** connection loss shows a persistent "Reconnecting…" banner with an offline
  indicator; edits continue to work locally and sync on reconnect (this is free with Yjs — show it off).
- **Mobile/tablet:** view + pan + zoom must work on touch. Full editing on phones is out of scope.
