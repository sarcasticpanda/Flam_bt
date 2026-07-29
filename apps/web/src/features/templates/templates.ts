import { STICKY_COLORS, newShapeId, type Point, type Shape } from '@board/shared';

/**
 * Starter templates.
 *
 * Every template is a pure function of (origin, z-indices) → shapes, so a template is just
 * ordinary board content the moment it lands. Nothing about a templated shape is special: it
 * can be moved, restyled, deleted, undone, and synced like anything you drew by hand.
 */

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  /** Rough footprint, used to place it in free space before building. */
  size: { w: number; h: number };
  build: (origin: { x: number; y: number }, z: (i: number) => string, userId: string) => Shape[];
}

function mk(userId: string, z: string) {
  const now = Date.now();
  return {
    id: newShapeId(),
    rotation: 0,
    z,
    parentId: null,
    locked: false,
    opacity: 1,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    meta: { template: true },
  };
}

function box(
  userId: string, z: string, x: number, y: number, w: number, h: number,
  text: string, opts: { radius?: number; fill?: string; fontSize?: number } = {},
): Shape {
  return {
    ...mk(userId, z),
    type: 'rect',
    x, y, w, h,
    stroke: 'var(--canvas-ink)',
    fill: opts.fill ?? 'transparent',
    strokeWidth: 2,
    dash: 'solid',
    radius: opts.radius ?? 6,
    text,
    textAlign: 'center',
    fontSize: opts.fontSize ?? 15,
  } as Shape;
}

function sticky(userId: string, z: string, x: number, y: number, text: string, color: string): Shape {
  return {
    ...mk(userId, z),
    type: 'sticky',
    x, y, w: 160, h: 160,
    text,
    color,
    fontSize: 15,
    tags: [],
  } as Shape;
}

function arrow(userId: string, z: string, x1: number, y1: number, x2: number, y2: number): Shape {
  const pts: Point[] = [[0, 0], [x2 - x1, y2 - y1]];
  return {
    ...mk(userId, z),
    type: 'arrow',
    x: x1, y: y1,
    w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    points: pts,
    stroke: 'var(--canvas-ink)',
    strokeWidth: 2,
    dash: 'solid',
    arrowheads: [false, true],
    label: '',
    bindStart: null,
    bindEnd: null,
  } as Shape;
}

function label(userId: string, z: string, x: number, y: number, text: string, size = 22): Shape {
  return {
    ...mk(userId, z),
    type: 'text',
    x, y, w: text.length * size * 0.56, h: size * 1.4,
    text,
    fontSize: size,
    fontFamily: '"Geist Sans", system-ui, sans-serif',
    color: 'var(--canvas-ink)',
    align: 'left',
    autoWidth: true,
  } as Shape;
}

// ---------------------------------------------------------------------------

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'flowchart',
    name: 'Flowchart',
    description: 'Start, decision, two branches, end',
    size: { w: 620, h: 720 },
    build: (o, z, u) => {
      const cx = o.x + 230;
      return [
        box(u, z(0), cx, o.y, 160, 56, 'Start', { radius: 28, fill: '#00000010' }),
        arrow(u, z(1), cx + 80, o.y + 56, cx + 80, o.y + 130),
        box(u, z(2), cx, o.y + 130, 160, 76, 'Process'),
        arrow(u, z(3), cx + 80, o.y + 206, cx + 80, o.y + 280),
        box(u, z(4), cx - 10, o.y + 280, 180, 130, 'Decision?', { radius: 4 }),
        arrow(u, z(5), cx - 10, o.y + 345, cx - 150, o.y + 345),
        box(u, z(6), cx - 320, o.y + 310, 160, 70, 'No path'),
        arrow(u, z(7), cx + 80, o.y + 410, cx + 80, o.y + 490),
        box(u, z(8), cx, o.y + 490, 160, 70, 'Yes path'),
        arrow(u, z(9), cx + 80, o.y + 560, cx + 80, o.y + 630),
        box(u, z(10), cx, o.y + 630, 160, 56, 'End', { radius: 28, fill: '#00000010' }),
      ];
    },
  },
  {
    id: 'mindmap',
    name: 'Mind map',
    description: 'Central topic with four branches',
    size: { w: 900, h: 560 },
    build: (o, z, u) => {
      const cx = o.x + 450;
      const cy = o.y + 280;
      const out: Shape[] = [box(u, z(0), cx - 90, cy - 34, 180, 68, 'Central topic', { radius: 34, fill: '#00000012', fontSize: 17 })];
      const spots = [
        { x: cx - 380, y: cy - 190 }, { x: cx + 200, y: cy - 190 },
        { x: cx - 380, y: cy + 120 }, { x: cx + 200, y: cy + 120 },
      ];
      spots.forEach((s, i) => {
        out.push(arrow(u, z(1 + i * 2), cx, cy, s.x + 90, s.y + 30));
        out.push(box(u, z(2 + i * 2), s.x, s.y, 180, 60, `Branch ${i + 1}`, { radius: 30 }));
      });
      return out;
    },
  },
  {
    id: 'kanban',
    name: 'Kanban board',
    description: 'To do, in progress, done',
    size: { w: 780, h: 620 },
    build: (o, z, u) => {
      const cols = ['To do', 'In progress', 'Done'];
      const out: Shape[] = [];
      let i = 0;
      cols.forEach((name, c) => {
        const x = o.x + c * 260;
        out.push(label(u, z(i++), x, o.y, name, 20));
        out.push({
          ...mk(u, z(i++)),
          type: 'frame',
          x: x - 12, y: o.y + 36, w: 236, h: 540,
          name: '',
          color: 'var(--chrome-fg-dim)',
          clipsContent: false,
        } as Shape);
        for (let r = 0; r < 2; r++) {
          out.push(sticky(u, z(i++), x, o.y + 60 + r * 180, c === 0 ? 'Task' : '', STICKY_COLORS[c]!));
        }
      });
      return out;
    },
  },
  {
    id: 'swot',
    name: 'SWOT analysis',
    description: 'Four labelled quadrants',
    size: { w: 720, h: 560 },
    build: (o, z, u) => {
      const cells = [
        { t: 'Strengths', c: '#B6E3C6' }, { t: 'Weaknesses', c: '#F5A7A7' },
        { t: 'Opportunities', c: '#B7D9F2' }, { t: 'Threats', c: '#FBE39A' },
      ];
      const out: Shape[] = [];
      cells.forEach((cell, i) => {
        const x = o.x + (i % 2) * 360;
        const y = o.y + Math.floor(i / 2) * 280;
        out.push(box(u, z(i * 2), x, y, 340, 260, '', { fill: `${cell.c}55`, radius: 8 }));
        out.push(label(u, z(i * 2 + 1), x + 18, y + 16, cell.t, 18));
      });
      return out;
    },
  },
  {
    id: 'retro',
    name: 'Retrospective',
    description: 'Went well, to improve, actions',
    size: { w: 780, h: 520 },
    build: (o, z, u) => {
      const cols = [
        { t: 'Went well', c: STICKY_COLORS[5]! },
        { t: 'To improve', c: STICKY_COLORS[2]! },
        { t: 'Action items', c: STICKY_COLORS[4]! },
      ];
      const out: Shape[] = [];
      let i = 0;
      cols.forEach((col, c) => {
        const x = o.x + c * 260;
        out.push(label(u, z(i++), x, o.y, col.t, 19));
        for (let r = 0; r < 2; r++) out.push(sticky(u, z(i++), x, o.y + 44 + r * 180, '', col.c));
      });
      return out;
    },
  },
  {
    id: 'architecture',
    name: 'System diagram',
    description: 'Client, API, database, cache',
    size: { w: 760, h: 520 },
    build: (o, z, u) => [
      box(u, z(0), o.x + 280, o.y, 200, 76, 'Client'),
      arrow(u, z(1), o.x + 380, o.y + 76, o.x + 380, o.y + 170),
      box(u, z(2), o.x + 280, o.y + 170, 200, 76, 'API service'),
      arrow(u, z(3), o.x + 280, o.y + 208, o.x + 170, o.y + 208),
      box(u, z(4), o.x, o.y + 170, 170, 76, 'Cache'),
      arrow(u, z(5), o.x + 380, o.y + 246, o.x + 380, o.y + 340),
      box(u, z(6), o.x + 280, o.y + 340, 200, 76, 'Database'),
      arrow(u, z(7), o.x + 480, o.y + 208, o.x + 590, o.y + 208),
      box(u, z(8), o.x + 590, o.y + 170, 170, 76, 'Worker'),
    ],
  },
];
