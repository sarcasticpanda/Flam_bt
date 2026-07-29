/**
 * zod schemas.
 *
 * Used for two different jobs that happen to need the same tool:
 *   1. Validating board JSON on import (untrusted file input).
 *   2. Validating AI model output before it touches the document (untrusted model output).
 *
 * Model output is untrusted input. It is treated exactly like a file upload.
 */
import { z } from 'zod';
import { AI_FEATURES, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './constants.js';

// ---------------------------------------------------------------------------
// Room codes
// ---------------------------------------------------------------------------

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(ROOM_CODE_LENGTH)
  .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`), 'Invalid characters in room code');

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const pointSchema = z.tuple([z.number(), z.number()]);
const dashSchema = z.enum(['solid', 'dashed', 'dotted']);
const alignSchema = z.enum(['left', 'center', 'right']);

const baseShapeSchema = z.object({
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite(),
  h: z.number().finite(),
  rotation: z.number().finite(),
  z: z.string().min(1),
  parentId: z.string().nullable(),
  locked: z.boolean(),
  opacity: z.number().min(0).max(1),
  createdBy: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  meta: z.record(z.unknown()).optional(),
});

const boxStyle = {
  stroke: z.string(),
  fill: z.string(),
  strokeWidth: z.number().positive(),
  dash: dashSchema,
  text: z.string(),
  textAlign: alignSchema,
  fontSize: z.number().positive(),
};

const pathStyle = {
  points: z.array(pointSchema),
  stroke: z.string(),
  strokeWidth: z.number().positive(),
};

export const shapeSchema = z.discriminatedUnion('type', [
  baseShapeSchema.extend({ type: z.literal('rect'), ...boxStyle, radius: z.number().min(0) }),
  baseShapeSchema.extend({ type: z.literal('ellipse'), ...boxStyle }),
  baseShapeSchema.extend({
    type: z.literal('line'),
    ...pathStyle,
    dash: dashSchema,
    arrowheads: z.tuple([z.boolean(), z.boolean()]),
    label: z.string(),
  }),
  baseShapeSchema.extend({
    type: z.literal('arrow'),
    ...pathStyle,
    dash: dashSchema,
    arrowheads: z.tuple([z.boolean(), z.boolean()]),
    label: z.string(),
    bindStart: z.string().nullable(),
    bindEnd: z.string().nullable(),
  }),
  baseShapeSchema.extend({
    type: z.literal('draw'),
    ...pathStyle,
    blend: z.enum(['normal', 'multiply']),
    pressures: z.array(z.number()).optional(),
    brush: z.enum(['pen', 'brush', 'marker', 'pencil']).optional(),
  }),
  baseShapeSchema.extend({
    type: z.literal('text'),
    text: z.string(),
    fontSize: z.number().positive(),
    fontFamily: z.string(),
    color: z.string(),
    align: alignSchema,
    autoWidth: z.boolean(),
  }),
  baseShapeSchema.extend({
    type: z.literal('sticky'),
    text: z.string(),
    color: z.string(),
    fontSize: z.number().positive(),
    tags: z.array(z.string()),
  }),
  baseShapeSchema.extend({
    type: z.literal('image'),
    url: z.string(),
    naturalW: z.number(),
    naturalH: z.number(),
  }),
  baseShapeSchema.extend({
    type: z.literal('frame'),
    name: z.string(),
    color: z.string(),
    clipsContent: z.boolean(),
  }),
  baseShapeSchema.extend({
    type: z.literal('aiCard'),
    kind: z.enum(['notes', 'explain']),
    markdown: z.string(),
  }),
]);

/** Board export/import envelope. The JSON round-trip is also our fastest debugging tool. */
export const boardExportSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  exportedAt: z.number(),
  shapes: z.array(shapeSchema),
});

export type BoardExport = z.infer<typeof boardExportSchema>;

// ---------------------------------------------------------------------------
// AI — output schemas (docs/04-AI-SPEC.md)
// ---------------------------------------------------------------------------

export const brainstormOutput = z.object({
  themes: z
    .array(
      z.object({
        label: z.string().max(40),
        ideas: z.array(z.string().max(90)).min(1).max(8),
      }),
    )
    .min(2)
    .max(6),
});

export const clusterOutput = z.object({
  clusters: z
    .array(
      z.object({
        label: z.string().max(40),
        noteIds: z.array(z.string()).min(1),
      }),
    )
    .min(2)
    .max(8),
});

export const cleanupOutput = z.object({
  orientation: z.enum(['vertical', 'horizontal']),
  layout: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['start', 'process', 'decision', 'data', 'end', 'note']),
      row: z.number().int().min(0),
      col: z.number().int().min(0),
      text: z.string().max(60).optional(),
    }),
  ),
});

/**
 * Recursive node. Depth and total node count are ALSO capped client-side — a schema cannot
 * express "at most 60 nodes across the whole tree", and an unbounded recursive structure from
 * a model is a stack overflow waiting to happen.
 */
export interface MindMapNode {
  label: string;
  children?: MindMapNode[];
}

export const mindmapNode: z.ZodType<MindMapNode> = z.lazy(() =>
  z.object({
    label: z.string().max(40),
    children: z.array(mindmapNode).optional(),
  }),
);

export const mindmapOutput = z.object({ root: mindmapNode });

export const AI_OUTPUT_SCHEMAS = {
  brainstorm: brainstormOutput,
  cluster: clusterOutput,
  cleanup: cleanupOutput,
  mindmap: mindmapOutput,
} as const;

// ---------------------------------------------------------------------------
// AI — input schemas
// ---------------------------------------------------------------------------

const nonEmptyPrompt = z.string().trim().min(1, 'Prompt is empty').max(2000);

export const brainstormInput = z.object({
  prompt: nonEmptyPrompt,
  count: z.number().int().min(4).max(20).optional(),
});

export const clusterInput = z.object({
  notes: z.array(z.object({ id: z.string(), text: z.string() })).min(2).max(200),
});

export const cleanupInput = z.object({
  shapes: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        text: z.string().optional(),
      }),
    )
    .min(2)
    .max(60),
  connections: z.array(z.object({ from: z.string(), to: z.string() })),
});

export const mindmapInput = z.object({
  topic: nonEmptyPrompt,
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

export const AI_INPUT_SCHEMAS = {
  brainstorm: brainstormInput,
  cluster: clusterInput,
  cleanup: cleanupInput,
  mindmap: mindmapInput,
} as const;

export const aiFeatureSchema = z.enum(AI_FEATURES);

export type BrainstormOutput = z.infer<typeof brainstormOutput>;
export type ClusterOutput = z.infer<typeof clusterOutput>;
export type CleanupOutput = z.infer<typeof cleanupOutput>;
export type MindmapOutput = z.infer<typeof mindmapOutput>;
