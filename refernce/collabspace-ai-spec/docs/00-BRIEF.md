# 00 — Project Brief

## The product

**CollabSpace AI** — an intelligent real-time collaborative workspace for brainstorming,
meetings, visual planning, and document annotation.

Not "a collaborative drawing app." The distinction matters in an interview: a drawing app is a
UI exercise; a collaborative workspace is a distributed-systems, rendering-performance, and
applied-AI problem wearing a UI.

## The problem it solves

Distributed teams think visually but their tools are fragmented. The diagram lives in one tab,
the call in another, the notes in a third, and the reference PDF is a download in someone's
folder. Context is lost in the gaps between tools, and nobody writes down what was decided.

CollabSpace AI collapses that into one room: draw, talk, annotate the source document, and let
the AI turn the mess into structure — clustered notes, clean diagrams, and a decision log.

## Who it's for

Primary: a 3–8 person product/engineering team running a design review, sprint planning
session, or architecture discussion.

Secondary: students and study groups doing collaborative mind-mapping.

## The one thing that makes it memorable

**AI as a canvas participant, not a chat sidebar.** Most AI features today are a text box that
returns text. Here, the AI reads and writes the *canvas itself*: it produces shapes with
positions, edges, and layout. Drawing three lopsided boxes and watching them snap into an
aligned, labelled flowchart is a five-second demo that people remember.

## Scope guardrails

| | |
|---|---|
| **Timebox** | 3 weeks solo, or 8–10 focused days |
| **Cut first if late** | Video calls → audio-only; version replay → snapshot restore only; polls/voting |
| **Never cut** | Infinite canvas performance, real-time sync correctness, at least 3 working AI features |
| **Explicitly out of scope** | Native mobile app, org/team management, billing, offline-first sync, E2E encryption, >8 concurrent video peers |

## Competitive honesty

Miro, FigJam, and tldraw exist and are excellent. This is not pretending to beat them. It's a
demonstration of the hard parts: CRDT-based multiplayer, a canvas that stays at 60fps with
10,000 shapes, WebRTC signaling, and structured LLM output that renders as geometry.

State that plainly when presenting it. It reads as engineering maturity, not modesty.

## The 3-minute demo script

Rehearse this. The build serves the demo.

1. **0:00** — Open a board. Paste the room code into a second browser window. Two cursors,
   two names, live. *"That's Yjs over a websocket — CRDT, so it survives disconnects and
   merges without a server referee."*
2. **0:25** — Draw three rough boxes and connecting arrows, deliberately crooked. Hit
   **AI Clean up**. They align, snap, and space evenly. *"The model returns a layout, not prose."*
3. **0:50** — Prompt **AI Brainstorm**: "ways to reduce checkout drop-off". 12 sticky notes fan
   onto the canvas, colour-coded by theme.
4. **1:15** — Select all of them, hit **Group by theme**. They cluster into labelled frames.
5. **1:40** — Drag in a PDF (an architecture doc). It renders on canvas; annotate over it in
   the second window and show it syncing.
6. **2:05** — Start the call. Audio connects between the two windows, avatars appear.
7. **2:25** — Hit **Meeting notes**. Summary, decisions, and action items appear as a card.
8. **2:45** — Open the perf panel: **10,000 shapes on canvas, pan and zoom, frame counter
   holding 60fps.** *"Spatial index plus viewport culling plus a single rAF-driven canvas —
   React never touches a shape."*
9. **3:00** — Export the board as PNG. Done.

## Naming

Working name **CollabSpace AI**. Alternatives if it clashes: SyncBoard, BrainCanvas, NexusBoard,
Loomspace. Pick one before the first commit and use it consistently in the README, the UI, and
the deployed URL — a project that can't decide on its own name reads as unfinished.
