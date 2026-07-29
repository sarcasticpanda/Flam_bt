import type { Shape } from '@board/shared';
import { LOD_MICRO_THRESHOLD, LOD_ZOOM_THRESHOLD } from '@board/shared';
import { strokePath } from './smoothing.js';
import { resolveColor, type ThemeColors } from './theme.js';

export interface RenderCtx {
  ctx: CanvasRenderingContext2D;
  zoom: number;
  theme: ThemeColors;
}

const DASH_PATTERNS: Record<string, number[]> = {
  solid: [],
  dashed: [10, 6],
  dotted: [2, 5],
};

/**
 * Draw one shape in world space. The camera transform is already applied.
 *
 * LOD is applied here rather than in the caller so every shape type gets to choose its own
 * degradation. At 10% zoom a page of text is a grey smear either way — the only question is
 * whether we spend 8ms laying it out first.
 */
export function drawShape(r: RenderCtx, shape: Shape): void {
  const { ctx, zoom } = r;

  const micro = zoom < LOD_MICRO_THRESHOLD;
  const low = zoom < LOD_ZOOM_THRESHOLD;

  // Below ~4 screen px nothing is legible. One filled rect conveys "something is here"
  // at a fraction of the cost.
  if (micro && shape.w * zoom < 4 && shape.h * zoom < 4) {
    ctx.fillStyle = r.theme.chromeFgDim;
    ctx.fillRect(shape.x, shape.y, Math.max(shape.w, 1 / zoom), Math.max(shape.h, 1 / zoom));
    return;
  }

  // save/restore is a full context-state push. At ~4,500 visible shapes that is thousands of
  // stack operations per frame for the overwhelmingly common case of an unrotated, opaque
  // shape — so only pay for it when the shape actually needs it.
  const needsTransform = shape.rotation !== 0;
  const needsState = needsTransform || shape.opacity !== 1 || shape.type === 'draw';

  if (needsState) {
    ctx.save();
    ctx.globalAlpha = shape.opacity;
  }

  if (needsTransform) {
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(shape.rotation);
    ctx.translate(-cx, -cy);
  }

  switch (shape.type) {
    case 'rect':
      drawRect(r, shape, low);
      break;
    case 'ellipse':
      drawEllipse(r, shape, low);
      break;
    case 'line':
    case 'arrow':
      drawLine(r, shape, low);
      break;
    case 'draw':
      drawFreehand(r, shape, low);
      break;
    case 'text':
      drawText(r, shape, low);
      break;
    case 'sticky':
      drawSticky(r, shape, low);
      break;
    case 'image':
      drawImage(r, shape);
      break;
    case 'frame':
      drawFrame(r, shape);
      break;
    case 'aiCard':
      drawAICard(r, shape, low);
      break;
  }

  if (needsState) ctx.restore();
}

// ---------------------------------------------------------------------------

function applyStroke(r: RenderCtx, color: string, width: number, dash: string): void {
  r.ctx.strokeStyle = resolveColor(color, r.theme);
  r.ctx.lineWidth = width;
  const pattern = DASH_PATTERNS[dash] ?? [];
  // setLineDash is expensive; only touch it when it actually changes from solid.
  r.ctx.setLineDash(pattern);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const rr = Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
}

function drawRect(r: RenderCtx, s: Extract<Shape, { type: 'rect' }>, low: boolean): void {
  const { ctx } = r;
  roundRectPath(ctx, s.x, s.y, s.w, s.h, s.radius);
  if (s.fill && s.fill !== 'transparent') {
    ctx.fillStyle = resolveColor(s.fill, r.theme);
    ctx.fill();
  }
  applyStroke(r, s.stroke, s.strokeWidth, s.dash);
  ctx.stroke();
  ctx.setLineDash([]);
  if (s.text && !low) drawCenteredText(r, s.text, s, s.fontSize, s.textAlign);
}

function drawEllipse(r: RenderCtx, s: Extract<Shape, { type: 'ellipse' }>, low: boolean): void {
  const { ctx } = r;
  ctx.beginPath();
  ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w) / 2, Math.abs(s.h) / 2, 0, 0, Math.PI * 2);
  if (s.fill && s.fill !== 'transparent') {
    ctx.fillStyle = resolveColor(s.fill, r.theme);
    ctx.fill();
  }
  applyStroke(r, s.stroke, s.strokeWidth, s.dash);
  ctx.stroke();
  ctx.setLineDash([]);
  if (s.text && !low) drawCenteredText(r, s.text, s, s.fontSize, s.textAlign);
}

function drawLine(
  r: RenderCtx,
  s: Extract<Shape, { type: 'line' | 'arrow' }>,
  low: boolean,
): void {
  const { ctx } = r;
  const pts = s.points;
  if (pts.length < 2) return;

  applyStroke(r, s.stroke, s.strokeWidth, s.dash);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s.x + pts[0]![0], s.y + pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(s.x + pts[i]![0], s.y + pts[i]![1]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (s.arrowheads[1]) {
    const a = pts[pts.length - 2]!;
    const b = pts[pts.length - 1]!;
    drawArrowhead(r, s.x + a[0], s.y + a[1], s.x + b[0], s.y + b[1], s.strokeWidth, s.stroke);
  }
  if (s.arrowheads[0]) {
    const a = pts[1]!;
    const b = pts[0]!;
    drawArrowhead(r, s.x + a[0], s.y + a[1], s.x + b[0], s.y + b[1], s.strokeWidth, s.stroke);
  }

  if (s.label && !low) {
    const mid = pts[Math.floor(pts.length / 2)]!;
    drawLabelChip(r, s.label, s.x + mid[0], s.y + mid[1]);
  }
}

function drawArrowhead(
  r: RenderCtx,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  width: number,
  color: string,
): void {
  const { ctx } = r;
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const size = Math.max(10, width * 3.5);
  ctx.fillStyle = resolveColor(color, r.theme);
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - size * Math.cos(angle - Math.PI / 7), toY - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(toX - size * Math.cos(angle + Math.PI / 7), toY - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function drawFreehand(r: RenderCtx, s: Extract<Shape, { type: 'draw' }>, low: boolean): void {
  const { ctx } = r;
  if (s.points.length === 0) return;

  ctx.strokeStyle = resolveColor(s.stroke, r.theme);
  ctx.lineWidth = s.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.blend === 'multiply') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.min(ctx.globalAlpha, 0.4);
  }

  if (low) {
    // Straight segments at low zoom: the Bezier construction is invisible below 25% and it is
    // the single most expensive path in the renderer at 10k shapes.
    ctx.beginPath();
    ctx.moveTo(s.x + s.points[0]![0], s.y + s.points[0]![1]);
    for (let i = 1; i < s.points.length; i += 2) {
      ctx.lineTo(s.x + s.points[i]![0], s.y + s.points[i]![1]);
    }
    ctx.stroke();
  } else {
    ctx.stroke(strokePath(s.points, s.x, s.y));
  }

  ctx.globalCompositeOperation = 'source-over';
}

function drawText(r: RenderCtx, s: Extract<Shape, { type: 'text' }>, low: boolean): void {
  const { ctx } = r;
  if (low) {
    // A grey bar reads as "text is here" without the layout cost.
    ctx.fillStyle = r.theme.chromeFgDim;
    ctx.globalAlpha *= 0.5;
    ctx.fillRect(s.x, s.y + s.h * 0.25, s.w, s.h * 0.5);
    return;
  }
  ctx.fillStyle = resolveColor(s.color, r.theme);
  ctx.font = `${s.fontSize}px ${s.fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = s.align === 'center' ? 'center' : s.align === 'right' ? 'right' : 'left';
  const anchorX = s.align === 'center' ? s.x + s.w / 2 : s.align === 'right' ? s.x + s.w : s.x;
  const lines = wrapText(ctx, s.text, s.autoWidth ? Infinity : s.w);
  lines.forEach((line, i) => ctx.fillText(line, anchorX, s.y + i * s.fontSize * 1.35));
}

function drawSticky(r: RenderCtx, s: Extract<Shape, { type: 'sticky' }>, low: boolean): void {
  const { ctx } = r;
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.roundRect(s.x, s.y, s.w, s.h, 3);
  ctx.fill();

  // A hairline keeps same-coloured notes distinguishable when they overlap.
  ctx.strokeStyle = 'rgba(0,0,0,.08)';
  ctx.lineWidth = 1 / r.zoom;
  ctx.stroke();

  if (low || !s.text) return;

  ctx.fillStyle = '#14161A';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const size = fitStickyFont(ctx, s.text, s.w - 24, s.h - 24, s.fontSize);
  ctx.font = `${size}px "Geist Sans", system-ui, sans-serif`;
  const lines = wrapText(ctx, s.text, s.w - 24);
  lines.forEach((line, i) => ctx.fillText(line, s.x + 12, s.y + 12 + i * size * 1.3));
}

function drawImage(r: RenderCtx, s: Extract<Shape, { type: 'image' }>): void {
  const { ctx } = r;
  const img = imageCache.get(s.url);
  if (img?.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, s.x, s.y, s.w, s.h);
    return;
  }
  if (!img) loadImage(s.url);
  ctx.fillStyle = r.theme.canvasGrid;
  ctx.fillRect(s.x, s.y, s.w, s.h);
}

function drawFrame(r: RenderCtx, s: Extract<Shape, { type: 'frame' }>): void {
  const { ctx } = r;
  ctx.strokeStyle = resolveColor(s.color, r.theme);
  ctx.lineWidth = 1.5 / r.zoom;
  ctx.setLineDash([]);
  ctx.strokeRect(s.x, s.y, s.w, s.h);

  ctx.fillStyle = resolveColor(s.color, r.theme);
  ctx.font = `${13 / r.zoom}px "Geist Sans", system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText(s.name, s.x, s.y - 6 / r.zoom);
}

function drawAICard(r: RenderCtx, s: Extract<Shape, { type: 'aiCard' }>, low: boolean): void {
  const { ctx } = r;
  ctx.fillStyle = r.theme.canvasBg;
  ctx.beginPath();
  ctx.roundRect(s.x, s.y, s.w, s.h, 10);
  ctx.fill();
  ctx.strokeStyle = r.theme.chromeFgDim;
  ctx.lineWidth = 1 / r.zoom;
  ctx.stroke();

  if (low) return;
  ctx.fillStyle = r.theme.canvasInk;
  ctx.font = `14px "Geist Sans", system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const lines = wrapText(ctx, s.markdown.replace(/[#*`]/g, ''), s.w - 32).slice(0, 40);
  lines.forEach((line, i) => ctx.fillText(line, s.x + 16, s.y + 16 + i * 20));
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function drawCenteredText(
  r: RenderCtx,
  text: string,
  box: { x: number; y: number; w: number; h: number },
  fontSize: number,
  align: string,
): void {
  const { ctx } = r;
  ctx.fillStyle = r.theme.canvasInk;
  ctx.font = `${fontSize}px "Geist Sans", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
  const x = align === 'left' ? box.x + 10 : align === 'right' ? box.x + box.w - 10 : box.x + box.w / 2;
  const lines = wrapText(ctx, text, box.w - 20);
  const startY = box.y + box.h / 2 - ((lines.length - 1) * fontSize * 1.3) / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, startY + i * fontSize * 1.3));
}

function drawLabelChip(r: RenderCtx, text: string, x: number, y: number): void {
  const { ctx } = r;
  ctx.font = `${12 / r.zoom}px "Geist Mono", monospace`;
  const w = ctx.measureText(text).width + 10 / r.zoom;
  const h = 18 / r.zoom;
  ctx.fillStyle = r.theme.canvasBg;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = r.theme.canvasInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** Greedy word wrap. Measured against the live ctx so it matches what actually renders. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.split('\n');
  const out: string[] = [];
  for (const para of paragraphs) {
    if (maxWidth === Infinity) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

/** Shrink sticky text until it fits, so a long note never overflows its square. */
function fitStickyFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxH: number,
  start: number,
): number {
  let size = start;
  while (size > 9) {
    ctx.font = `${size}px "Geist Sans", system-ui, sans-serif`;
    const lines = wrapText(ctx, text, maxW);
    if (lines.length * size * 1.3 <= maxH) return size;
    size -= 1;
  }
  return 9;
}

// ---------------------------------------------------------------------------
// Image cache — shapes store a URL, never bytes
// ---------------------------------------------------------------------------

const imageCache = new Map<string, HTMLImageElement>();
let onImageLoad: (() => void) | null = null;

export function setImageLoadCallback(fn: () => void): void {
  onImageLoad = fn;
}

function loadImage(url: string): void {
  if (imageCache.has(url)) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  // Mark dirty when it lands, or the image stays invisible until the next unrelated redraw.
  img.onload = () => onImageLoad?.();
  imageCache.set(url, img);
}
