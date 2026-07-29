import type { Engine } from '@board/canvas-engine';
import { drawShape, shapesBounds } from '@board/canvas-engine';
import { boardExportSchema, type Shape } from '@board/shared';
import type { BoardDoc } from '../../collab/BoardDoc';

/**
 * PNG export.
 *
 * Renders to an offscreen canvas at the requested scale rather than screenshotting the live
 * one — the live canvas is sized to the viewport and DPR, so grabbing it would export whatever
 * happened to be on screen at whatever resolution the display happened to be.
 */
export function exportPNG(
  engine: Engine,
  opts: { scale?: number; transparent?: boolean; padding?: number } = {},
): void {
  const { scale = 2, transparent = false, padding = 48 } = opts;

  const shapes = engine.allShapes();
  if (shapes.length === 0) return;

  const bounds = shapesBounds(shapes);
  if (!bounds) return;

  const w = Math.ceil((bounds.w + padding * 2) * scale);
  const h = Math.ceil((bounds.h + padding * 2) * scale);

  // Browsers refuse canvases beyond ~16k on a side; fail visibly rather than silently
  // producing a blank image.
  if (w > 16384 || h > 16384) {
    throw new Error('That board is too large to export at this scale. Try 1x.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create an export canvas.');

  const theme = engine.getTheme();
  if (!transparent) {
    ctx.fillStyle = theme.canvasBg;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.setTransform(scale, 0, 0, scale, (-bounds.x + padding) * scale, (-bounds.y + padding) * scale);

  // Draw in z-order at zoom 1, so LOD never kicks in and the export is always full fidelity.
  const sorted = [...shapes].sort((a, b) => (a.z < b.z ? -1 : 1));
  for (const shape of sorted) drawShape({ ctx, zoom: 1, theme }, shape);

  canvas.toBlob((blob) => {
    if (blob) download(blob, `board-${Date.now()}.png`);
  }, 'image/png');
}

/**
 * JSON export.
 *
 * Also the fastest debugging tool in the project: a full round-trip proves the shape schema,
 * the validators, and the document layer all agree.
 */
export function exportJSON(doc: BoardDoc, title: string): void {
  const payload = doc.toJSON(title);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  download(blob, `${slug(title)}-${Date.now()}.json`);
}

export async function importJSON(doc: BoardDoc, file: File): Promise<number> {
  const text = await file.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  // Validate before touching the document — an imported file is untrusted input, and a
  // half-applied import is worse than a rejected one.
  const result = boardExportSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error('That file is not a board export.');
  }

  doc.loadJSON(result.data.shapes as Shape[]);
  return result.data.shapes.length;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on the next tick; revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
}
