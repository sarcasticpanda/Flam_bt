import type { Camera, Engine } from '@board/canvas-engine';
import { shapeBounds } from '@board/canvas-engine';
import type { Session } from '../collab/Session';

/**
 * Overlay painter: remote cursors, name labels, and remote selection outlines.
 *
 * Drawn on the dedicated overlay canvas so a cursor moving at 30Hz never forces the 10,000
 * committed shapes on the static layer to redraw.
 *
 * This is where the signature rule pays off: the entire interface is monochrome, so these
 * participant colours are the only chroma on screen and presence reads instantly.
 */
export function paintOverlay(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  engine: Engine,
  session: Session,
): void {
  const zoom = camera.zoom;
  const peers = session.getPeers();
  if (peers.length === 0) return;

  for (const peer of peers) {
    const color = session.colorFor(peer.state.colorIndex);

    // --- remote selection outlines -------------------------------------------------
    // Stops two people dragging the same shape blindly.
    for (const id of peer.state.selection ?? []) {
      const shape = engine.getShape(id);
      if (!shape) continue;
      const b = shapeBounds(shape);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }

    // --- cursor --------------------------------------------------------------------
    const pos = peer.render;
    if (!pos) continue;

    // Cursor and label are drawn at a FIXED screen size: a cursor that shrinks as you zoom out
    // becomes invisible exactly when you most need to see where someone is.
    const s = 1 / zoom;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.scale(s, s);

    // Arrow
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 17);
    ctx.lineTo(4.5, 12.8);
    ctx.lineTo(7.4, 19.2);
    ctx.lineTo(10.2, 17.9);
    ctx.lineTo(7.3, 11.6);
    ctx.lineTo(12.8, 11.2);
    ctx.closePath();
    ctx.fillStyle = color;
    // A hairline keeps the cursor legible against a same-coloured shape underneath.
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();

    // Name chip
    const name = peer.state.name || 'Someone';
    ctx.font = '500 11px "Geist Sans", system-ui, sans-serif';
    const textW = ctx.measureText(name).width;
    const chipW = textW + 14;
    const chipH = 19;

    ctx.beginPath();
    ctx.roundRect(14, 16, chipW, chipH, 9);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(name, 21, 16 + chipH / 2 + 0.5);

    // Speaking ring — presence state that came over awareness, not over the peer connection.
    if (peer.state.isSpeaking) {
      ctx.beginPath();
      ctx.arc(7, 8, 22, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
}
