import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { WebSocket } from 'ws';
import { PERSIST_IDLE_MS, PERSIST_MAX_MS } from '@board/shared';
import { store } from '../db.js';

/**
 * y-websocket server, implemented directly rather than pulled from `y-websocket/bin/utils`.
 *
 * It is ~150 lines, it is the protocol this whole project rests on, and owning it means the
 * view-only enforcement and persistence hooks sit exactly where they need to.
 */

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

interface Conn {
  socket: WebSocket;
  readOnly: boolean;
  /** Awareness client IDs owned by this socket, so they can be cleaned up on disconnect. */
  controlledIds: Set<number>;
}

class Room {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  readonly conns = new Map<WebSocket, Conn>();

  private persistTimer: NodeJS.Timeout | null = null;
  private firstDirtyAt = 0;
  private destroyed = false;

  constructor(
    readonly code: string,
    readonly boardId: string,
  ) {
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null); // the server is not a participant

    const persisted = store.loadDoc(boardId);
    if (persisted) Y.applyUpdate(this.doc, persisted, 'persistence');

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.broadcastSync(update, origin);
      this.schedulePersist();
    });

    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = added.concat(updated, removed);
        if (changed.length === 0) return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          enc,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        this.broadcast(encoding.toUint8Array(enc), origin);
      },
    );
  }

  get size(): number {
    return this.conns.size;
  }

  private broadcastSync(update: Uint8Array, origin: unknown): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.broadcast(encoding.toUint8Array(enc), origin);
  }

  private broadcast(payload: Uint8Array, exclude: unknown): void {
    for (const [socket] of this.conns) {
      // Never echo a change back to the socket that produced it.
      if (socket === exclude) continue;
      send(socket, payload);
    }
  }

  /**
   * Debounced persistence: 5s idle, forced at 30s.
   *
   * The forced ceiling matters — during a long continuous drawing session the idle timer keeps
   * resetting and, without it, nothing would ever hit disk until the user stopped.
   */
  private schedulePersist(): void {
    if (this.destroyed) return;
    const now = Date.now();
    if (this.firstDirtyAt === 0) this.firstDirtyAt = now;

    if (this.persistTimer) clearTimeout(this.persistTimer);

    if (now - this.firstDirtyAt >= PERSIST_MAX_MS) {
      this.persist();
      return;
    }
    this.persistTimer = setTimeout(() => this.persist(), PERSIST_IDLE_MS);
  }

  persist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.firstDirtyAt = 0;
    try {
      store.saveDoc(this.boardId, Y.encodeStateAsUpdate(this.doc));
    } catch (err) {
      console.error(`[yjs] persist failed for ${this.code}:`, err);
    }
  }

  addConnection(socket: WebSocket, readOnly: boolean): void {
    const conn: Conn = { socket, readOnly, controlledIds: new Set() };
    this.conns.set(socket, conn);

    // Step 1 of the sync handshake: tell the client our state vector so it can send what we lack.
    const syncEnc = encoding.createEncoder();
    encoding.writeVarUint(syncEnc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEnc, this.doc);
    send(socket, encoding.toUint8Array(syncEnc));

    // Existing presence, so a joiner sees everyone already in the room immediately.
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const awEnc = encoding.createEncoder();
      encoding.writeVarUint(awEnc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awEnc,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
      );
      send(socket, encoding.toUint8Array(awEnc));
    }

    socket.on('message', (data: ArrayBuffer | Buffer) => {
      try {
        this.handleMessage(conn, new Uint8Array(data as ArrayBuffer));
      } catch (err) {
        console.error(`[yjs] bad message in ${this.code}:`, err);
      }
    });

    socket.on('close', () => this.removeConnection(socket));
    socket.on('error', () => this.removeConnection(socket));
  }

  private handleMessage(conn: Conn, data: Uint8Array): void {
    const dec = decoding.createDecoder(data);
    const enc = encoding.createEncoder();
    const type = decoding.readVarUint(dec);

    switch (type) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(enc, MESSAGE_SYNC);

        if (conn.readOnly) {
          // View-only is enforced HERE, on the server. Hiding buttons in the UI is not access
          // control — a reviewer with devtools open will check, and should find this.
          // Still answer step 1 so the client can READ the document.
          const peek = decoding.createDecoder(data);
          decoding.readVarUint(peek);
          const syncType = decoding.readVarUint(peek);
          if (syncType === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncMessage(dec, enc, this.doc, conn.socket);
            if (encoding.length(enc) > 1) send(conn.socket, encoding.toUint8Array(enc));
          }
          return;
        }

        syncProtocol.readSyncMessage(dec, enc, this.doc, conn.socket);
        if (encoding.length(enc) > 1) send(conn.socket, encoding.toUint8Array(enc));
        break;
      }

      case MESSAGE_AWARENESS: {
        // Awareness is allowed even for view-only connections: a read-only viewer's cursor is
        // useful presence, and awareness never touches the persisted document.
        const update = decoding.readVarUint8Array(dec);
        const before = new Set(this.awareness.getStates().keys());
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, conn.socket);
        for (const id of this.awareness.getStates().keys()) {
          if (!before.has(id)) conn.controlledIds.add(id);
        }
        break;
      }
    }
  }

  private removeConnection(socket: WebSocket): void {
    const conn = this.conns.get(socket);
    if (!conn) return;
    this.conns.delete(socket);

    // Remove this socket's presence, or their cursor and avatar linger for everyone else.
    if (conn.controlledIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.controlledIds], null);
    }
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }

  destroy(): void {
    this.persist();
    this.destroyed = true;
    this.awareness.destroy();
    this.doc.destroy();
  }
}

// ---------------------------------------------------------------------------

const rooms = new Map<string, Room>();

export function getRoom(code: string, boardId: string): Room {
  let room = rooms.get(code);
  if (!room) {
    room = new Room(code, boardId);
    rooms.set(code, room);
    console.log(`[yjs] room ${code} opened`);
  }
  return room;
}

export function joinRoom(
  code: string,
  boardId: string,
  socket: WebSocket,
  readOnly: boolean,
): void {
  const room = getRoom(code, boardId);
  room.addConnection(socket, readOnly);
  console.log(`[yjs] ${code}: +1 peer (${room.size} total)${readOnly ? ' [view-only]' : ''}`);

  // 15-minute session limit (900_000 ms)
  const sessionTimeout = setTimeout(() => {
    console.log(`[yjs] ${code}: Session expired for a peer after 15 minutes.`);
    try {
      // 1008 is Policy Violation, good for session expiry
      socket.close(1008, 'Session expired after 15 minutes');
    } catch {
      // Ignore if already closed
    }
  }, 900_000);

  socket.on('close', () => {
    clearTimeout(sessionTimeout);
    console.log(`[yjs] ${code}: -1 peer (${room.size} total)`);
    // Keep the room in memory briefly: a reload disconnects and reconnects within a second, and
    // tearing down the doc means re-reading it from disk for no reason.
    if (room.size === 0) {
      setTimeout(() => {
        if (room.size === 0 && rooms.get(code) === room) {
          room.destroy();
          rooms.delete(code);
          console.log(`[yjs] room ${code} closed and persisted`);
        }
      }, 30_000);
    }
  });
}

/** Flush every live room. Called on SIGTERM so a deploy never loses the last few seconds. */
export function flushAllRooms(): void {
  for (const room of rooms.values()) room.persist();
  console.log(`[yjs] flushed ${rooms.size} room(s)`);
}

export function roomStats() {
  return [...rooms.entries()].map(([code, room]) => ({ code, peers: room.size }));
}

function send(socket: WebSocket, payload: Uint8Array): void {
  // 1 = OPEN. Writing to a closing socket throws and would kill the broadcast loop.
  if (socket.readyState !== 1) return;
  try {
    socket.send(payload);
  } catch (err) {
    console.error('[yjs] send failed:', err);
  }
}
