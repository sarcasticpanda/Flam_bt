# CLAUDE.md — THE———BOARD Operating Manual

> Read at the start of every session. If a rule here conflicts with something said in chat,
> the chat wins — but say out loud that a rule is being overridden, and log it in
> `docs/DECISIONS.md`.

## What we are building

**THE———BOARD** — a real-time collaborative visual workspace. Infinite canvas, multiplayer
editing over CRDT, in-board audio/video meetings, and an AI copilot that writes *geometry*
rather than prose.

Elevator pitch: *"One room, one 6-character code. Draw together, talk together, and let the AI
turn the mess into a clean diagram — without leaving the canvas."*

Submitted as a Frontend R&D assignment against the brief **"Real-Time Collaborative Drawing
Canvas."** That framing decides every scope call: the canvas engine and the sync layer are the
graded surface. Everything else is supporting cast.

## The constraint that shapes everything

**One day.** The source spec in `refernce/collabspace-ai-spec/` is a 10-day plan. We are not
going to pretend otherwise. The plan in `docs/00-PLAN.md` reorders that spec so that
**every stopping point is demoable** — if the clock runs out at any block boundary, what exists
is a finished-looking product, not eight half-built phases.

Corollary rules for a one-day build:

- **Never leave the tree broken.** Prefer a working narrower feature over a broken wider one.
- **No speculative abstraction.** Build the second case before extracting the interface.
- **Ugly-but-correct beats elegant-but-late**, except in the canvas engine, where the
  architecture *is* the deliverable and shortcuts cost more than they save.

## Non-negotiable engineering rules

1. **TypeScript strict.** No `any` without a `// why:` comment on the same line.
2. **No secrets in the client. Ever.** Every AI call goes through `apps/server`. If a key ever
   gets a `VITE_` prefix it is compiled into the bundle and shipped to every visitor. The three
   provider keys in `.env` are already exposed in a chat transcript — treat them as burnable and
   rotate after submission.
3. **The canvas never re-renders through React.** React owns chrome only: toolbar, panels,
   modals, presence list. Shape state lives in the engine's store, never in React state.
   A `useState` holding shapes is a bug, not a style preference.
4. **All document mutations go through Yjs.** Never mutate a local array and "sync it later."
   Yjs is the single source of truth for board content.
5. **Every block ends runnable.** `pnpm dev` boots, `pnpm typecheck` is clean, no console errors.
6. **Write the test with the code** for anything in `packages/canvas-engine` — geometry, hit
   testing, spatial index. These are pure functions: cheap to test, brutal to debug later.
7. **Performance is a feature.** If a change drops 10k-shape pan/zoom below 55fps, fix it in the
   same commit. The perf HUD exists so this is never a matter of opinion.
8. **Commit per task ID**: `feat(B1-03): uniform-grid spatial index`.

## The signature design rule

> **The interface is monochrome. Every saturated colour on screen belongs to a human.**

Chrome lives entirely in the neutral ramp of the active theme. The only chroma in the chrome
comes from participants — cursor labels, avatar rings, selection outlines, speaking indicators.
Alone, the app is quiet greyscale; with five people it comes alive.

This has a hard engineering consequence: **there is no brand accent colour.** No blue primary
buttons. A primary button is `ink` on `paper` or `paper` on `ink`. Emphasis comes from weight,
size, and contrast — never hue. Sticky notes and shape fills are user *content*, not chrome, so
they are exempt.

Themes change the neutral ramp only. The participant palette is theme-invariant. See
`docs/05-DESIGN-SYSTEM.md`.

## Working agreement

- Work through `docs/00-PLAN.md` **in block order**. Tick tasks as acceptance criteria pass.
- **Do not start a block until the previous block's gate demonstrably passes.** The gate is one
  sentence. If you cannot demo that sentence, the block is not done — say so rather than moving on.
- After each block: update `docs/PROGRESS.md` with what shipped, what was deferred, and any
  deviation from spec with reasoning. Append judgement calls to `docs/DECISIONS.md`.
- If a spec detail is ambiguous, make the smallest reasonable decision, implement it, log it,
  and keep moving. Do not stall on a question you can answer yourself.
- If something in the spec is *wrong* once you see the code, say so immediately. Arguing for two
  minutes beats shipping a bad design.

## Verification protocol

Full detail in `docs/06-VERIFICATION.md`. The short version — at every gate:

1. `pnpm typecheck && pnpm lint && pnpm test` clean.
2. **Two windows on one board.** This catches ~80% of realtime bugs and cannot be skipped.
   Automated via Playwright with two browser contexts.
3. A **Haiku subagent** re-reads the block's acceptance criteria against the actual diff and
   reports pass/fail per criterion. Independent eyes, cheap, catches "I forgot P2-11."
4. The `code-review` skill on the block's diff before the commit that closes it.

Never report a gate as passed on the strength of having written the code. Run it.

## Repo map

```
the-board/
├── CLAUDE.md                  ← you are here
├── docs/
│   ├── 00-PLAN.md             the one-day block plan + gates + cut order
│   ├── 01-PRD.md              every feature, ID'd, with acceptance criteria
│   ├── 02-ARCHITECTURE.md     stack, shape model, Yjs schema, render pipeline
│   ├── 03-FREE-STACK.md       zero-cost infra, provider chain, quotas, deploy
│   ├── 04-AI-SPEC.md          prompts, zod schemas, guardrails, layout algorithms
│   ├── 05-DESIGN-SYSTEM.md    tokens, themes, type scale, motion, copy rules
│   ├── 06-VERIFICATION.md     how each gate is proven; Playwright + subagent protocol
│   ├── DECISIONS.md           append-only judgement log
│   └── PROGRESS.md            block status + measured numbers
├── refernce/                  original 10-day spec bundle (read-only, do not edit)
├── apps/
│   ├── web/                   React + Vite client
│   └── server/                Node: Yjs websocket, AI proxy, WebRTC signaling
└── packages/
    ├── canvas-engine/         framework-agnostic renderer, geometry, spatial index
    └── shared/                shape types, Yjs schema, zod validators, constants
```

`refernce/` is the original spec bundle. It is the source of truth for *intent*. Where our
one-day plan diverges from it, `docs/DECISIONS.md` records why. Do not edit files in `refernce/`.

## Definition of done — any task

- [ ] Acceptance criteria in `docs/01-PRD.md` pass, manually verified in a browser
- [ ] `pnpm typecheck` and `pnpm lint` clean
- [ ] Works with **two browser windows on the same board**
- [ ] No new console errors, no React key warnings
- [ ] Keyboard-reachable if the action exists in chrome UI
- [ ] Committed with the task ID in the message

## Things that will go wrong, and what they mean

Kept here because each of these has cost someone a full afternoon.

| Symptom | Almost always |
|---|---|
| Shapes render locally, never sync | A mutation bypassed `ydoc.transact` |
| Undo reverts a collaborator's shape | `UndoManager` not scoped to local origin |
| Canvas blurry on a HiDPI screen | Missing `devicePixelRatio` scaling in the resize path |
| fps collapses around 2k shapes | Culling not applied, or sorting all shapes every frame |
| Pen stroke lags the cursor | Drawing on the static layer instead of the active layer |
| AI returns 200 but nothing appears | Schema mismatch swallowed — check the retry-path logs |
| AI returns empty content | Thinking model ate the token budget. Raise `AI_MAX_TOKENS` |
| Gemini output truncated mid-JSON | Read `parts[0].text` instead of concatenating all parts |
| WebRTC fine locally, dead across networks | No TURN server. Expected — document it |
| Websocket works locally, fails in prod | `ws://` instead of `wss://`, or deployed to serverless |

## Honesty clauses for the README

State these plainly rather than hoping nobody checks. Each reads as engineering maturity:

- Room codes are unguessable enough for casual use (32^6 ≈ 1e9) but **are not access control**.
- No TURN server, so calls fail between symmetric NATs. Standard, and documented.
- The canvas is **not screen-reader accessible**. Every canvas *action* has a keyboard path
  through the chrome, but the surface itself is a bitmap.
- Single-instance websocket server. Multi-instance needs a Redis pub/sub bridge between
  y-websocket nodes — documented as a known limitation, not half-built.
- Free-tier host sleeps when idle; first load after a quiet period is slow.
