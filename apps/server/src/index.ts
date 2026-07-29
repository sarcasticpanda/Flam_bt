// MUST be first: populates process.env before any module reads it at import time.
import { ENV } from './env.js';

import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { customAlphabet } from 'nanoid';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@board/shared';
import { closeDb, store } from './db.js';
import { flushAllRooms, joinRoom, roomStats } from './ws/yjs.js';
import { registerSignaling } from './ws/signaling.js';
import { aiRouter } from './routes/ai.js';

const { PORT, CLIENT_ORIGIN } = ENV;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(
  cors({
    // Locked to the known client origin rather than '*': these routes proxy AI credentials.
    origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN.split(',').map((s) => s.trim()),
  }),
);

const nanoId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 16);
const nanoCode = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: roomStats(), uptime: Math.round(process.uptime()) });
});

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

app.post('/api/boards', (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 120) : 'Untitled board';

  // Retry on the astronomically unlikely collision rather than returning a 500.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = nanoCode();
    const viewCode = nanoCode();
    if (code === viewCode) continue;
    try {
      const board = store.createBoard(nanoId(), code, viewCode, title);
      res.json({ id: board.id, code: board.code, viewCode: board.view_code, title: board.title });
      return;
    } catch {
      /* collision — try again */
    }
  }
  res.status(500).json({ error: 'could_not_allocate_code' });
});

app.get('/api/boards/:code', (req, res) => {
  const found = store.findByAnyCode(req.params.code);
  if (!found) {
    // A real 404 with a body the client can show inline, rather than an HTML error page.
    res.status(404).json({ error: 'not_found', message: 'No board with that code.' });
    return;
  }
  const { board, readOnly } = found;
  res.json({
    id: board.id,
    code: board.code,
    title: board.title,
    createdAt: board.created_at,
    updatedAt: board.updated_at,
    readOnly,
  });
});

app.patch('/api/boards/:code', (req, res) => {
  const found = store.findByAnyCode(req.params.code);
  if (!found) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (found.readOnly) {
    res.status(403).json({ error: 'read_only' });
    return;
  }
  const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 120) : null;
  if (title) store.setTitle(found.board.id, title);
  res.json({ ok: true });
});

app.get('/api/boards/:code/share', (req, res) => {
  const found = store.findByAnyCode(req.params.code);
  if (!found || found.readOnly) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ code: found.board.code, viewCode: found.board.view_code });
});

app.use('/api/ai', aiRouter);

// ---------------------------------------------------------------------------
// HTTP + WebSocket
// ---------------------------------------------------------------------------

const server = createServer(app);

// noServer: we own the upgrade so /yjs and socket.io can share one port.
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  // Socket.IO attaches its own upgrade handler; leave its path alone.
  if (url.pathname.startsWith('/socket.io')) return;

  // Accept both `/yjs/CODE` (what the y-websocket client produces) and `/yjs?room=CODE`.
  // Matching the standard client's URL shape means we get its reconnect/backoff logic for free
  // while still owning the server side of the protocol.
  let code: string | null = null;
  if (url.pathname.startsWith('/yjs/')) {
    code = decodeURIComponent(url.pathname.slice('/yjs/'.length));
  } else if (url.pathname === '/yjs') {
    code = url.searchParams.get('room');
  }

  if (!code) {
    socket.destroy();
    return;
  }

  const found = store.findByAnyCode(code);
  if (!found) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    // readOnly comes from WHICH CODE was used, resolved server-side. The client cannot
    // promote itself to edit access by flipping a flag.
    joinRoom(found.board.code, found.board.id, ws, found.readOnly);
  });
});

registerSignaling(server, CLIENT_ORIGIN);

server.listen(PORT, () => {
  console.log(`[server] http + ws on :${PORT}`);
  console.log(`[server] cors origin: ${CLIENT_ORIGIN}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown — a deploy must not lose the last few seconds of work
// ---------------------------------------------------------------------------

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} — flushing rooms`);
  flushAllRooms();
  closeDb();
  server.close(() => process.exit(0));
  // Do not let a hung socket block the deploy indefinitely.
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
