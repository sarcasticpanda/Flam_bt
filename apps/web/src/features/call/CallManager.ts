import { io, type Socket } from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { MAX_CALL_PEERS, RTC_NAMESPACE, type RtcPeer } from '@board/shared';

export interface CallParticipant {
  peerId: string;
  userId: string;
  name: string;
  colorIndex: number;
  stream: MediaStream | null;
  muted: boolean;
  cameraOn: boolean;
  speaking: boolean;
  /** Set when the peer connection failed, so the tile can say WHY instead of sitting blank. */
  error: string | null;
}

export type CallState = 'idle' | 'connecting' | 'in-call' | 'error';

/**
 * WebRTC mesh call layer.
 *
 * The call is a LAYER over the workspace, never a mode that takes it over — the canvas stays
 * fully interactive while a call is running. That is a product requirement, not an
 * implementation detail.
 *
 * Mesh topology: N peers means N-1 connections each, so upstream bandwidth grows linearly per
 * participant. Hard-capped at 6; an SFU (LiveKit/mediasoup) is the documented upgrade path.
 */
export class CallManager {
  private socket: Socket | null = null;
  private peers = new Map<string, SimplePeer.Instance>();
  private participants = new Map<string, CallParticipant>();
  private localStream: MediaStream | null = null;

  private audioCtx: AudioContext | null = null;
  private analysers = new Map<string, { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }>();
  private speakingRaf = 0;

  state: CallState = 'idle';
  error: string | null = null;

  onChange: (() => void) | null = null;
  /** Local speaking/mute state is published to Yjs awareness by the caller. */
  onLocalMedia: ((p: { muted: boolean; cameraOn: boolean; speaking: boolean }) => void) | null = null;

  muted = false;
  cameraOn = false;
  localSpeaking = false;

  constructor(
    private readonly room: string,
    private readonly identity: { userId: string; name: string; colorIndex: number },
    private readonly token: string,
  ) {}

  getParticipants(): CallParticipant[] {
    return [...this.participants.values()];
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  // -------------------------------------------------------------------------

  async join(withVideo: boolean): Promise<void> {
    if (this.state === 'in-call' || this.state === 'connecting') return;
    this.state = 'connecting';
    this.error = null;
    this.emit();

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: withVideo ? { width: 640, height: 480 } : false,
      });
      this.cameraOn = withVideo;
    } catch (err) {
      // Every failure mode gets a SPECIFIC message. "Could not start call" tells the user
      // nothing about what to do next.
      const name = (err as DOMException)?.name;
      if (withVideo && (name === 'NotFoundError' || name === 'OverconstrainedError')) {
        // No camera is not a reason to fail the whole call — fall back to audio.
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.cameraOn = false;
          this.error = 'No camera found — joined with audio only.';
        } catch (audioErr) {
          this.fail(describeMediaError(audioErr));
          return;
        }
      } else {
        this.fail(describeMediaError(err));
        return;
      }
    }

    this.startSpeakingDetection();
    this.connectSignaling();
  }

  private fail(message: string): void {
    this.state = 'error';
    this.error = message;
    this.emit();
  }

  private connectSignaling(): void {
    const base = import.meta.env.VITE_SERVER_HTTP || location.origin;
    this.socket = io(`${base}${RTC_NAMESPACE}`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token: this.token },
    });

    this.socket.on('connect', () => {
      this.socket?.emit('rtc:join', {
        room: this.room,
        colorIndex: this.identity.colorIndex,
      });
    });

    // Existing peers: WE initiate to each of them. The server sends this before announcing us,
    // so exactly one side of every pair initiates and nobody double-offers.
    this.socket.on('rtc:peers', ({ peers }: { peers: RtcPeer[] }) => {
      this.state = 'in-call';
      for (const peer of peers) this.createPeer(peer, true);
      this.emit();
    });

    this.socket.on('rtc:peer-joined', ({ peer }: { peer: RtcPeer }) => {
      this.createPeer(peer, false);
      this.emit();
    });

    this.socket.on('rtc:signal', ({ from, data }: { from: string; data: unknown }) => {
      const peer = this.peers.get(from);
      if (!peer) return;
      try {
        peer.signal(data as SimplePeer.SignalData);
      } catch {
        /* stale signal for a torn-down peer */
      }
    });

    this.socket.on('rtc:peer-left', ({ peerId }: { peerId: string }) => {
      this.destroyPeer(peerId);
      this.emit();
    });

    this.socket.on('rtc:full', ({ limit }: { limit: number }) => {
      this.fail(`This call is full (${limit} people max).`);
      this.leave();
    });

    this.socket.on('rtc:forbidden', () => this.fail('You no longer have access to this board.'));
    this.socket.on('connect_error', () => this.fail('Sign in to join this call.'));
  }

  private createPeer(info: RtcPeer, initiator: boolean): void {
    if (this.peers.has(info.peerId) || this.peers.size >= MAX_CALL_PEERS) return;

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream: this.localStream ?? undefined,
      config: {
        // Google's public STUN. No TURN server is running, so peers behind symmetric NAT
        // will fail to connect — a documented limitation, not a surprise.
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
      },
    });

    this.participants.set(info.peerId, {
      peerId: info.peerId,
      userId: info.userId,
      name: info.name,
      colorIndex: info.colorIndex,
      stream: null,
      muted: false,
      cameraOn: false,
      speaking: false,
      error: null,
    });

    peer.on('signal', (data) => {
      this.socket?.emit('rtc:signal', { room: this.room, to: info.peerId, data });
    });

    peer.on('stream', (stream: MediaStream) => {
      const p = this.participants.get(info.peerId);
      if (!p) return;
      p.stream = stream;
      p.cameraOn = stream.getVideoTracks().some((t) => t.enabled);
      this.attachAnalyser(info.peerId, stream);
      this.emit();
    });

    peer.on('error', () => {
      const p = this.participants.get(info.peerId);
      if (p) {
        // Almost always NAT traversal. Name it rather than showing a dead tile.
        p.error = 'Connection failed (likely a restrictive network)';
        this.emit();
      }
    });

    peer.on('close', () => {
      this.destroyPeer(info.peerId);
      this.emit();
    });

    this.peers.set(info.peerId, peer);
  }

  private destroyPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      try {
        peer.destroy();
      } catch {
        /* already destroyed */
      }
    }
    this.peers.delete(peerId);
    this.participants.delete(peerId);
    this.analysers.delete(peerId);
  }

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  toggleMute(): void {
    this.muted = !this.muted;
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !this.muted;
    this.publishLocal();
    this.emit();
  }

  async toggleCamera(): Promise<void> {
    if (!this.localStream) return;
    const tracks = this.localStream.getVideoTracks();

    if (tracks.length > 0) {
      this.cameraOn = !this.cameraOn;
      for (const t of tracks) t.enabled = this.cameraOn;
    } else {
      // Joined audio-only and now wants video: acquire a track and add it to every peer.
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        const track = cam.getVideoTracks()[0];
        if (track) {
          this.localStream.addTrack(track);
          for (const peer of this.peers.values()) {
            try {
              peer.addTrack(track, this.localStream);
            } catch {
              /* peer already has a video track */
            }
          }
          this.cameraOn = true;
        }
      } catch (err) {
        this.error = describeMediaError(err);
      }
    }
    this.publishLocal();
    this.emit();
  }

  leave(): void {
    cancelAnimationFrame(this.speakingRaf);
    for (const peerId of [...this.peers.keys()]) this.destroyPeer(peerId);

    this.socket?.emit('rtc:leave', { room: this.room });
    this.socket?.disconnect();
    this.socket = null;

    // Release the devices, or the browser keeps showing the camera/mic indicator after leaving.
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;

    void this.audioCtx?.close();
    this.audioCtx = null;
    this.analysers.clear();

    this.state = 'idle';
    this.muted = false;
    this.cameraOn = false;
    this.localSpeaking = false;
    this.publishLocal();
    this.emit();
  }

  // -------------------------------------------------------------------------
  // Speaking detection
  // -------------------------------------------------------------------------

  /**
   * Drive the speaking indicator from an AudioContext analyser rather than from the peer
   * connection, so it reflects actual audio energy and works identically for local and remote.
   */
  private startSpeakingDetection(): void {
    if (!this.localStream) return;
    this.audioCtx = new AudioContext();
    this.attachAnalyser('local', this.localStream);

    const THRESHOLD = 14;
    const tick = () => {
      this.speakingRaf = requestAnimationFrame(tick);
      let changed = false;

      for (const [id, { analyser, data }] of this.analysers) {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i]!;
        const level = sum / data.length;
        const speaking = level > THRESHOLD;

        if (id === 'local') {
          const next = speaking && !this.muted;
          if (next !== this.localSpeaking) {
            this.localSpeaking = next;
            this.publishLocal();
            changed = true;
          }
        } else {
          const p = this.participants.get(id);
          if (p && p.speaking !== speaking) {
            p.speaking = speaking;
            changed = true;
          }
        }
      }
      if (changed) this.emit();
    };
    this.speakingRaf = requestAnimationFrame(tick);
  }

  private attachAnalyser(id: string, stream: MediaStream): void {
    if (!this.audioCtx || stream.getAudioTracks().length === 0) return;
    try {
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      // Explicit ArrayBuffer: TS 5.7 types Uint8Array as generic over its buffer, and
      // getByteFrequencyData rejects a possibly-SharedArrayBuffer view.
      const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      this.analysers.set(id, { analyser, data });
    } catch {
      /* stream has no usable audio */
    }
  }

  private publishLocal(): void {
    this.onLocalMedia?.({ muted: this.muted, cameraOn: this.cameraOn, speaking: this.localSpeaking });
  }

  private emit(): void {
    this.onChange?.();
  }
}

function describeMediaError(err: unknown): string {
  const name = (err as DOMException)?.name;
  switch (name) {
    case 'NotAllowedError':
      return 'Microphone access was blocked. Allow it in your browser settings, then rejoin.';
    case 'NotFoundError':
      return 'No microphone found. Plug one in and try again.';
    case 'NotReadableError':
      return 'Your microphone is in use by another app.';
    case 'OverconstrainedError':
      return 'Your camera does not support the requested settings.';
    default:
      return 'Could not access your microphone or camera.';
  }
}
