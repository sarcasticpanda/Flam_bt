import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, GripHorizontal, Mic, MicOff, Phone, PhoneOff, Video, VideoOff,
} from 'lucide-react';
import type { CallManager, CallParticipant } from '../features/call/CallManager';

/**
 * Floating call panel.
 *
 * Draggable and compact rather than a docked sidebar, because the canvas must stay usable
 * during a call — the call is a layer over the workspace, not a mode that replaces it.
 *
 * Each tile's ring is that participant's canvas colour, so the person talking on video is
 * visibly the same person as the cursor moving on the board.
 */
export function CallPanel({
  call,
  participants,
  colorFor,
  onJoin,
  onLeave,
  version,
}: {
  call: CallManager | null;
  participants: CallParticipant[];
  colorFor: (colorIndex: number) => string;
  onJoin: (withVideo: boolean) => void;
  onLeave: () => void;
  /** Bumped by the manager to force a re-render on stream/mute changes. */
  version: number;
}) {
  // Default to the right side: the style panel owns left-centre, and a call panel that opens
  // on top of the tools you were just using is worse than no default position at all.
  const [pos, setPos] = useState(() => ({
    x: Math.max(16, window.innerWidth - 260),
    y: 104,
  }));
  const dragging = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      setPos({
        // Clamp so the panel can never be dragged off-screen and stranded.
        x: Math.max(8, Math.min(window.innerWidth - 260, e.clientX - dragging.current.dx)),
        y: Math.max(8, Math.min(window.innerHeight - 120, e.clientY - dragging.current.dy)),
      });
    };
    const onUp = () => (dragging.current = null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const state = call?.state ?? 'idle';
  const inCall = state === 'in-call' || state === 'connecting';

  if (!inCall) {
    return (
      <div className="absolute bottom-4 left-4 z-40 flex gap-2" style={{ marginBottom: 0 }}>
        <button
          onClick={() => onJoin(false)}
          className="surface flex items-center gap-2 px-3.5 transition-colors hover:bg-[var(--chrome-raised)]"
          style={{ height: 44, color: 'var(--chrome-fg)', fontSize: 13 }}
          aria-label="Join call with audio"
        >
          <Phone size={16} strokeWidth={1.75} />
          Join call
        </button>
        <button
          onClick={() => onJoin(true)}
          className="surface grid place-items-center transition-colors hover:bg-[var(--chrome-raised)]"
          style={{ height: 44, width: 44, color: 'var(--chrome-fg)' }}
          title="Join with video"
          aria-label="Join call with video"
        >
          <Video size={16} strokeWidth={1.75} />
        </button>
        {call?.error && (
          <div
            className="surface flex max-w-xs items-center gap-2 px-3"
            style={{ height: 44, color: 'var(--danger)', fontSize: 12 }}
            role="alert"
          >
            <AlertCircle size={14} strokeWidth={2} className="shrink-0" />
            {call.error}
          </div>
        )}
      </div>
    );
  }

  const localStream = call?.getLocalStream() ?? null;

  return (
    <div
      className="surface absolute z-40 overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: 236 }}
    >
      <div
        className="flex cursor-grab items-center justify-between px-2.5 py-1.5 active:cursor-grabbing"
        style={{ borderBottom: '1px solid var(--chrome-hairline)' }}
        onPointerDown={(e) => {
          dragging.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
      >
        <span
          className="flex items-center gap-1.5"
          style={{ color: 'var(--chrome-fg-dim)', fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}
        >
          <GripHorizontal size={12} strokeWidth={2} />
          {state === 'connecting' ? 'Connecting…' : `Call · ${participants.length + 1}`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 p-1.5">
        <Tile
          label="You"
          stream={localStream}
          muted
          isMuted={call?.muted ?? false}
          cameraOn={call?.cameraOn ?? false}
          speaking={call?.localSpeaking ?? false}
          ring={colorFor(0)}
          self
          version={version}
        />
        {participants.map((p) => (
          <Tile
            key={p.peerId}
            label={p.name}
            stream={p.stream}
            muted={false}
            isMuted={p.muted}
            cameraOn={p.cameraOn}
            speaking={p.speaking}
            ring={colorFor(p.colorIndex)}
            error={p.error}
            version={version}
          />
        ))}
      </div>

      {call?.error && (
        <div className="px-2.5 pb-1.5" style={{ color: 'var(--danger)', fontSize: 11 }} role="alert">
          {call.error}
        </div>
      )}

      <div
        className="flex items-center gap-1 p-1.5"
        style={{ borderTop: '1px solid var(--chrome-hairline)' }}
      >
        <CtrlButton
          active={!call?.muted}
          onClick={() => call?.toggleMute()}
          label={call?.muted ? 'Unmute' : 'Mute'}
        >
          {call?.muted ? <MicOff size={15} strokeWidth={1.75} /> : <Mic size={15} strokeWidth={1.75} />}
        </CtrlButton>
        <CtrlButton
          active={call?.cameraOn ?? false}
          onClick={() => void call?.toggleCamera()}
          label={call?.cameraOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {call?.cameraOn ? <Video size={15} strokeWidth={1.75} /> : <VideoOff size={15} strokeWidth={1.75} />}
        </CtrlButton>
        <button
          onClick={onLeave}
          className="ml-auto grid place-items-center rounded-md transition-colors"
          style={{ height: 32, width: 40, background: 'var(--danger)', color: '#fff' }}
          title="Leave call"
          aria-label="Leave call"
        >
          <PhoneOff size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function CtrlButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className="grid place-items-center rounded-md transition-colors"
      style={{
        height: 32,
        width: 40,
        background: active ? 'var(--chrome-raised)' : 'transparent',
        color: active ? 'var(--chrome-fg)' : 'var(--chrome-fg-dim)',
      }}
    >
      {children}
    </button>
  );
}

function Tile({
  label,
  stream,
  muted,
  isMuted,
  cameraOn,
  speaking,
  ring,
  error,
  self,
  version,
}: {
  label: string;
  stream: MediaStream | null;
  muted: boolean;
  isMuted: boolean;
  cameraOn: boolean;
  speaking: boolean;
  ring: string;
  error?: string | null;
  self?: boolean;
  version: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const showVideo = cameraOn && stream && stream.getVideoTracks().length > 0;

  useEffect(() => {
    // Attach to whichever element is actually mounted. Sharing one ref between the video and
    // audio elements would leave the audio silent whenever the camera is off — which is
    // exactly the common case in an audio-first call.
    const el = showVideo ? videoRef.current : audioRef.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    // Autoplay can reject without a user gesture; a paused tile is not fatal.
    void el.play().catch(() => {});
  }, [stream, version, showVideo]);

  return (
    <div
      className="relative overflow-hidden rounded-md"
      style={{
        aspectRatio: '4/3',
        background: 'var(--chrome-raised)',
        // The ring IS the participant's canvas colour — same person, same colour, everywhere.
        boxShadow: speaking ? `0 0 0 2px ${ring}` : `0 0 0 1px var(--chrome-hairline)`,
        transition: 'box-shadow 140ms ease-out',
      }}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          // Mirror your own preview; an unmirrored self-view feels wrong to everyone.
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: self ? 'scaleX(-1)' : undefined }}
        />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <span
            className="grid h-8 w-8 place-items-center rounded-full"
            style={{ background: ring, color: '#fff', fontSize: 11, fontWeight: 600 }}
          >
            {label.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}
          </span>
        </div>
      )}

      {/* Audio element for camera-off participants — without it they are silent. Never render
          it for yourself, or you hear your own mic echoed back. */}
      {!showVideo && !self && <audio ref={audioRef} autoPlay />}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 px-1.5 py-1"
           style={{ background: 'linear-gradient(transparent, rgba(0,0,0,.65))' }}>
        <span className="truncate" style={{ color: '#fff', fontSize: 10 }}>{label}</span>
        {isMuted && <MicOff size={10} strokeWidth={2.5} style={{ color: '#fff', flexShrink: 0 }} />}
      </div>

      {error && (
        <div className="absolute inset-0 grid place-items-center p-1 text-center"
             style={{ background: 'rgba(0,0,0,.7)', color: '#fff', fontSize: 9 }}>
          {error}
        </div>
      )}
    </div>
  );
}
