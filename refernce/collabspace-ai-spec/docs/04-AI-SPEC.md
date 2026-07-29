# 04 — AI Feature Specification

## Design principle

**The model returns structure. The client computes geometry.**

Asking an LLM for pixel coordinates produces overlapping, drifting layouts and is the single
most common failure mode in AI-canvas demos. Instead: the model returns nodes, edges, clusters,
and labels; deterministic client-side layout code turns that into positions. The result is
reproducible, aligned, and fast — and it's a strong thing to be able to explain in an interview.

The one exception is **diagram cleanup**, where the model *does* reason about arrangement — but
even there it returns roles and a grid position (`row`, `col`), not raw pixels.

## Shared implementation contract

Every feature is a module in `apps/server/src/ai/features/` exporting:

```ts
interface AIFeature<TIn, TOut> {
  id: string;
  inputSchema: z.ZodType<TIn>;
  outputSchema: z.ZodType<TOut>;
  buildPrompt(input: TIn): { system: string; user: string };
  maxTokens: number;
}
```

Pipeline in `routes/ai.ts`:

```
validate input (zod)
  → rate limit (room 20/min, user 60/hr)
  → truncate serialised board content to 12,000 chars
  → call provider with JSON-only instruction + tool/structured output
  → strip any markdown fences → JSON.parse
  → validate with outputSchema
      ↳ on failure: retry once, appending the validation error to the user message
      ↳ on second failure: return { error: 'invalid_output' } — never fake a result
  → return
```

Client applies results in **one** `ydoc.transact(fn, { userId, source: 'ai' })` so undo is atomic.

**System prompt preamble shared by all features:**

```
You are the layout and synthesis engine for a collaborative whiteboard.
Respond with a single JSON object and nothing else — no prose, no markdown fences,
no explanation. Every field in the schema is required unless marked optional.
Keep all text concise: sticky notes under 12 words, labels under 5 words.
```

---

## F6.1 — AI Brainstorm

**Input:** `{ prompt: string, count?: number (default 12) }`

**User message:**
```
Brainstorm ideas for: "{prompt}"

Produce {count} distinct, concrete ideas — no restatements of the topic, no generic
filler like "do research". Group them into 3-5 themes. Each idea belongs to exactly
one theme.
```

**Output schema:**
```ts
z.object({
  themes: z.array(z.object({
    label: z.string().max(40),
    ideas: z.array(z.string().max(90)).min(1).max(8),
  })).min(2).max(6),
})
```

**Client layout:** one column per theme, 200px column width + 40px gutter, header sticky in a
darker shade of the theme colour, ideas stacked at 180×180 with 16px vertical gaps. Theme colours
cycle through the sticky palette. Whole block placed in free space near viewport centre.

---

## F6.2 — AI Mind map

**Input:** `{ topic: string, depth?: 1|2|3 (default 2), branchContext?: string[] }`

**User message:**
```
Build a mind map for: "{topic}"
Depth: {depth}. Between 4 and 7 children per node. Each label is 1-4 words.
Branches must be genuinely distinct — no overlapping categories.
{if branchContext} You are expanding only this branch: {path}. Return only its subtree. {/if}
```

**Output schema:**
```ts
const Node = z.object({ label: z.string().max(40), children: z.array(z.lazy(() => Node)).optional() });
z.object({ root: Node })
```

**Client layout:** radial. Root at centre; level-1 children distributed evenly on a circle of
radius 280; level-2 on radius 520 within their parent's angular sector, sector width proportional
to child count. Edges are curved lines bound to both nodes. Node shapes are rounded rects
auto-sized to their text.

---

## F6.3 — AI Diagram cleanup ⭐ demo moment

**Input:** the selection, serialised compactly:
```ts
{ shapes: [{ id, type, x, y, w, h, text? }], connections: [{ from, to }] }
```

**User message:**
```
These shapes were drawn roughly by hand. Normalise them into a clean diagram.

Rules:
- Infer each shape's role from its text and connections: start | process | decision | data | end | note
- Shapes with the same role get identical width and height
- Place shapes on a grid using row/col integers. Follow the connection flow:
  connected shapes should be adjacent, flow generally top-to-bottom or left-to-right
- Preserve every input shape id exactly. Do not invent, drop, or rename shapes.
- Suggest an orientation: "vertical" or "horizontal"
```

**Output schema:**
```ts
z.object({
  orientation: z.enum(['vertical', 'horizontal']),
  layout: z.array(z.object({
    id: z.string(),
    role: z.enum(['start','process','decision','data','end','note']),
    row: z.number().int().min(0),
    col: z.number().int().min(0),
    text: z.string().max(60).optional(),
  })),
})
```

**Client:** validate that returned ids ⊆ input ids and that all input ids are present (fail
loudly otherwise). Map roles → canonical sizes (`process` 160×80, `decision` 140×140 diamond,
`start`/`end` 140×60 pill). Grid cell = maxSize + 80px gutter. Re-route arrows orthogonally
between the new positions. **Animate every shape from old to new position over 300ms with
`easeOutCubic`, staggered by 12ms per shape.** The animation is the demo — do not skip it.

---

## F6.4 — AI Sticky clustering

**Input:** `{ notes: [{ id, text }] }` — **text only**, never geometry, so 100 notes stay cheap.

**User message:**
```
Group these notes into 3-7 coherent clusters. Every note id must appear in exactly one
cluster. Give each cluster a specific label (2-4 words) that describes what its notes
actually have in common — not a generic bucket like "Other" or "Miscellaneous" unless
genuinely unavoidable, and at most one such cluster.

Notes:
{id}: {text}
...
```

**Output schema:**
```ts
z.object({
  clusters: z.array(z.object({
    label: z.string().max(40),
    noteIds: z.array(z.string()).min(1),
  })).min(2).max(8),
})
```

**Client:** verify the partition is complete and disjoint; any unassigned note goes into an
"Unsorted" cluster rather than disappearing. Create a `frame` per cluster with the label as its
name, pack notes into a grid inside each frame, lay frames out left-to-right with wrapping.
Animate notes into place with a 250ms transition.

---

## F6.5 — AI Flowchart generator

**Input:** `{ prompt: string }`

**User message:**
```
Create a flowchart for: "{prompt}"
Return nodes and directed edges. Node types: start, process, decision, end.
Exactly one start. Every decision node must have at least two outgoing edges with
distinct labels (e.g. "yes" / "no"). Every node must be reachable from start.
8-20 nodes.
```

**Output schema:**
```ts
z.object({
  nodes: z.array(z.object({
    id: z.string(), label: z.string().max(50),
    type: z.enum(['start','process','decision','end']),
  })).min(3).max(24),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().max(20).optional() })),
})
```

**Client layout — layered (Sugiyama-lite):**
1. Assign layers by longest-path from `start` (handle cycles by ignoring back-edges).
2. Order nodes within each layer by barycentre of their parents' positions, 2 sweeps.
3. Position: layer index → y, order index → x, centred per layer.
4. Route edges orthogonally; back-edges route around the side.

Validate the graph client-side before rendering (one start, no orphans); if invalid, retry once.

---

## F6.6 — AI Meeting notes

**Input:**
```ts
{
  chat: [{ author, text, ts }],
  activity: [{ author, action, count, ts }],   // "added 6 sticky notes"
  boardText: string[],                          // all text/sticky content, truncated
  durationMin: number,
}
```

**User message:**
```
Below is the record of a collaborative working session: the chat log, a summary of
board activity, and the text content people put on the board.

Write meeting notes. Only include decisions and action items that are actually
supported by the record — do not infer or invent. If there were no clear decisions,
return an empty array rather than manufacturing one. Attribute action items to a
named participant only when the record makes the owner explicit.
```

**Output schema:**
```ts
z.object({
  summary: z.string().max(600),
  decisions: z.array(z.string().max(200)),
  actionItems: z.array(z.object({ task: z.string().max(200), owner: z.string().nullable() })),
  openQuestions: z.array(z.string().max(200)),
})
```

**Client:** render as an `aiCard` shape with markdown; "Copy as markdown" and "Add action items
as sticky notes" buttons.

> The "do not invent" instruction matters. Meeting-notes features that hallucinate decisions
> are worse than useless, and an empty `decisions: []` is the correct output for a doodling
> session. Test that case explicitly.

---

## F6.7 — AI Explain diagram

**Input:** compact structural serialisation of the selection or whole board:
```
rect#a1 "Auth Service" -> rect#b2 "User DB"
rect#a1 "Auth Service" -> rect#c3 "Token Cache"
...
```

**User message:**
```
Explain this diagram to someone seeing it for the first time. Cover what each
component does and how data flows between them. Reference shapes by their id in a
"shapeIds" field so the UI can highlight them. If the diagram is ambiguous, say what
is unclear rather than guessing.
```

**Output schema:**
```ts
z.object({
  overview: z.string().max(500),
  components: z.array(z.object({
    shapeIds: z.array(z.string()),
    heading: z.string().max(60),
    body: z.string().max(400),
  })),
  unclear: z.array(z.string().max(200)),
})
```

**Client:** side panel; hovering a component highlights its shapes on canvas and vice versa.

---

## F6.8 — AI Code to diagram `[P2]`

Client-side first: `@babel/parser` → AST → extract component declarations, JSX usage, and import
edges → build `{ nodes, edges }` deterministically. Send **only that graph** to the model:

**User message:**
```
Here is a component graph extracted from a React codebase. Group the components into
logical layers (e.g. pages, containers, shared UI, data), give each group a label, and
write a one-line description per component. Do not add or remove components.
```

Output: `{ groups: [{ label, componentIds }], descriptions: Record<id, string> }`.
Layout reuses the layered algorithm from F6.5, with groups as frames.

---

## Testing the AI layer

Build these as fixtures in `apps/server/src/ai/__tests__/` — they run without hitting the API:

- [ ] Valid model output → correct parse and schema pass
- [ ] Output wrapped in ```` ```json ```` fences → fences stripped, parses
- [ ] Output with prose before the JSON → extraction succeeds or fails cleanly (never throws raw)
- [ ] Schema-invalid output → triggers exactly one retry, then a clean error
- [ ] Cleanup returning an unknown shape id → rejected, not applied
- [ ] Clustering leaving a note unassigned → note lands in "Unsorted", not dropped
- [ ] Flowchart with an unreachable node → caught client-side, retried
- [ ] Empty/whitespace prompt → 400 before any provider call
- [ ] Rate limit exceeded → 429 with retry-after, and a real UI message

## Cost & latency notes

- Brainstorm/mindmap/flowchart: ~500–1500 output tokens, 2–5s. Acceptable with a good progress state.
- Clustering 100 notes: ~3k input tokens. Send ids + text only — sending geometry would 5x this.
- Cache identical `(feature, prompt)` pairs for 5 minutes in-memory. Demos re-run the same prompt
  constantly and this makes the demo feel instant.
