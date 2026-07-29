import { WebsocketProvider } from 'y-websocket';
import type { Engine } from '@board/canvas-engine';
import { AWARENESS_THROTTLE_MS, PARTICIPANT_HUES, type PresenceState, type ShapeId } from '@board/shared';
import type { BoardDoc } from './BoardDoc';
import { pickFreeColor, type Identity } from './identity';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface Peer {
  clientId: number;
  state: PresenceState;
  /** Interpolated cursor position, so remote cursors glide instead of teleporting. */
  render: { x: number; y: number } | null;
}

/**
 * A live board session: the websocket provider plus awareness (presence).
 *
 * Awareness is deliberately separate from the document. Cursors are ephemeral — they must never
 * be persisted, never appear in undo history, and never survive a disconnect. Yjs gives us that
 * for free provided we keep them out of the doc, which is exactly what this class enforces.
 */
export class Session {
  readonly provider: WebsocketProvider;
  private readonly peers = new Map<number, Peer>();

  status: ConnectionStatus = 'connecting';
  onStatusChange: ((s: ConnectionStatus) => void) | null = null;
  onPeersChange: ((peers: Peer[]) => void) | null = null;

  private lastCursorSent = 0;
  private raf = 0;
  private followingClientId: number | null = null;

  constructor(
    doc: BoardDoc,
    private readonly engine: Engine,
    readonly code: string,
    identity: Identity,
    readonly readOnly: boolean,
    wsUrl: string,
    token: string,
  ) {
    this.provider = new WebsocketProvider(wsUrl, code, doc.doc, {
      connect: true,
      // y-websocket serializes these as query parameters after the room path. The server verifies
      // this token during the upgrade, before it sends document data or accepts edits.
      params: { token },
    });

    // Claim a colour nobody else in the room is using.
    const taken = new Set<number>();
    this.provider.awareness.getStates().forEach((s) => {
      const p = s as unknown as PresenceState;
      if (typeof p?.colorIndex === 'number') taken.add(p.colorIndex);
    });

    const initial: PresenceState = {
      userId: identity.userId,
      name: identity.name,
      colorIndex: pickFreeColor(identity.colorIndex, taken),
      cursor: null,
      selection: [],
      camera: null,
      following: null,
      inCall: false,
      muted: true,
      cameraOn: false,
      isSpeaking: false,
    };
    this.provider.awareness.setLocalState(initial as unknown as Record<string, unknown>);

    this.provider.on('status', ({ status }: { status: string }) => {
      const next: ConnectionStatus =
        status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected';
      if (next === this.status) return;
      this.status = next;
      this.onStatusChange?.(next);
    });

    this.provider.awareness.on('change', () => this.syncPeers());
    this.syncPeers();

    this.startCursorInterpolation();
  }

  get localState(): PresenceState | null {
    return (this.provider.awareness.getLocalState() as unknown as PresenceState) ?? null;
  }

  get clientId(): number {
    return this.provider.awareness.clientID;
  }

  getPeers(): Peer[] {
    return [...this.peers.values()];
  }

  // -------------------------------------------------------------------------

  private syncPeers(): void {
    const states = this.provider.awareness.getStates();
    const seen = new Set<number>();

    states.forEach((raw, clientId) => {
      if (clientId === this.provider.awareness.clientID) return;
      const state = raw as unknown as PresenceState;
      if (!state?.userId) return;
      seen.add(clientId);

      const existing = this.peers.get(clientId);
      if (existing) {
        existing.state = state;
      } else {
        this.peers.set(clientId, {
          clientId,
          state,
          // Start at the true position: interpolating a brand-new cursor from (0,0) makes it
          // fly across the board on join.
          render: state.cursor ? { ...state.cursor } : null,
        });
      }
    });

    for (const clientId of [...this.peers.keys()]) {
      if (!seen.has(clientId)) this.peers.delete(clientId);
    }

    this.engine.markOverlayDirty();
    this.onPeersChange?.(this.getPeers());
  }

  /**
   * Ease remote cursors toward their last reported position.
   *
   * Awareness arrives at ~30Hz. Snapping to each update reads as teleporting; a short ease
   * makes another person's cursor feel like a hand rather than a ping.
   */
  private startCursorInterpolation(): void {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      if (this.peers.size === 0) return;

      let moved = false;
      for (const peer of this.peers.values()) {
        const target = peer.state.cursor;
        if (!target) {
          if (peer.render) {
            peer.render = null;
            moved = true;
          }
          continue;
        }
        if (!peer.render) {
          peer.render = { ...target };
          moved = true;
          continue;
        }
        if (reduceMotion) {
          peer.render = { ...target };
          moved = true;
          continue;
        }
        const dx = target.x - peer.render.x;
        const dy = target.y - peer.render.y;
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) continue;
        // ~80ms catch-up.
        peer.render.x += dx * 0.25;
        peer.render.y += dy * 0.25;
        moved = true;
      }
      if (moved) this.engine.markOverlayDirty();

      if (this.followingClientId !== null) this.applyFollow();
    };
    this.raf = requestAnimationFrame(tick);
  }

  // -------------------------------------------------------------------------
  // Local state updates
  // -------------------------------------------------------------------------

  setCursor(world: { x: number; y: number } | null): void {
    const now = performance.now();
    // Throttle: a pointer fires far faster than 30Hz and every update is a network message.
    if (world && now - this.lastCursorSent < AWARENESS_THROTTLE_MS) return;
    this.lastCursorSent = now;
    this.patchLocal({ cursor: world });
  }

  setSelection(ids: ShapeId[]): void {
    this.patchLocal({ selection: ids });
  }

  setCamera(): void {
    const c = this.engine.camera;
    this.patchLocal({ camera: { x: c.x, y: c.y, zoom: c.zoom } });
  }

  setMedia(patch: Partial<Pick<PresenceState, 'inCall' | 'muted' | 'cameraOn' | 'isSpeaking'>>): void {
    this.patchLocal(patch);
  }

  setName(name: string): void {
    this.patchLocal({ name });
  }

  private patchLocal(patch: Partial<PresenceState>): void {
    const current = this.localState;
    if (!current) return;
    this.provider.awareness.setLocalState({
      ...current,
      ...patch,
    } as unknown as Record<string, unknown>);
  }

  // -------------------------------------------------------------------------
  // Follow / jump
  // -------------------------------------------------------------------------

  jumpTo(clientId: number): void {
    const peer = this.peers.get(clientId);
    const camera = peer?.state.camera;
    if (!camera) return;
    this.engine.camera.x = camera.x;
    this.engine.camera.y = camera.y;
    this.engine.camera.zoom = camera.zoom;
    this.engine.markDirty();
    this.engine.markOverlayDirty();
  }

  follow(clientId: number | null): void {
    this.followingClientId = clientId;
    this.patchLocal({ following: clientId === null ? null : String(clientId) });
  }

  get following(): number | null {
    return this.followingClientId;
  }

  private applyFollow(): void {
    if (this.followingClientId === null) return;
    const peer = this.peers.get(this.followingClientId);
    if (!peer?.state.camera) return;
    const cam = this.engine.camera;
    const target = peer.state.camera;
    if (
      Math.abs(cam.x - target.x) < 0.5 &&
      Math.abs(cam.y - target.y) < 0.5 &&
      Math.abs(cam.zoom - target.zoom) < 0.001
    ) {
      return;
    }
    cam.x += (target.x - cam.x) * 0.2;
    cam.y += (target.y - cam.y) * 0.2;
    cam.zoom += (target.zoom - cam.zoom) * 0.2;
    this.engine.markDirty();
    this.engine.markOverlayDirty();
  }

  /** Colour for a peer, resolved against the ACTIVE theme's lightness/chroma. */
  colorFor(colorIndex: number): string {
    const style = getComputedStyle(document.documentElement);
    const l = style.getPropertyValue('--p-l').trim() || '55%';
    const c = style.getPropertyValue('--p-c').trim() || '0.14';
    const hue = PARTICIPANT_HUES[colorIndex % PARTICIPANT_HUES.length] ?? 12;
    return `oklch(${l} ${c} ${hue})`;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    // Clear presence explicitly. Without this the peer's cursor and avatar linger for everyone
    // else until the awareness timeout expires.
    this.provider.awareness.setLocalState(null);
    this.provider.destroy();
    this.peers.clear();
  }
}
