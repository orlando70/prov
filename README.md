# ProFootball Real-time Match API

A Node.js backend for simulating and streaming live football matches. It uses Fastify, Socket.IO, Prisma, PostgreSQL, and Redis.

## Features

- **Match Simulator**: A background engine runs concurrent football matches. It transitions match states (halves, full-time) and generates goals, fouls, and cards in real-time.
- **Real-time Core**: Fastify broadcasts simulator events to connected clients via Socket.IO.
- **Server-Sent Events (SSE)**: An HTTP stream provides live match events and supports reconnection (`Last-Event-ID`) using Prisma to fetch missed events.
- **Live Chat**: Users join match-specific Socket.IO rooms to chat. The API handles typing indicators, tracks active user counts using Redis hashes, and enforces rate limits.
- **REST API**: HTTP endpoints list matches and return chronological event histories.

## Setup

### Prerequisites
- Node.js 20+
- PostgreSQL (e.g., Supabase)
- Redis

### Install & Configure

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to include your database and Redis URLs. If you use Supabase or a connection pooler, set `DATABASE_URL` to your transaction pooler (port 6543) and `DIRECT_URL` to the session pooler (port 5432) for migrations.

3. Push the schema and seed the database:
   ```bash
   npx prisma db push
   npm run build
   npx tsx scripts/seed.ts
   ```

4. Start the server:
   ```bash
   # Watch mode for local development
   npm run dev

   # Production
   npm run build
   npm start
   ```

## Architecture decisions

- **Pub/Sub isolates the simulator.** The match engine runs in the background. It writes to Postgres and publishes events to Redis. The Fastify API nodes only consume from Redis to feed Socket.IO and SSE. This means you can horizontally scale the API nodes without duplicating simulator logic.
- **In-memory debouncing for typing.** Typing indicators are highly ephemeral. The Socket.IO gateway tracks timeouts in memory instead of writing them to Redis, saving database calls.
- **Prisma 7 split configuration.** The project uses Prisma 7. Database URLs live in `prisma.config.ts`, keeping `schema.prisma` strictly for data modeling. It uses `@prisma/adapter-pg` to route queries through the standard `pg` driver, which prevents connection dropping with Supabase's pgBouncer pooler.
- **Redis Hash for connection tracking.** A single user might open multiple browser tabs. The chat service tracks socket counts per user in a Redis Hash (`chat:matchId:users`). The API only broadcasts "user joined" or "user left" when the user's total socket count changes to 1 or 0.

## API Contract

### REST
- `GET /api/matches`
  - Query Params: `status` (optional), `limit` (default: 20), `offset` (default: 0).
  - Returns matches without nested events.
- `GET /api/matches/:id`
  - Returns the match, its chronological events, statistics, and participating teams.

### Socket.IO
Clients connect to `/` and emit events. The server broadcasts updates.

**Client → Server**
- `match:subscribe { matchId }`
- `match:unsubscribe { matchId }`
- `chat:join { matchId, username }`
- `chat:leave { matchId }`
- `chat:message { matchId, message }`
- `chat:typing:start { matchId }`
- `chat:typing:stop { matchId }`

**Server → Client**
- `match:score_update { matchId, homeScore, awayScore, minute }`
- `match:event { matchId, event }`
- `match:stats_update { matchId, statistics }`
- `match:status_change { matchId, status }`
- `chat:message { matchId, id, userId, username, message, createdAt }`
- `chat:user_joined { matchId, userId, username, userCount }`
- `chat:user_left { matchId, userId, username, userCount }`
- `chat:typing { matchId, userId, username, isTyping }`
- `error { code, message }`

### Server-Sent Events (SSE)
- `GET /api/matches/:id/events/stream`
  - Streams `match_event` types.
  - Replays missed events if the client sends a `Last-Event-ID` header.
  - Sends a `heartbeat` event every 15 seconds to keep the connection alive.

## Known limits
- Typing indicator debouncing relies on single-node memory. If clients connect to different API nodes behind a load balancer, typing events will not sync across nodes.
- Chat rate limits use a fixed-window approach in Redis (`INCR` + `PEXPIRE`), which allows request bursts at window boundaries.
