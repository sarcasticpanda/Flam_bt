# 06 — Setup & Operations

## Prerequisites

- Node 20+
- pnpm 9+
- A Supabase project (free tier is fine) — Postgres + Storage
- An Anthropic API key

## Install & run

```bash
pnpm install
cp .env.example .env            # fill in values
pnpm db:push                    # apply schema
pnpm dev                        # web :5173, server :3001
```

Other scripts:

```bash
pnpm typecheck        # tsc --noEmit across all workspaces
pnpm lint             # eslint
pnpm test             # vitest (canvas-engine + server ai)
pnpm build            # build web + server
pnpm preview          # serve the production build locally
```

## Environment variables

`.env` (server) — never expose these to the client:

```
PORT=3001
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:5173

ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-sonnet-4-6
AI_MAX_TOKENS=2000

SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...        # server only
SUPABASE_STORAGE_BUCKET=collabspace

MAX_FILE_MB=10
MAX_BOARD_MB=100
AI_RATE_ROOM_PER_MIN=20
AI_RATE_USER_PER_HOUR=60
```

`apps/web/.env` — public by definition, only put public values here:

```
VITE_SERVER_HTTP=http://localhost:3001
VITE_SERVER_WS=ws://localhost:3001
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

> If you ever find `ANTHROPIC_API_KEY` prefixed with `VITE_`, stop and fix it. That ships the key
> to every visitor.

## Database schema

```sql
create table boards (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,          -- 6-char join code
  view_code   text unique not null,          -- separate view-only code
  title       text not null default 'Untitled board',
  owner_id    uuid null,                     -- null for anonymous boards
  thumbnail   text null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table board_state (
  board_id    uuid primary key references boards(id) on delete cascade,
  ydoc        bytea not null,                -- Y.encodeStateAsUpdate
  updated_at  timestamptz not null default now()
);

create table board_versions (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid references boards(id) on delete cascade,
  label       text not null,
  author      text not null,
  ydoc        bytea not null,
  created_at  timestamptz not null default now()
);

create table board_files (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid references boards(id) on delete cascade,
  name        text not null,
  mime        text not null,
  size_bytes  bigint not null,
  storage_key text not null,
  page_count  int null,
  created_at  timestamptz not null default now()
);

create index on board_files (board_id);
create index on board_versions (board_id, created_at desc);
```

## Deployment

| Piece | Host | Notes |
|---|---|---|
| `apps/web` | Vercel | Static build. Set the two `VITE_` vars. |
| `apps/server` | **Fly.io or Railway** | Must be a long-lived process. Websockets do not work on serverless functions — do not deploy this to Vercel Functions. |
| Postgres + Storage | Supabase | Set the storage bucket to private; serve files via signed URLs. |

Server deployment checklist:

- [ ] `CLIENT_ORIGIN` set to the real web origin; CORS locked to it
- [ ] `wss://` (not `ws://`) in production — mixed content will silently fail
- [ ] Health check endpoint `GET /healthz` for the platform's probe
- [ ] Graceful shutdown: flush all in-memory Yjs docs to Postgres on `SIGTERM`
- [ ] At least 512MB RAM; each active room holds its doc in memory
- [ ] Sticky sessions **not** required (Yjs converges), but a single instance is simplest for the
      MVP. Multi-instance needs a Redis pub/sub bridge between y-websocket servers — document
      this as a known limitation rather than half-building it.

## Common failure modes

| Symptom | Likely cause |
|---|---|
| Shapes appear locally, never sync | Mutation bypassed `ydoc.transact` and wrote to a local array |
| Sync works but undo reverts a collaborator's shape | `UndoManager` not scoped to the local origin |
| Canvas blurry on a Mac | Missing `devicePixelRatio` scaling in the engine resize path |
| fps collapses at ~2k shapes | Culling not applied, or sorting the full shape list every frame |
| Pen strokes lag behind the cursor | Rendering on the static layer instead of the active layer |
| PDF renders then vanishes on zoom | Re-rasterising without keeping the previous bitmap during the swap |
| WebRTC works locally, fails between networks | No TURN server — expected; document it |
| AI returns fine but nothing appears | Output schema mismatch swallowed; check the retry path logs |
