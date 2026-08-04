# ProFootball Real-time Match API

A real-time match API using Node.js, TypeScript, Fastify, Socket.IO, Prisma (PostgreSQL), and Redis.

## Features
- **REST API**: List matches and get match details.
- **Real-time Core**: Socket.IO for broadcasting score updates, match events, and match statuses.
- **Chat**: Socket.IO namespace for real-time chat, typing indicators, and rate limiting via Redis.
- **SSE Stream**: Server-Sent Events stream for match events with reconnection and replay support.
- **Simulator**: Background simulator that processes real-time events for multiple concurrent matches.

## Setup Instructions

### Prerequisites
- Node.js 20+
- PostgreSQL
- Redis

### Installation
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Copy the example environment file and configure it:
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` to supply your `DATABASE_URL` and `REDIS_URL`.*

3. Run Prisma Migrations and Seed:
   ```bash
   npx prisma db push
   npm run build
   node dist/scripts/seed.js
   ```

4. Start the server:
   ```bash
   # Development (watch mode)
   npm run dev

   # Production
   npm run build
   npm start
   ```

## Architecture Decisions
- **Pub/Sub as Decoupling Layer**: The match simulator writes to PostgreSQL and publishes to a Redis channel. Socket.IO and SSE act purely as consumers. This avoids tight coupling between the simulator and the delivery mechanisms, making horizontal scaling straightforward.
- **Typing Indicators**: In-memory debounce timers are used on the Socket.IO gateway, avoiding heavy writes to Redis for highly ephemeral typing state.
- **Prisma 7 Config**: Database URLs are stored in `prisma.config.ts` while `schema.prisma` is cleanly separated for type generation and schema structure.

## API Documentation

### REST API
- `GET /api/matches`
  - Query Params: `status` (optional), `limit` (default: 20), `offset` (default: 0).
  - Returns a list of matches without nested events.
- `GET /api/matches/:id`
  - Returns full match data including chronological events and statistics.

### Socket.IO Contract
* **Client → Server Events**:
  - `match:subscribe { matchId }`
  - `match:unsubscribe { matchId }`
  - `chat:join { matchId, username }`
  - `chat:leave { matchId }`
  - `chat:message { matchId, message }`
  - `chat:typing:start { matchId }`
  - `chat:typing:stop { matchId }`
* **Server → Client Events**:
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
  - Provides a text/event-stream of `match_event` types.
  - Supports `Last-Event-ID` header for reconnection and replay.
  - Sends a `heartbeat` event every 15s.

## Limitations & Known Issues
- Currently designed for single-instance typing indicator debouncing.
- Rate limits use a naive fixed window via Redis `INCR` + `PEXPIRE`.
