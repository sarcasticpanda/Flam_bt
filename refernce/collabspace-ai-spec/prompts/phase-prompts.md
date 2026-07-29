# Phase Prompts for Claude Code

Copy one block at a time into Claude Code. **Do not paste two phases at once** — the output
degrades and you lose the ability to review. Finish a phase, verify its gate, commit, then move on.

---

## Session 0 — Bootstrap (run once, first thing)

```
Read CLAUDE.md, then read all files in docs/ in order (00 through 06).

Then, before writing any code:
1. Summarise the project back to me in under 200 words — what we're building and the three
   hardest technical parts.
2. List anything in the spec that is ambiguous, contradictory, or that you think is a bad
   technical decision. Be blunt. I'd rather fix the spec now than discover it in Phase 5.
3. Confirm the phase order in docs/03-TASKS.md makes sense to you, or propose a change.

Do not start Phase 0 until I reply.
```

---

## Phase 0 — Foundation

```
Execute Phase 0 (tasks P0-01 through P0-07) in docs/03-TASKS.md.

Set up the pnpm monorepo, both apps, both packages, and tooling. Get the shape types and zod
schemas in packages/shared right — everything downstream depends on them, so follow
docs/02-ARCHITECTURE.md §4 exactly.

Stop at the Phase 0 gate and show me: the file tree, the shape type definitions, and the output
of `pnpm typecheck`.
```

---

## Phase 1 — Canvas engine

```
Execute Phase 1 (P1-01 → P1-10) in docs/03-TASKS.md.

This is the technical foundation of the whole project — take it slowly and get it right.
Key constraints from docs/02-ARCHITECTURE.md §6 and §7:
- packages/canvas-engine has no React and no Yjs imports. Pure and testable.
- Three stacked canvases (static / active / overlay), one rAF loop, dirty-flag driven.
- Cull via the spatial index before sorting. Never sort all shapes every frame.
- Write vitest tests for SpatialIndex and geometry as you build them, not after.

Build P1-09 (the 10k shape seeder) before you tell me the phase is done — I want to see the
perf HUD holding 55fps+ while panning 10,000 shapes. Report the actual measured numbers.
```

---

## Phase 2 — Tools & interaction

```
Execute Phase 2 (P2-01 → P2-16) in docs/03-TASKS.md.

Each tool is a state machine implementing the Tool interface in docs/02-ARCHITECTURE.md §8.
Build them in this order: select → rect/ellipse → line/arrow → pen → text → sticky, so each
one builds on working selection and transform code.

Two things people usually get wrong — get them right the first time:
- Pen strokes: use getCoalescedEvents(), simplify with RDP on pointerup, render smoothed
  Bezier curves. A jagged polyline is an instant tell that the tool is a toy.
- Text: edit inline on the canvas with a positioned contenteditable overlay. Not a modal,
  not a sidebar input.

Show me the phase gate: build a real diagram end to end with boxes, bound arrows, labels, and
sticky notes.
```

---

## Phase 3 — Realtime collaboration

```
Execute Phase 3 (P3-01 → P3-14) in docs/03-TASKS.md.

Follow the Yjs document structure in docs/02-ARCHITECTURE.md §5 exactly — Y.Map per shape,
fractional z-index, transactions with origin metadata.

Non-negotiables:
- Every single mutation goes through ydoc.transact(fn, { userId, source }). Audit the Phase 2
  tool code and convert all direct mutations. Do this first, before adding the provider.
- UndoManager tracked origins must be scoped so undo can NEVER revert another user's work.
- Throttle drag writes to 30Hz; write the authoritative value on pointerup.
- Cursors go on awareness, never into the document.

Also write docs/TESTING.md: a manual two-window checklist covering every operation from Phase 2.
Then run it and tell me the results honestly, including anything that fails.
```

---

## Phase 4 — Files & annotation

```
Execute Phase 4 (P4-01 → P4-08) in docs/03-TASKS.md.

pdf.js must be a lazy chunk — it's large and most sessions never open a PDF.
Enforce file size limits server-side on actual bytes, not on the client and not on the filename.
Never put base64 or binary into the Yjs document; shapes reference a URL or fileId only.

Gate: drag a 20-page PDF in, annotate page 7 in one window, verify it appears in the second
window, reload both, verify it persisted.
```

---

## Phase 5 — AI features

```
Read docs/04-AI-SPEC.md in full before starting. Then execute Phase 5 (P5-01 → P5-14).

The core principle: the model returns STRUCTURE, the client computes GEOMETRY. Do not ask the
model for pixel coordinates.

Build the pipeline and the guardrails (P5-01 → P5-05) completely before building any individual
feature — validation, one retry on schema failure, rate limiting, atomic transaction application,
and the "find free canvas space" placement helper.

Then build the four P0 features in this order: Brainstorm, Clustering, Diagram cleanup, Mind map.

Diagram cleanup is the demo centrepiece. The 300ms staggered ease-out animation from old
positions to new is part of the feature, not a polish item. Do not skip it.

Write the fixture tests listed at the bottom of docs/04-AI-SPEC.md — they run without hitting
the API and they'll catch the failure modes that make AI features feel broken.
```

---

## Phase 6 — Meetings

```
Execute Phase 6 (P6-01 → P6-09) in docs/03-TASKS.md.

WebRTC mesh with simple-peer, signaling over the Socket.IO /rtc namespace, hard cap of 6 peers.
Media state (muted, camera off, speaking, hand raised) lives on Yjs awareness, not on the peer
connection — one source of truth for presence.

Handle the real-world failures properly: permission denied, no device found, peer connection
failed. Each gets a specific message, never a silent dead tile.

Test with two windows on the same board holding an audio+video call while both keep editing.
```

---

## Phase 7 — History, comments, export

```
Execute Phase 7 (P7-01 → P7-10) in docs/03-TASKS.md, skipping anything marked [P2] unless we
have time — check with me first.

Build PNG and JSON export first (P7-04, P7-05). The JSON round-trip is also a debugging tool,
so it earns its place early.

View-only mode must be enforced server-side: a view-only websocket connection rejects document
updates. Hiding buttons in the UI is not access control — prove it by trying to mutate from a
view-only session with the React devtools open.
```

---

## Phase 8 — Polish & delivery

```
Execute Phase 8 (P8-01 → P8-12) in docs/03-TASKS.md.

Start with the performance audit against the 10k seeder and give me real measured numbers for
every row of the table in docs/01-PRD.md §9. If any target is missed, fix it or write down the
actual number honestly — a real 48fps beats a claimed 60fps.

Then the design pass against docs/05-DESIGN-SYSTEM.md. Enforce the signature rule strictly:
audit the entire UI for any saturated colour in the chrome that doesn't belong to a participant,
and remove it.

For the README: include the architecture diagram, the decision not to use tldraw and why, the
uniform-grid-vs-R-tree tradeoff, the measured performance numbers, and an honest limitations
section (no TURN server, room codes are not authentication, canvas is not screen-reader
accessible, single-instance server).
```

---

## Utility prompts

**When stuck on a bug:**
```
Before changing any more code: explain what you expected to happen, what actually happened, and
your three most likely hypotheses ranked by probability. Then add logging to distinguish between
them and tell me what the logs say. Don't guess-and-patch.
```

**Mid-phase check-in:**
```
Pause. Show me: which task IDs are complete, which are in progress, what you've deviated from
the spec on and why, and anything you're about to build that you think is a mistake.
```

**Performance regression:**
```
Run the 10k seeder and profile a 5-second pan. Report ms/frame broken down by cull, sort, and
draw. Then tell me which of the ten items in docs/02-ARCHITECTURE.md §9 is not actually holding.
```

**End of every phase:**
```
Update docs/PROGRESS.md with this phase's outcome: what shipped, what was deferred and why, any
spec deviations, and measured numbers where relevant. Append any judgement calls you made to
docs/DECISIONS.md. Then commit everything with the phase's task IDs.
```

**When you want it to push back:**
```
Argue the other side. What's the strongest case that this approach is wrong, and what would you
build instead if it were your project?
```
