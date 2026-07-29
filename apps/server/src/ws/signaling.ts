import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { MAX_CALL_PEERS, RTC_NAMESPACE, type RtcPeer } from '@board/shared';
import { store } from '../db.js';
import { verifyToken, type AuthTokenPayload } from '../auth/jwt.js';

/**
 * WebRTC signaling.
 *
 * The server only relays offers, answers, and ICE candidates — it never touches media. Media
 * state (muted, camera off, speaking) deliberately does NOT live here: it rides on Yjs
 * awareness, so presence has one source of truth and survives a failed peer connection.
 */
export function registerSignaling(server: HttpServer, clientOrigin: string): void {
  const io = new SocketIOServer(server, {
    cors: { origin: clientOrigin === '*' ? true : clientOrigin.split(',').map((s) => s.trim()) },
    // Socket.IO owns /socket.io; the Yjs upgrade handler skips that path.
    path: '/socket.io',
  });

  const rtc = io.of(RTC_NAMESPACE);
  /** room code -> peers */
  const rooms = new Map<string, Map<string, RtcPeer>>();

  rtc.use((socket, next) => {
    const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
    const user = verifyToken(token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  rtc.on('connection', (socket) => {
    let joinedRoom: string | null = null;
    const user = socket.data.user as AuthTokenPayload;

    socket.on('rtc:join', ({ room, colorIndex }) => {
      if (typeof room !== 'string' || !room) return;
      const found = store.findByAnyCode(room);
      if (!found || !store.accessFor(found.board, user.sub)) {
        socket.emit('rtc:forbidden');
        return;
      }
      const canonicalRoom = found.board.code;

      let peers = rooms.get(canonicalRoom);
      if (!peers) rooms.set(canonicalRoom, (peers = new Map()));

      // Mesh topology: N peers means N-1 connections each. Past 6 the upstream bandwidth on a
      // laptop collapses, so refuse with a REASON rather than letting the call degrade silently.
      if (peers.size >= MAX_CALL_PEERS) {
        socket.emit('rtc:full', { limit: MAX_CALL_PEERS });
        return;
      }

      const peer: RtcPeer = { peerId: socket.id, userId: user.sub, name: user.name, colorIndex };

      // Send the existing roster BEFORE announcing the newcomer, so the joiner initiates offers
      // and nobody double-offers.
      socket.emit('rtc:peers', { peers: [...peers.values()] });

      peers.set(socket.id, peer);
      joinedRoom = canonicalRoom;
      socket.join(canonicalRoom);
      socket.to(canonicalRoom).emit('rtc:peer-joined', { peer });
    });

    socket.on('rtc:signal', ({ to, data }) => {
      if (!joinedRoom || !to || !rooms.get(joinedRoom)?.has(to)) return;
      rtc.to(to).emit('rtc:signal', { from: socket.id, data });
    });

    const leave = () => {
      if (!joinedRoom) return;
      const peers = rooms.get(joinedRoom);
      peers?.delete(socket.id);
      if (peers && peers.size === 0) rooms.delete(joinedRoom);
      socket.to(joinedRoom).emit('rtc:peer-left', { peerId: socket.id });
      socket.leave(joinedRoom);
      joinedRoom = null;
    };

    socket.on('rtc:leave', leave);
    // Both paths must clean up identically, or a closed tab leaves a ghost tile in the call.
    socket.on('disconnect', leave);
  });

  console.log(`[rtc] signaling namespace ${RTC_NAMESPACE} ready (cap ${MAX_CALL_PEERS})`);
}
