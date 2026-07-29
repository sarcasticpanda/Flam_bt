import type { Point, Shape } from '@board/shared';
import { STICKY_COLORS } from '@board/shared';

/**
 * Dev-only shape seeder — the verification harness for every performance claim in this project.
 *
 * Built in Block A rather than at the end, deliberately. A performance target you cannot measure
 * is a wish. This is what turns "handles 10k shapes" into a number.
 *
 * The mix matters as much as the count. Ten thousand identical rects in one cluster tests
 * nothing: it is trivially cullable and has one style. Real boards are a spread of pen strokes
 * (expensive paths), text (expensive layout), and stickies (fills + wrapped text) scattered over
 * a large area — so that is what this generates.
 */

/** Deterministic PRNG so a perf run is reproducible and regressions are comparable. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'auth', 'cache', 'queue', 'retry', 'index', 'schema', 'render', 'cursor',
  'merge', 'sync', 'layer', 'budget', 'signal', 'batch', 'origin', 'commit',
];

export interface SeedOptions {
  count: number;
  /** World-space square the shapes are spread across. */
  spread?: number;
  seed?: number;
  userId?: string;
}

export function seedShapes({
  count,
  spread = 24_000,
  seed = 1337,
  userId = 'seed',
}: SeedOptions): Shape[] {
  const rand = mulberry32(seed);
  const out: Shape[] = [];
  const now = Date.now();

  // Fractional indices must be distinct and ordered, but generateKeyBetween in a tight loop is
  // measurable at 50k. Zero-padded ordinals sort identically as strings and cost nothing.
  const zAt = (i: number) => `s${String(i).padStart(7, '0')}`;

  for (let i = 0; i < count; i++) {
    const x = (rand() - 0.5) * spread;
    const y = (rand() - 0.5) * spread;
    const roll = rand();

    const base = {
      id: `seed_${i}`,
      x,
      y,
      rotation: rand() < 0.08 ? (rand() - 0.5) * 0.6 : 0,
      z: zAt(i),
      parentId: null,
      locked: false,
      opacity: 1,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      meta: { seeded: true },
    };

    if (roll < 0.34) {
      // Boxes — the cheap baseline.
      const w = 80 + rand() * 200;
      const h = 60 + rand() * 140;
      out.push({
        ...base,
        type: rand() < 0.75 ? 'rect' : 'ellipse',
        w,
        h,
        stroke: 'var(--canvas-ink)',
        fill: rand() < 0.3 ? '#00000010' : 'transparent',
        strokeWidth: rand() < 0.8 ? 2 : 4,
        dash: 'solid',
        radius: 4,
        text: rand() < 0.35 ? pick(rand, WORDS) : '',
        textAlign: 'center',
        fontSize: 16,
      } as Shape);
    } else if (roll < 0.62) {
      // Pen strokes — the expensive path. Bezier construction dominates draw cost.
      const n = 12 + Math.floor(rand() * 40);
      const points: Point[] = [];
      let px = 0;
      let py = 0;
      for (let p = 0; p < n; p++) {
        px += (rand() - 0.5) * 26;
        py += (rand() - 0.5) * 26;
        points.push([px, py]);
      }
      const b = boundsOf(points);
      out.push({
        ...base,
        type: 'draw',
        w: b.w,
        h: b.h,
        points,
        stroke: 'var(--canvas-ink)',
        strokeWidth: 1 + rand() * 5,
        blend: 'normal',
      } as Shape);
    } else if (roll < 0.82) {
      // Stickies — fill plus wrapped, auto-shrinking text.
      out.push({
        ...base,
        type: 'sticky',
        w: 180,
        h: 180,
        text: `${pick(rand, WORDS)} ${pick(rand, WORDS)} ${pick(rand, WORDS)}`,
        color: STICKY_COLORS[Math.floor(rand() * STICKY_COLORS.length)]!,
        fontSize: 16,
        tags: [],
      } as Shape);
    } else if (roll < 0.94) {
      // Text — the most expensive per-shape layout.
      out.push({
        ...base,
        type: 'text',
        w: 220,
        h: 28,
        text: `${pick(rand, WORDS)} ${pick(rand, WORDS)}`,
        fontSize: 18,
        fontFamily: '"Geist Sans", system-ui, sans-serif',
        color: 'var(--canvas-ink)',
        align: 'left',
        autoWidth: true,
      } as Shape);
    } else {
      // Arrows — stroke plus arrowhead fill.
      const dx = (rand() - 0.5) * 400;
      const dy = (rand() - 0.5) * 400;
      const points: Point[] = [
        [0, 0],
        [dx, dy],
      ];
      const b = boundsOf(points);
      out.push({
        ...base,
        type: 'arrow',
        w: b.w,
        h: b.h,
        points,
        stroke: 'var(--canvas-ink)',
        strokeWidth: 2,
        dash: 'solid',
        arrowheads: [false, true],
        label: '',
        bindStart: null,
        bindEnd: null,
      } as Shape);
    }
  }

  return out;
}

function pick(rand: () => number, arr: readonly string[]): string {
  return arr[Math.floor(rand() * arr.length)] ?? arr[0]!;
}

function boundsOf(points: readonly Point[]): { w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { w: maxX - minX, h: maxY - minY };
}
