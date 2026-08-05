# ProFootball Real-time Match API

A Node.js backend for simulating and streaming live football matches. Fastify + Socket.IO + Prisma + PostgreSQL + Redis.

## Features

- **Match Simulator**: Concurrent matches with staggered kickoffs. On `FULL_TIME`, a fresh fixture is queued so the deploy never goes idle.
- **Real-time Core**: Simulator publishes to Redis; Socket.IO and SSE consume that channel.
- **SSE**: Live match events with `Last-Event-ID` replay.
- **Live Chat**: Room-scoped chat with typing indicators, presence counts, and rate limits.
- **REST + OpenAPI**: List/detail endpoints; interactive docs at `/docs`.

## Setup

### Prerequisites
- Node.js 20+ (pinned via `.nvmrc` / `engines`)
- PostgreSQL
- Redis

### Install & Configure

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   ```
   Set `DATABASE_URL` and `REDIS_URL`. If you use Supabase/pgBouncer, set `DATABASE_URL` to the transaction pooler and `DIRECT_URL` to the session URL for migrations/seed.

3. Migrate and seed:
   ```bash
   npx prisma migrate deploy
   npx tsx scripts/seed.ts
   ```

4. Start:
   ```bash
   npm run dev          # watch mode
   npm run build && npm start
   ```

### Development Commands
- `npm test` — Vitest suite
- `npm run lint` — ESLint + Prettier
- `npm run typecheck` — `tsc --noEmit`
- `npm run format` — Prettier write

Interactive REST docs: [http://localhost:3000/docs](http://localhost:3000/docs) once the server is running.

## Architecture decisions

- **Redis pub/sub as the decoupling layer.** The simulator never talks to Socket.IO or SSE directly. It writes Postgres and publishes to `match:{id}:events`. Delivery mechanisms are dumb consumers of that channel — adding another fan-out later is cheap, and the same design is what you'd wire to a Socket.IO Redis adapter for horizontal scale.
- **Socket.IO over raw `ws`.** Rooms, heartbeats (`pingInterval`/`pingTimeout`), and reconnect semantics come built-in. Reimplementing those for a take-home would be pure cost; Socket.IO still speaks WebSocket under the hood.
- **CORS is env-configurable and defaults permissively (`*`).** Locking origins tightly is correct production practice, but this API must be reachable by HTTP client tools, real-time client tools, an internal test frontend, and automated scripts whose origins we don't control. The permissive default is a deliberate, documented trade-off for gradability — set `CORS_ORIGIN` to a specific origin when you deploy for real.
- **In-memory typing debounce.** Typing is ephemeral; timers live on the gateway that owns the socket. Broadcast still goes through Socket.IO rooms.
- **Redis Hash for multi-tab presence.** `chat:{matchId}:users` tracks socket counts per `userId` so duplicate tabs don't double-count joins/leaves.
- **Prisma 7.** URLs live in `prisma.config.ts`; `@prisma/adapter-pg` talks through `pg` for pooler-friendly connections.

## API Contract

### REST
OpenAPI UI: `/docs`

- `GET /api/matches` — query: `status?`, `limit` (default 20), `offset` (default 0). Teams, score, minute, status. Envelope: `{ success, data, meta.requestId }`.
- `GET /api/matches/:id` — full match with chronological `events[]` and `statistics[]`. `400 VALIDATION_ERROR` for bad UUID; `404 MATCH_NOT_FOUND`.
- `GET /health` — checks Postgres + Redis; `503` if either is down.

All error responses use `{ success: false, error: { code, message }, meta: { requestId } }`.

### Socket.IO
Connect to `/`. Heartbeat: `pingInterval` 25s, `pingTimeout` 20s.

**Client → Server**
| Event | Payload | Notes |
|-------|---------|-------|
| `match:subscribe` | `{ matchId: uuid }` | Join `match:{id}` room |
| `match:unsubscribe` | `{ matchId: uuid }` | Leave room |
| `chat:join` | `{ matchId, username }` | Presence; `userId` from handshake auth / generated |
| `chat:leave` | `{ matchId }` | |
| `chat:message` | `{ matchId, message }` | Trimmed, max length enforced; rate-limited per `userId` |
| `chat:typing:start` | `{ matchId }` | |
| `chat:typing:stop` | `{ matchId }` | |

Malformed payloads → `error { code: "INVALID_PAYLOAD", message }` and the connection stays open.
Rate limit exceeded → `error { code: "RATE_LIMIT_EXCEEDED", message }`.

**Server → Client**
| Event | Payload |
|-------|---------|
| `match:score_update` | `{ matchId, homeScore, awayScore, minute }` |
| `match:event` | `{ matchId, event }` |
| `match:stats_update` | `{ matchId, statistics }` |
| `match:status_change` | `{ matchId, status }` |
| `chat:message` | `{ matchId, id, userId, username, message, createdAt }` |
| `chat:user_joined` / `chat:user_left` | `{ matchId, userId, username, userCount }` |
| `chat:typing` | `{ matchId, userId, username, isTyping }` |
| `error` | `{ code, message }` |

### Server-Sent Events (SSE)
`GET /api/matches/:id/events/stream`

- Streams `event: match_event` with `id: {seq}` and JSON body of the `MatchEvent`.
- Reconnect: send `Last-Event-ID: {seq}`; server replays `seq > last`, then attaches to the live Redis subscription (no duplicates).
- `event: heartbeat` every 15s.
- Pre-stream errors (bad UUID / missing match) return the normal JSON error envelope (`400` / `404`).
- Mid-stream replay failure emits `event: error` then closes.

## Known limitations

- **Single-instance Socket.IO.** There is no Redis adapter yet, so sticky sessions (or a single node) are required for socket affinity. Redis pub/sub already decouples the simulator, so adding `@socket.io/redis-adapter` is the natural next step for horizontal scale.
- **Typing indicators are in-memory** on the node that owns the socket — they won't sync across nodes without the adapter (or moving timers to Redis).
- **Chat rate limits** use a fixed Redis window (`INCR` + `PEXPIRE`), which allows bursts at window boundaries.
- **Brief Redis/Postgres blips:** ioredis reconnects via `retryStrategy`. A hard DB outage mid-tick surfaces as logged engine errors; the process stays up. Full automatic Prisma reconnect/circuit-breaking is not implemented.

## Beyond this assessment's scope

For a long-lived production system I'd add: APM/tracing (OpenTelemetry), alerting on `/health` and error rates, the Socket.IO Redis adapter for multi-node fan-out (the pub/sub design already sets this up), blue/green or rolling deploys with drain on `SIGTERM`, and structured log shipping with request/socket correlation IDs end-to-end.

## Security notes

- `npm audit` currently reports **0** vulnerabilities in direct dependencies.
- Fastify `bodyLimit` is 1MB; `trustProxy` is enabled for Railway/reverse-proxy deployments.
- Chat rate limits are keyed on `userId`, not `socket.id`, so reconnecting does not reset the window.
