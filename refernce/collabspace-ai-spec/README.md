# CollabSpace AI — Spec Bundle

Everything Claude Code needs to build this project without you re-explaining it every session.

## How to use this

1. Create an empty repo, `git init`, and drop this whole folder in at the root.
2. Open it in Claude Code.
3. Paste **Session 0** from `prompts/phase-prompts.md`. Let it read the docs and push back on
   the spec before any code exists — that conversation is worth ten minutes.
4. Then paste the Phase 0 prompt. Then Phase 1. One phase at a time.
5. After each phase, verify the gate yourself in a browser. Don't take "done" on trust.

## Why it's split this way

| File | Purpose | Read frequency |
|---|---|---|
| `CLAUDE.md` | Rules and working agreement | Every session, automatically |
| `docs/00-BRIEF.md` | What and why, plus the demo script | Once, and again before the demo |
| `docs/01-PRD.md` | Every feature + acceptance criteria | Start of each phase |
| `docs/02-ARCHITECTURE.md` | How it's built and why | Constantly during phases 1–3 |
| `docs/03-TASKS.md` | The working checklist | Every task |
| `docs/04-AI-SPEC.md` | Prompts, schemas, guardrails | Phase 5 |
| `docs/05-DESIGN-SYSTEM.md` | Tokens and visual rules | Phases 2 and 8 |
| `docs/06-SETUP.md` | Env, commands, deploy | Phase 0 and 8 |
| `docs/TESTING.md` | Two-window manual checklist | Phases 3, 4, 8 |
| `docs/DECISIONS.md` | Append-only decision log | Written during, read at README time |
| `docs/PROGRESS.md` | Status + measured numbers | End of each phase |

Context windows are finite. A single 4,000-line spec gets skimmed; seven focused documents
loaded at the moment they're relevant get followed.

## The three things that make or break this project

1. **Phase 1 and 2 are the critical path.** The canvas engine is the foundation and everything
   sits on it. If it isn't solid by day 5, take the Konva fallback documented in
   `02-ARCHITECTURE.md` §2 — but don't take the tldraw shortcut, because that's the project.
2. **Measured performance numbers.** "Handles 10,000 shapes at 58fps, with viewport culling via
   a uniform spatial grid" is a sentence that ends an interview question well. Build the seeder
   early so the number is real.
3. **The AI has to write geometry, not text.** Model returns structure, client computes layout.
   Every AI whiteboard demo that asks the model for coordinates looks broken within ten seconds.

## Suggested schedule

| Days | Phases | You should be able to… |
|---|---|---|
| 1 | 0 + 1 | pan and zoom 10k shapes at 60fps |
| 2–3 | 2 | draw a complete diagram by hand |
| 4–5 | 3 | collaborate live in two windows, offline-tolerant |
| 6 | 4 | annotate a PDF together |
| 7–8 | 5 | run the four AI features |
| 9 | 6 + 7 | call, comment, export |
| 10 | 8 | demo it to a stranger |

Phases 6 and 7 are where you cut if you're behind. Phases 1–3 and 5 are the project.
