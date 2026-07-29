import type { Engine } from '@board/canvas-engine';
import { shapeBounds } from '@board/canvas-engine';
import { shapeToYMap } from '@board/shared';
import type {
  AIFeatureId, BrainstormOutput, CleanupOutput, ClusterOutput, MindmapOutput, Shape, ShapeId,
} from '@board/shared';
import type { BoardDoc } from '../../collab/BoardDoc';
import { api } from '../../lib/api';
import {
  layoutBrainstorm, layoutCleanup, layoutClusters, layoutMindmap, type CleanupMove,
} from './layout';

export interface RunResult {
  ok: boolean;
  message: string;
  provider?: string;
  cached?: boolean;
  ms?: number;
  created?: number;
}

interface RunCtx {
  doc: BoardDoc;
  engine: Engine;
  room: string;
  userId: string;
  selection: ShapeId[];
}

/**
 * Run an AI feature and apply the result to the board.
 *
 * Every result is applied in ONE `ydoc.transact` with `source: 'ai'`, so a single ctrl+Z
 * removes the entire thing rather than undoing it shape by shape.
 */
export async function runAIFeature(
  feature: AIFeatureId,
  prompt: string,
  ctx: RunCtx,
): Promise<RunResult> {
  try {
    switch (feature) {
      case 'brainstorm':
        return await runBrainstorm(prompt, ctx);
      case 'mindmap':
        return await runMindmap(prompt, ctx);
      case 'cluster':
        return await runCluster(ctx);
      case 'cleanup':
        return await runCleanup(ctx);
    }
  } catch (err) {
    // Never leave a spinner running and never fabricate shapes — an honest failure beats
    // invented content the user won't think to check.
    return { ok: false, message: err instanceof Error ? err.message : 'The AI request failed.' };
  }
}

// ---------------------------------------------------------------------------

async function runBrainstorm(prompt: string, ctx: RunCtx): Promise<RunResult> {
  const res = await api.ai<BrainstormOutput>('brainstorm', ctx.room, ctx.userId, { prompt });
  const count = res.data.themes.reduce((n, t) => n + t.ideas.length + 1, 0);
  const shapes = layoutBrainstorm(res.data, ctx.engine, ctx.userId, ctx.doc.nextZ(count));

  ctx.doc.addMany(shapes, ctx.doc.aiOrigin);
  focusOn(ctx.engine, shapes);

  return {
    ok: true,
    message: `Added ${shapes.length} notes across ${res.data.themes.length} themes.`,
    provider: res.provider,
    cached: res.cached,
    ms: res.ms,
    created: shapes.length,
  };
}

async function runMindmap(prompt: string, ctx: RunCtx): Promise<RunResult> {
  const res = await api.ai<MindmapOutput>('mindmap', ctx.room, ctx.userId, { topic: prompt });
  const shapes = layoutMindmap(res.data, ctx.engine, ctx.userId, ctx.doc.nextZ(80));

  ctx.doc.addMany(shapes, ctx.doc.aiOrigin);
  focusOn(ctx.engine, shapes);

  return {
    ok: true,
    message: `Built a mind map with ${shapes.filter((s) => s.type === 'rect').length} nodes.`,
    provider: res.provider,
    cached: res.cached,
    ms: res.ms,
    created: shapes.length,
  };
}

async function runCluster(ctx: RunCtx): Promise<RunResult> {
  const notes = ctx.selection
    .map((id) => ctx.engine.getShape(id))
    .filter((s): s is Shape => !!s && s.type === 'sticky')
    .map((s) => ({ id: s.id, text: (s as Extract<Shape, { type: 'sticky' }>).text }));

  if (notes.length < 2) {
    return { ok: false, message: 'Select at least 2 sticky notes to cluster.' };
  }

  // Send ids and text ONLY — never geometry. Sending positions would roughly 5x the token
  // cost and adds nothing: the model is judging meaning, not space.
  const res = await api.ai<ClusterOutput>('cluster', ctx.room, ctx.userId, { notes });

  const plan = layoutClusters(
    res.data,
    notes.map((n) => n.id),
    ctx.engine,
    ctx.userId,
    ctx.doc.nextZ(res.data.clusters.length + 2),
  );

  // Frames and note moves in ONE transaction so undo reverses the whole clustering.
  ctx.doc.batch(() => {
    for (const frame of plan.frames) ctx.doc.shapesMap.set(frame.id, shapeToYMap(frame));
    for (const move of plan.moves) {
      const y = ctx.doc.shapesMap.get(move.id);
      if (!y) continue;
      y.set('x', move.x);
      y.set('y', move.y);
      y.set('updatedAt', Date.now());
    }
  }, ctx.doc.aiOrigin);

  focusOn(ctx.engine, plan.frames);

  return {
    ok: true,
    message: `Grouped ${plan.moves.length} notes into ${plan.frames.length} clusters.`,
    provider: res.provider,
    cached: res.cached,
    ms: res.ms,
    created: plan.frames.length,
  };
}

async function runCleanup(ctx: RunCtx): Promise<RunResult> {
  const selected = ctx.selection
    .map((id) => ctx.engine.getShape(id))
    .filter((s): s is Shape => !!s);

  if (selected.length < 2) {
    return { ok: false, message: 'Select at least 2 shapes to clean up.' };
  }

  const payloadShapes = selected.map((s) => ({
    id: s.id,
    type: s.type,
    x: Math.round(s.x),
    y: Math.round(s.y),
    w: Math.round(s.w),
    h: Math.round(s.h),
    text: 'text' in s ? String(s.text).slice(0, 60) : undefined,
  }));

  // Derive connections from arrow bindings — real structure the model can reason about.
  const connections: Array<{ from: string; to: string }> = [];
  for (const s of selected) {
    if (s.type === 'arrow' && s.bindStart && s.bindEnd) {
      connections.push({ from: s.bindStart, to: s.bindEnd });
    }
  }

  // Arrows are connections, not nodes — laying them out on the grid would be nonsense.
  const nodes = payloadShapes.filter((s) => s.type !== 'arrow' && s.type !== 'line');
  if (nodes.length < 2) {
    return { ok: false, message: 'Select at least 2 boxes or notes to clean up.' };
  }

  const res = await api.ai<CleanupOutput>('cleanup', ctx.room, ctx.userId, {
    shapes: nodes,
    connections,
  });

  const nodeShapes = selected.filter((s) => s.type !== 'arrow' && s.type !== 'line');
  const { moves, error } = layoutCleanup(res.data, nodeShapes);
  if (error) return { ok: false, message: error };

  await animateCleanup(ctx, moves);

  return {
    ok: true,
    message: `Aligned ${moves.length} shapes into a clean ${res.data.orientation} layout.`,
    provider: res.provider,
    cached: res.cached,
    ms: res.ms,
    created: moves.length,
  };
}

// ---------------------------------------------------------------------------
// The animation IS the feature
// ---------------------------------------------------------------------------

/**
 * Animate shapes from their old positions to the cleaned-up grid.
 *
 * 300ms easeOutCubic, staggered 12ms per shape. Three crooked boxes snapping into an aligned
 * flowchart is a five-second moment people remember; the same result teleporting into place
 * reads as a page refresh. This is not polish — do not skip it.
 *
 * Only the FINAL position is written to the document; intermediate frames go straight to the
 * engine, so we don't flood peers with 18 frames of interpolation per shape.
 */
async function animateCleanup(ctx: RunCtx, moves: CleanupMove[]): Promise<void> {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const starts = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const m of moves) {
    const s = ctx.engine.getShape(m.id);
    if (s) starts.set(m.id, { x: s.x, y: s.y, w: s.w, h: s.h });
  }

  if (!reduceMotion) {
    const DURATION = 300;
    const STAGGER = 12;
    const total = DURATION + moves.length * STAGGER;
    const t0 = performance.now();

    await new Promise<void>((resolve) => {
      const tick = () => {
        const elapsed = performance.now() - t0;
        moves.forEach((m, i) => {
          const from = starts.get(m.id);
          const shape = ctx.engine.getShape(m.id);
          if (!from || !shape) return;
          const local = Math.max(0, Math.min(1, (elapsed - i * STAGGER) / DURATION));
          const t = easeOutCubic(local);
          ctx.engine.putShape({
            ...shape,
            x: from.x + (m.x - from.x) * t,
            y: from.y + (m.y - from.y) * t,
            w: from.w + (m.w - from.w) * t,
            h: from.h + (m.h - from.h) * t,
          } as Shape);
        });
        ctx.engine.markDirty();
        if (elapsed < total) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  // Authoritative write, once, as a single undoable transaction.
  ctx.doc.updateMany(
    moves.map((m) => ({ id: m.id, patch: { x: m.x, y: m.y, w: m.w, h: m.h } as Partial<Shape> })),
    ctx.doc.aiOrigin,
  );
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// ---------------------------------------------------------------------------

function focusOn(engine: Engine, shapes: Shape[]): void {
  if (shapes.length === 0) return;
  let rect = shapeBounds(shapes[0]!);
  for (const s of shapes.slice(1)) {
    const b = shapeBounds(s);
    const x = Math.min(rect.x, b.x);
    const y = Math.min(rect.y, b.y);
    rect = {
      x,
      y,
      w: Math.max(rect.x + rect.w, b.x + b.w) - x,
      h: Math.max(rect.y + rect.h, b.y + b.h) - y,
    };
  }
  engine.camera.fitTo(rect, engine.width, engine.height, 120);
  engine.markDirty();
  engine.markOverlayDirty();
}

