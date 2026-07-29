# Decision Log

Append-only. One entry per judgement call made during the build. Newest at the bottom.

Format:

```
## YYYY-MM-DD — <short title>  [Phase N]
**Context:** what forced a choice
**Options:** what was considered
**Decision:** what was chosen
**Consequence:** what this makes easier, and what it makes harder later
```

---

## 2026-XX-XX — Custom canvas engine instead of tldraw  [Phase 0, pre-decided in spec]
**Context:** tldraw SDK would deliver ~70% of the PRD immediately.
**Options:** tldraw SDK · Konva.js scene graph · custom Canvas 2D engine.
**Decision:** custom Canvas 2D engine, with Konva as the fallback if the engine isn't stable by
the end of Phase 2. Not tldraw under any circumstance.
**Consequence:** roughly 3 extra days of work, in exchange for owning the spatial index,
culling, hit testing, and CRDT schema — which are the parts of this project actually worth
talking about. Risk: the engine is the critical path; if it slips, everything slips.
