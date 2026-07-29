import type { AIFeatureId } from '@board/shared';

/**
 * Prompt builders.
 *
 * The design principle everything here follows: THE MODEL RETURNS STRUCTURE, THE CLIENT COMPUTES
 * GEOMETRY. Asking an LLM for pixel coordinates produces overlapping, drifting layouts and is
 * the most common failure mode in AI-canvas demos.
 */

export const SYSTEM_PREAMBLE = `You are the layout and synthesis engine for a collaborative whiteboard.
Respond with a single JSON object and nothing else — no prose, no markdown fences,
no explanation. Every field in the schema is required unless marked optional.
Keep all text concise: sticky notes under 12 words, labels under 5 words.`;

export interface BuiltPrompt {
  system: string;
  user: string;
  maxTokens: number;
}

export function buildPrompt(feature: AIFeatureId, payload: Record<string, unknown>): BuiltPrompt {
  // The demo provider reads this tag to route without a network call. Real providers ignore it
  // as ordinary context.
  const tag = `[feature:${feature}]\n${JSON.stringify(payload)}`;

  switch (feature) {
    case 'brainstorm': {
      const count = Number(payload.count ?? 12);
      return {
        system: SYSTEM_PREAMBLE,
        maxTokens: 2500,
        user: `${tag}

Brainstorm ideas for: "${String(payload.prompt)}"

Produce ${count} distinct, concrete ideas — no restatements of the topic, no generic
filler like "do research". Group them into 3-5 themes. Each idea belongs to exactly one theme.

Return JSON: {"themes":[{"label":string,"ideas":[string]}]}`,
      };
    }

    case 'cluster': {
      const notes = (payload.notes ?? []) as Array<{ id: string; text: string }>;
      const lines = notes.map((n) => `${n.id}: ${n.text}`).join('\n');
      return {
        system: SYSTEM_PREAMBLE,
        maxTokens: 2500,
        user: `${tag}

Group these notes into 3-7 coherent clusters. Every note id must appear in exactly one
cluster. Give each cluster a specific label (2-4 words) describing what its notes actually
have in common — not a generic bucket like "Other" or "Miscellaneous" unless genuinely
unavoidable, and at most one such cluster.

Notes:
${lines}

Return JSON: {"clusters":[{"label":string,"noteIds":[string]}]}`,
      };
    }

    case 'cleanup': {
      const shapes = (payload.shapes ?? []) as Array<{
        id: string; type: string; w: number; h: number; text?: string;
      }>;
      const connections = (payload.connections ?? []) as Array<{ from: string; to: string }>;
      return {
        system: SYSTEM_PREAMBLE,
        maxTokens: 3000,
        user: `${tag}

These shapes were drawn roughly by hand. Normalise them into a clean diagram.

Shapes:
${shapes.map((s) => `${s.id} (${s.type}${s.text ? `, "${s.text}"` : ''})`).join('\n')}

Connections:
${connections.length ? connections.map((c) => `${c.from} -> ${c.to}`).join('\n') : '(none)'}

Rules:
- Infer each shape's role from its text and connections: start | process | decision | data | end | note
- Shapes with the same role get identical width and height
- Place shapes on a grid using row/col integers. Follow the connection flow:
  connected shapes should be adjacent, flow generally top-to-bottom
- Preserve every input shape id EXACTLY. Do not invent, drop, or rename shapes.
- Suggest an orientation: "vertical" or "horizontal"

Return JSON: {"orientation":"vertical"|"horizontal","layout":[{"id":string,"role":string,"row":int,"col":int}]}`,
      };
    }

    case 'mindmap': {
      const depth = Number(payload.depth ?? 2);
      return {
        system: SYSTEM_PREAMBLE,
        maxTokens: 3000,
        user: `${tag}

Build a mind map for: "${String(payload.topic)}"
Depth: ${depth}. Between 4 and 6 children per node. Each label is 1-4 words.
Branches must be genuinely distinct — no overlapping categories.

Return JSON: {"root":{"label":string,"children":[{"label":string,"children":[...]}]}}`,
      };
    }
  }
}
