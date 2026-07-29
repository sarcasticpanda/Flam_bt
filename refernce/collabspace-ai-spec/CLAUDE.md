# CLAUDE.md — Project Operating Manual

> This file is read by Claude Code at the start of every session. Keep it accurate.
> If a rule here conflicts with anything I say in chat, ask me before proceeding.

## What we are building

**CollabSpace AI** — a real-time collaborative visual workspace. Infinite canvas + multiplayer
editing + file annotation + in-board meetings + AI copilot for diagramming and synthesis.

Elevator pitch: *"Miro's canvas, Meet's calls, and an AI that turns messy thinking into
structured diagrams — in one room you join with a 6-character code."*

## Non-negotiable engineering rules

1. **TypeScript strict mode.** No `any` without a `// why:` comment on the same line.
2. **No secrets in the client.** All AI provider calls go through `apps/server` routes. If you
   ever find yourself writing an API key into `apps/web`, stop and ask.
3. **The canvas renderer never re-renders through React.** React owns chrome (toolbar, panels,
   modals). The canvas is a single `<canvas>` driven by an imperative engine + rAF loop.
   Do not put shape state in React state.
4. **All document mutations go through Yjs.** Never mutate a local shape array directly and
   "sync it later". Yjs is the single source of truth for board content.
5. **Every phase must end runnable.** `pnpm dev` boots, no TS errors, no console errors on load.
6. **Write the test with the feature** for anything in `packages/canvas-engine` (geometry, hit
   testing, spatial index, transforms). These are pure functions — they are cheap to test and
   expensive to debug later.
7. **Performance budget is a feature, not a stretch goal.** See `docs/02-ARCHITECTURE.md` §9.
   If a change drops the 10k-shape pan/zoom below 55fps, fix it in the same PR.
8. **Commit per task**, using the task ID: `feat(P3-04): sticky note editing`.

## Working agreement

- Work through `docs/03-TASKS.md` **in order**. Tick the checkbox when a task's acceptance
  criteria are met. Do not skip ahead, do not batch 10 tasks into one blob of code.
- Before starting a phase, re-read that phase's section in `docs/01-PRD.md` and
  `docs/02-ARCHITECTURE.md`.
- After finishing a phase, update `docs/PROGRESS.md` with what shipped, what was deferred, and
  any deviation from the spec (with reasoning).
- If a spec detail is ambiguous, make the smallest reasonable decision, implement it, and log
  it in `docs/DECISIONS.md`. Don't stall.
- If something in the spec is *wrong* or a bad idea once you see the code, say so. I'd rather
  argue for two minutes than ship a bad design.

## Repo map

```
collabspace/
├── CLAUDE.md                  ← you are here
├── docs/
│   ├── 00-BRIEF.md            product story, positioning, demo script
│   ├── 01-PRD.md              every feature + acceptance criteria
│   ├── 02-ARCHITECTURE.md     stack, data model, protocols, perf strategy
│   ├── 03-TASKS.md            the build order — your working checklist
│   ├── 04-AI-SPEC.md          prompts, schemas, and guardrails for AI features
│   ├── 05-DESIGN-SYSTEM.md    tokens, type scale, component rules
│   ├── 06-SETUP.md            env vars, commands, deployment
│   ├── DECISIONS.md           append-only decision log (you write this)
│   └── PROGRESS.md            phase-by-phase status (you write this)
├── prompts/
│   └── phase-prompts.md       copy-paste kickoff prompts, one per phase
├── apps/
│   ├── web/                   React + Vite client
│   └── server/                Node: Yjs websocket, AI proxy, WebRTC signaling
└── packages/
    ├── canvas-engine/         framework-agnostic renderer, geometry, spatial index
    └── shared/                shape types, Yjs schema, zod validators, constants
```

## Definition of done (any task)

- [ ] Acceptance criteria in `03-TASKS.md` all pass, manually verified
- [ ] `pnpm typecheck` and `pnpm lint` clean
- [ ] Works with **two browser windows open on the same board** (this catches ~80% of realtime bugs)
- [ ] No new console errors or React key warnings
- [ ] Keyboard accessible where a mouse action exists in the chrome UI
- [ ] Committed with the task ID in the message
