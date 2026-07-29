# Deploying THE———BOARD

Three pieces: a static web build, a long-lived Node server, and a Postgres database.
Everything below has a free tier and none of it needs a credit card.

---

## 1. Database — Neon (5 minutes)

**This is not optional in production.** The server refuses to start without it, on purpose:
free hosts give you an **ephemeral disk**, so a SQLite file there is deleted on every redeploy —
taking every account and every board with it, silently, looking like the app just forgot everyone.

1. Sign up at **neon.tech** (free, no card)
2. Create a project — any region near your users
3. Copy the connection string. It looks like:
   ```
   postgresql://user:pass@ep-xxx-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

That's it. Tables are created automatically on first boot. No migration step to run.

Any Postgres works — Supabase, Railway, Fly, a local one. Only `DATABASE_URL` matters.

---

## 2. Server — Render

Render's free web service supports websockets, which rules out most serverless hosts.

- **Root directory:** repository root
- **Build command:** `pnpm install`
- **Start command:** `pnpm --filter @board/server start`
- **Instance type:** Free

### Environment variables

| Variable | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | Enables the safety checks below |
| `DATABASE_URL` | *your Neon string* | Without it the server refuses to boot |
| `JWT_SECRET` | `openssl rand -base64 32` | **Without it, anyone can forge a login for any account** |
| `CLIENT_ORIGIN` | `https://your-site.netlify.app` | Locks CORS; `*` lets any site use your AI quota |
| `GROQ_API_KEY` | *your key* | Primary AI provider |
| `GEMINI_API_KEY` | *your key* | Fallback |
| `OPENROUTER_API_KEY` | *your key* | Second fallback |

`JWT_SECRET` is the one that matters most. It was verified exploitable during development: with
the old hardcoded fallback, a forged token returned another user's account and their private
board list. Production now refuses to start without a real secret — but only if `NODE_ENV` is
actually set to `production`.

---

## 3. Web — Netlify

`netlify.toml` is already in the repo.

- **Build command:** `pnpm build`
- **Publish directory:** `apps/web/dist`

### Environment variables

| Variable | Value |
|---|---|
| `VITE_SERVER_HTTP` | `https://your-server.onrender.com` |
| `VITE_SERVER_WS` | `wss://your-server.onrender.com` |

**`wss://`, not `ws://`.** A plain `ws://` connection from an `https://` page is blocked as mixed
content and fails *silently* — the board loads and simply never syncs, with nothing in the
console to explain it.

Never put a secret in a `VITE_` variable. Vite inlines them into the JavaScript bundle, where
every visitor can read them.

---

## 4. Verify the deploy

```bash
curl https://your-server.onrender.com/healthz
```

Then, in the browser:

- [ ] Sign up, then **hard-refresh** — you should still be signed in
- [ ] Create a board, add a shape, reload — the shape is still there
- [ ] **Redeploy the server, then reload the board** — the shape must survive.
      *This is the test that proves Postgres is actually connected.*
- [ ] Open the board in a second window — cursors and edits sync
- [ ] Network tab shows a `wss://` websocket, not `ws://`
- [ ] `⌘K` → Brainstorm returns notes
- [ ] Join a call

---

## Known limitations

| Limitation | Cause | Fix when it matters |
|---|---|---|
| ~50s cold start after 15 min idle | Render free tier sleeps | Any paid instance |
| Calls fail between two symmetric NATs | No TURN server | Open Relay free tier, or coturn |
| Calls cap at 6 people | WebRTC mesh topology | An SFU (LiveKit, mediasoup) |
| Single server instance | No Redis bridge between y-websocket nodes | Redis pub/sub adapter |
| Uploads lost on redeploy | Ephemeral disk | S3 / R2 / Supabase Storage |

Neon's free tier also suspends an idle database, so the first request after a quiet period pays
a cold start on both the server *and* the database. Fine for a demo; worth knowing before you
show it to someone.

---

## Local development

```bash
pnpm install
cp .env.example .env      # add at least one AI key
pnpm dev                  # web :5173 · server :3001
```

No `DATABASE_URL` locally means SQLite at `./data/board.db` — zero setup. `JWT_SECRET` is
optional locally too; a random one is generated and cached at `./data/.dev-jwt-secret` (gitignored)
so sessions survive restarts.

To develop against Postgres, just set `DATABASE_URL` and restart.
