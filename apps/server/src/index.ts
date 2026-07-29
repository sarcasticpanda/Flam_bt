// MUST be first: populates process.env before any module reads it at import time.
import { ENV } from './env.js';

import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { customAlphabet } from 'nanoid';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, inviteSchema, type BoardMember } from '@board/shared';
import { closeDb, store } from './db.js';
import { flushAllRooms, joinRoom, roomStats } from './ws/yjs.js';
import { registerSignaling } from './ws/signaling.js';
import { aiRouter } from './routes/ai.js';
import { authRouter } from './routes/auth.js';
import { requireAuth, verifyToken } from './auth/jwt.js';

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

// Accounts are deliberately optional.  The anonymous code-link experience remains useful for
// quick collaboration, while an account adds a durable dashboard and invite management.
app.use('/api/auth', authRouter);

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

app.post('/api/boards', requireAuth, (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 120) : 'Untitled board';
  const owner = store.userById(req.user!.sub);
  if (!owner) {
    res.status(401).json({ error: 'unauthorized', message: 'Session no longer valid.' });
    return;
  }

  // Retry on the astronomically unlikely collision rather than returning a 500.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = nanoCode();
    const viewCode = nanoCode();
    if (code === viewCode) continue;
    try {
      const board = store.createBoard(nanoId(), code, viewCode, title, owner.id);
      res.json({ id: board.id, code: board.code, viewCode: board.view_code, title: board.title });
      return;
    } catch (error) {
      if (!String(error).toLowerCase().includes('unique')) {
        console.error('[boards] create failed:', error);
        res.status(500).json({ error: 'database_write_failed', message: 'Could not create the board. Check the server log.' });
        return;
      }
      /* collision — try again */
    }
  }
  res.status(500).json({ error: 'could_not_allocate_code' });
});

/** Boards owned by or explicitly shared with the signed-in user. */
app.get('/api/boards', requireAuth, (req, res) => {
  const boards = store.boardsForUser(req.user!.sub).map((board) => ({
    id: board.id,
    code: board.code,
    title: board.title,
    createdAt: board.created_at,
    updatedAt: board.updated_at,
    role: store.isOwner(board, req.user!.sub) ? 'owner' : store.roleFor(board.id, req.user!.sub),
  }));
  res.json({ boards });
});

app.get('/api/boards/:code', requireAuth, (req, res) => {
  const found = store.findByAnyCode(req.params.code ?? '');
  if (!found) {
    // A real 404 with a body the client can show inline, rather than an HTML error page.
    res.status(404).json({ error: 'not_found', message: 'No board with that code.' });
    return;
  }
  const { board } = found;
  const role = store.accessFor(board, req.user!.sub);
  if (!role) {
    res.status(403).json({ error: 'not_a_member', message: 'Ask the board owner to invite your account.' });
    return;
  }
  res.json({
    id: board.id,
    code: board.code,
    title: board.title,
    createdAt: board.created_at,
    updatedAt: board.updated_at,
    readOnly: role === 'viewer',
    role,
  });
});

app.patch('/api/boards/:code', requireAuth, (req, res) => {
  const found = store.findByAnyCode(req.params.code ?? '');
  if (!found) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const role = store.accessFor(found.board, req.user!.sub);
  if (!role || role === 'viewer') {
    res.status(403).json({ error: 'read_only' });
    return;
  }
  const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 120) : null;
  if (title) store.setTitle(found.board.id, title);
  res.json({ ok: true });
});

app.get('/api/boards/:code/share', requireAuth, (req, res) => {
  const found = store.findByAnyCode(req.params.code ?? '');
  if (!found || found.readOnly || !store.isOwner(found.board, req.user!.sub)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ code: found.board.code, viewCode: found.board.view_code });
});

function ownedBoard(code: string, userId: string) {
  const found = store.findByAnyCode(code);
  if (!found || found.readOnly || !store.isOwner(found.board, userId)) return null;
  return found.board;
}

/** List people invited to a board.  This information is visible only to its owner. */
app.get('/api/boards/:code/members', requireAuth, (req, res) => {
  const board = ownedBoard(req.params.code ?? '', req.user!.sub);
  if (!board) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const members: BoardMember[] = store.listMembers(board.id).map((member) => ({
    userId: member.user_id,
    email: member.email,
    name: member.name,
    role: member.role as BoardMember['role'],
    pending: member.user_id === null,
    invitedAt: member.invited_at,
  }));
  res.json({ members });
});

/** Invite an account holder now, or leave a pending invite for that email to claim on signup. */
app.post('/api/boards/:code/members', requireAuth, (req, res) => {
  const board = ownedBoard(req.params.code ?? '', req.user!.sub);
  if (!board) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', message: 'Enter a valid email and role.' });
    return;
  }
  if (parsed.data.email === req.user!.email) {
    res.status(400).json({ error: 'cannot_invite_owner', message: 'You already own this board.' });
    return;
  }
  const member = store.inviteMember(board.id, parsed.data.email, parsed.data.role);
  res.status(201).json({ member });
});

app.delete('/api/boards/:code/members', requireAuth, (req, res) => {
  const board = ownedBoard(req.params.code ?? '', req.user!.sub);
  if (!board) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : undefined;
  const email = typeof req.body?.email === 'string' ? req.body.email : undefined;
  if (!userId && !email) {
    res.status(400).json({ error: 'invalid_input', message: 'Choose a member to remove.' });
    return;
  }
  store.removeMember(board.id, { userId, email });
  res.json({ ok: true });
});

app.use('/api/ai', requireAuth, aiRouter);

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

  const token = url.searchParams.get('token');
  const user = token ? verifyToken(token) : null;
  const found = store.findByAnyCode(code);
  const role = found && user ? store.accessFor(found.board, user.sub) : null;
  if (!found || !role) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    joinRoom(found.board.code, found.board.id, ws, found.readOnly || role === 'viewer');
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
