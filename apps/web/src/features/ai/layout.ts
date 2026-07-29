import type { Engine } from '@board/canvas-engine';
import { shapeBounds, type Rect } from '@board/canvas-engine';
import {
  STICKY_COLORS,
  newShapeId,
  type BrainstormOutput,
  type CleanupOutput,
  type ClusterOutput,
  type MindMapNode,
  type MindmapOutput,
  type Point,
  type Shape,
} from '@board/shared';

/**
 * Client-side layout for AI results.
 *
 * THE core design principle of this feature: the model returns STRUCTURE (themes, clusters,
 * roles, a tree) and the client computes GEOMETRY. Asking an LLM for pixel coordinates produces
 * overlapping, drifting layouts and is the most common failure mode in AI-canvas demos.
 *
 * Everything here is deterministic. The same structure always lays out identically.
 */

const STICKY = 180;
const GAP = 16;
const COLUMN_GAP = 40;

interface Ctx {
  userId: string;
  zs: string[];
}

function base(ctx: Ctx, i: number) {
  const now = Date.now();
  return {
    id: newShapeId(),
    rotation: 0,
    z: ctx.zs[i] ?? `ai${i}`,
    parentId: null,
    locked: false,
    opacity: 1,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
    meta: { ai: true },
  };
}

// ---------------------------------------------------------------------------
// Free-space placement
// ---------------------------------------------------------------------------

/**
 * Spiral outward from the viewport centre until we find a rect that overlaps nothing.
 *
 * A good second use for the spatial index: the same structure that makes culling fast makes
 * placement fast. Without this, AI results land on top of existing work.
 */
export function findFreeSpace(engine: Engine, w: number, h: number): { x: number; y: number } {
  const cam = engine.camera;
  const centre = cam.screenToWorld(engine.width / 2, engine.height / 2);
  const startX = centre.x - w / 2;
  const startY = centre.y - h / 2;

  const stepX = Math.max(w * 0.55, 240);
  const stepY = Math.max(h * 0.55, 200);
  const pad = 40;

  const isFree = (x: number, y: number): boolean => {
    const rect: Rect = { x: x - pad, y: y - pad, w: w + pad * 2, h: h + pad * 2 };
    for (const id of engine.index.query(rect)) {
      const b = engine.index.getBounds(id);
      if (!b) continue;
      if (!(b.x + b.w < rect.x || b.x > rect.x + rect.w || b.y + b.h < rect.y || b.y > rect.y + rect.h)) {
        return false;
      }
    }
    return true;
  };

  if (isFree(startX, startY)) return { x: startX, y: startY };

  // Square spiral: ring by ring outward from centre.
  for (let ring = 1; ring <= 14; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        // Only the perimeter of this ring — the interior was covered by earlier rings.
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const x = startX + dx * stepX;
        const y = startY + dy * stepY;
        if (isFree(x, y)) return { x, y };
      }
    }
  }

  // Everything nearby is occupied — drop it below the lowest existing shape.
  const total = engine.index.totalBounds();
  return total ? { x: total.x, y: total.y + total.h + 120 } : { x: startX, y: startY };
}

// ---------------------------------------------------------------------------
// Brainstorm → themed sticky columns
// ---------------------------------------------------------------------------

export function layoutBrainstorm(
  data: BrainstormOutput,
  engine: Engine,
  userId: string,
  zs: string[],
): Shape[] {
  const ctx: Ctx = { userId, zs };
  const shapes: Shape[] = [];

  const colWidth = STICKY + COLUMN_GAP;
  const tallest = Math.max(...data.themes.map((t) => t.ideas.length));
  const totalW = data.themes.length * colWidth - COLUMN_GAP;
  // +1 row for the theme header note.
  const totalH = (tallest + 1) * (STICKY + GAP);

  const origin = findFreeSpace(engine, totalW, totalH);
  let i = 0;

  data.themes.forEach((theme, col) => {
    const colour = STICKY_COLORS[col % STICKY_COLORS.length]!;
    const x = origin.x + col * colWidth;

    // Header note: the theme label, in a darker tint of the column colour so the column reads
    // as a group at a glance.
    shapes.push({
      ...base(ctx, i++),
      type: 'sticky',
      x,
      y: origin.y,
      w: STICKY,
      h: 72,
      text: theme.label,
      color: darken(colour, 0.14),
      fontSize: 17,
      tags: ['theme'],
    } as Shape);

    theme.ideas.forEach((idea, row) => {
      shapes.push({
        ...base(ctx, i++),
        type: 'sticky',
        x,
        y: origin.y + 72 + GAP + row * (STICKY + GAP),
        w: STICKY,
        h: STICKY,
        text: idea,
        color: colour,
        fontSize: 16,
        tags: [],
      } as Shape);
    });
  });

  return shapes;
}

// ---------------------------------------------------------------------------
// Cluster → labelled frames around existing notes
// ---------------------------------------------------------------------------

export interface ClusterPlan {
  frames: Shape[];
  moves: Array<{ id: string; x: number; y: number }>;
}

/**
 * Group existing notes into labelled frames.
 *
 * Verifies the partition is complete: any note the model failed to assign lands in "Unsorted"
 * rather than being silently dropped. A clustering feature that loses notes is worse than no
 * clustering feature.
 */
export function layoutClusters(
  data: ClusterOutput,
  noteIds: string[],
  engine: Engine,
  userId: string,
  zs: string[],
): ClusterPlan {
  const ctx: Ctx = { userId, zs };

  const assigned = new Set<string>();
  const clusters = data.clusters.map((c) => ({
    label: c.label,
    // Drop ids the model invented, and keep only the first assignment of any duplicate.
    noteIds: c.noteIds.filter((id) => {
      if (assigned.has(id) || !noteIds.includes(id)) return false;
      assigned.add(id);
      return true;
    }),
  }));

  const orphans = noteIds.filter((id) => !assigned.has(id));
  if (orphans.length > 0) clusters.push({ label: 'Unsorted', noteIds: orphans });

  const live = clusters.filter((c) => c.noteIds.length > 0);

  const PAD = 28;
  const HEADER = 34;
  const frames: Shape[] = [];
  const moves: Array<{ id: string; x: number; y: number }> = [];

  // Size every frame first so the row layout can be computed in one pass.
  const sized = live.map((c) => {
    const cols = Math.ceil(Math.sqrt(c.noteIds.length));
    const rows = Math.ceil(c.noteIds.length / cols);
    return {
      ...c,
      cols,
      w: cols * STICKY + (cols - 1) * GAP + PAD * 2,
      h: rows * STICKY + (rows - 1) * GAP + PAD * 2 + HEADER,
    };
  });

  const totalW = sized.reduce((sum, c) => sum + c.w + 48, -48);
  const maxH = Math.max(...sized.map((c) => c.h));
  const origin = findFreeSpace(engine, totalW, maxH);

  let cursorX = origin.x;
  let i = 0;

  for (const cluster of sized) {
    frames.push({
      ...base(ctx, i++),
      type: 'frame',
      x: cursorX,
      y: origin.y,
      w: cluster.w,
      h: cluster.h,
      name: cluster.label,
      color: 'var(--chrome-fg-dim)',
      clipsContent: false,
    } as Shape);

    cluster.noteIds.forEach((id, idx) => {
      const col = idx % cluster.cols;
      const row = Math.floor(idx / cluster.cols);
      moves.push({
        id,
        x: cursorX + PAD + col * (STICKY + GAP),
        y: origin.y + HEADER + PAD + row * (STICKY + GAP),
      });
    });

    cursorX += cluster.w + 48;
  }

  return { frames, moves };
}

// ---------------------------------------------------------------------------
// Diagram cleanup → normalised grid ⭐ the demo moment
// ---------------------------------------------------------------------------

const ROLE_SIZE: Record<string, { w: number; h: number }> = {
  start: { w: 150, h: 60 },
  end: { w: 150, h: 60 },
  process: { w: 170, h: 84 },
  decision: { w: 150, h: 150 },
  data: { w: 170, h: 84 },
  note: { w: 170, h: 84 },
};

export interface CleanupMove {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  role: string;
}

/**
 * Normalise a rough selection onto a grid.
 *
 * Validates that the model returned EXACTLY the input ids — no inventions, no omissions. A
 * cleanup that silently drops a shape destroys the user's work, so this fails loudly instead.
 */
export function layoutCleanup(
  data: CleanupOutput,
  selected: Shape[],
): { moves: CleanupMove[]; error?: string } {
  const inputIds = new Set(selected.map((s) => s.id));
  const returned = new Set(data.layout.map((l) => l.id));

  for (const l of data.layout) {
    if (!inputIds.has(l.id)) {
      return { moves: [], error: `The AI referenced a shape that isn't in your selection.` };
    }
  }
  for (const id of inputIds) {
    if (!returned.has(id)) {
      return { moves: [], error: `The AI dropped one of your shapes. Nothing was changed.` };
    }
  }

  const cellW = Math.max(...data.layout.map((l) => ROLE_SIZE[l.role]?.w ?? 170)) + 90;
  const cellH = Math.max(...data.layout.map((l) => ROLE_SIZE[l.role]?.h ?? 84)) + 80;

  // Anchor the result on the selection's existing top-left, so the diagram cleans up in place
  // rather than jumping somewhere else on the board.
  let minX = Infinity;
  let minY = Infinity;
  for (const s of selected) {
    const b = shapeBounds(s);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
  }

  const vertical = data.orientation === 'vertical';

  const moves = data.layout.map((l) => {
    const size = ROLE_SIZE[l.role] ?? ROLE_SIZE.process!;
    const gx = vertical ? l.col : l.row;
    const gy = vertical ? l.row : l.col;
    return {
      id: l.id,
      // Centre each shape in its cell so mixed sizes stay visually aligned.
      x: minX + gx * cellW + (cellW - 90 - size.w) / 2,
      y: minY + gy * cellH + (cellH - 80 - size.h) / 2,
      w: size.w,
      h: size.h,
      role: l.role,
    };
  });

  return { moves };
}

// ---------------------------------------------------------------------------
// Mind map → radial tree
// ---------------------------------------------------------------------------

export function layoutMindmap(
  data: MindmapOutput,
  engine: Engine,
  userId: string,
  zs: string[],
): Shape[] {
  const ctx: Ctx = { userId, zs };
  const shapes: Shape[] = [];
  let i = 0;

  const R1 = 300;
  const R2 = 560;
  const origin = findFreeSpace(engine, R2 * 2 + 200, R2 * 2 + 200);
  const cx = origin.x + R2 + 100;
  const cy = origin.y + R2 + 100;

  const node = (label: string, x: number, y: number, level: number): Shape => {
    const w = Math.max(120, Math.min(240, label.length * 9 + 36));
    const h = level === 0 ? 64 : 48;
    return {
      ...base(ctx, i++),
      type: 'rect',
      x: x - w / 2,
      y: y - h / 2,
      w,
      h,
      stroke: 'var(--canvas-ink)',
      fill: level === 0 ? '#00000014' : 'transparent',
      strokeWidth: level === 0 ? 3 : 2,
      dash: 'solid',
      radius: 24,
      text: label,
      textAlign: 'center',
      fontSize: level === 0 ? 18 : 15,
    } as Shape;
  };

  const edge = (x1: number, y1: number, x2: number, y2: number): Shape => {
    const pts: Point[] = [
      [0, 0],
      [x2 - x1, y2 - y1],
    ];
    return {
      ...base(ctx, i++),
      type: 'line',
      x: x1,
      y: y1,
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
      points: pts,
      stroke: 'var(--chrome-fg-dim)',
      strokeWidth: 1.5,
      dash: 'solid',
      arrowheads: [false, false],
      label: '',
    } as Shape;
  };

  shapes.push(node(data.root.label, cx, cy, 0));

  const children = (data.root.children ?? []).slice(0, 8);
  const total = children.length || 1;

  children.forEach((child: MindMapNode, idx) => {
    // Start at -90° so the first branch sits at the top; it reads as a clock face.
    const angle = (idx / total) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(angle) * R1;
    const y1 = cy + Math.sin(angle) * R1;

    shapes.push(edge(cx, cy, x1, y1));
    shapes.push(node(child.label, x1, y1, 1));

    const grandkids = (child.children ?? []).slice(0, 5);
    if (grandkids.length === 0) return;

    // Each branch owns an angular sector, so level-2 nodes never cross into a sibling's space.
    const sector = (Math.PI * 2) / total;
    grandkids.forEach((gk, gi) => {
      const spread = sector * 0.72;
      const a =
        angle - spread / 2 + (grandkids.length === 1 ? spread / 2 : (gi / (grandkids.length - 1)) * spread);
      const x2 = cx + Math.cos(a) * R2;
      const y2 = cy + Math.sin(a) * R2;
      shapes.push(edge(x1, y1, x2, y2));
      shapes.push(node(gk.label, x2, y2, 2));
    });
  });

  return shapes;
}

// ---------------------------------------------------------------------------

function darken(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const int = parseInt(m[1]!, 16);
  const r = Math.max(0, Math.round(((int >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.round(((int >> 8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.round((int & 255) * (1 - amount)));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
