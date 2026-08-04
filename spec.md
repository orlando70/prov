PROJECT_SPEC.md — ProFootball Real-time Match API

Technical specification and build plan. This is the source of truth — implement against this, not from memory of the original brief.

1. Architecture
                         ┌──────────────────────┐
                         │   Match Simulator      │
                         │  (background service)  │
                         └───────────┬─────────────┘
                                     │ writes
                                     ▼
                         ┌─────────────────────────┐
                         │  Postgres (Supabase)     │◄──── REST reads
                         │  matches / events / chat │
                         └───────────┬─────────────┘
                                     │ publishes
                                     ▼
                         ┌─────────────────────────┐
                         │   Redis Pub/Sub          │
                         │  match:{id}:events        │
                         └──────┬──────────┬────────┘
                                │          │
                     subscribes│          │subscribes
                                ▼          ▼
                     ┌──────────────┐  ┌──────────────┐
                     │  Socket.IO    │  │  SSE routes   │
                     │  broadcaster  │  │  (per-conn)   │
                     └──────┬───────┘  └──────┬───────┘
                            │                  │
                            ▼                  ▼
                      WebSocket clients    SSE clients

Key decision: the simulator never talks to Socket.IO or SSE connections directly. It only writes to Postgres and publishes to a Redis channel. Both delivery mechanisms are dumb consumers of that channel. This means adding a third delivery mechanism later (e.g. a mobile push service) costs nothing architecturally, and it's also what makes horizontal scaling straightforward (see §9).

2. Stack & rationale
Concern	Choice	Why
Runtime	Node.js 20 + TypeScript (strict)	Mature ecosystem for Socket.IO/Prisma; safer under a 1–2 day deadline than Bun
HTTP framework	Fastify	Native JSON schema validation, better throughput than Express, clean plugin model
Real-time	Socket.IO	Rooms, reconnection, and namespaces are built-in — reimplementing this on raw ws burns time for zero grading credit
DB	Supabase Postgres via Prisma	Supabase is required by the brief; Prisma gives real transactions, migrations, and type safety over the raw Postgres connection
Ephemeral state	Redis (ioredis)	Pub/sub backbone, chat presence, rate limiting, typing state
Validation	Zod	Single schema definition reused for REST bodies and socket event payloads
Logging	pino	Structured JSON, cheap, pairs natively with Fastify
Deploy	Railway	Persistent long-running process (required for WebSockets + SSE — rules out serverless platforms like Vercel functions), one-click Redis plugin, trivial GitHub deploy
3. Repo structure
profootball-backend/
├── AGENTS.md
├── PROJECT_SPEC.md
├── README.md
├── package.json
├── tsconfig.json
├── .env.example
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── server.ts                  # entrypoint
│   ├── app.ts                     # Fastify instance + plugin registration
│   ├── config/env.ts              # zod-validated env
│   ├── lib/{prisma,redis,logger}.ts
│   ├── modules/
│   │   ├── matches/                       # REST
│   │   │   ├── matches.routes.ts
│   │   │   ├── matches.service.ts
│   │   │   ├── matches.repository.ts
│   │   │   └── matches.schemas.ts
│   │   ├── events-stream/
│   │   │   └── events-stream.routes.ts    # SSE
│   │   ├── chat/
│   │   │   ├── chat.gateway.ts            # socket.io handlers
│   │   │   ├── chat.service.ts
│   │   │   └── chat.schemas.ts
│   │   └── realtime/
│   │       ├── socket.server.ts           # socket.io bootstrap, rooms, ping/pong config
│   │       └── broadcaster.ts             # redis subscriber -> socket.io + SSE bridge
│   ├── simulator/
│   │   ├── simulator.ts           # orchestrates N concurrent matches
│   │   ├── match-engine.ts        # single match state machine
│   │   ├── event-generator.ts     # weighted/interval-based event generation
│   │   └── config.ts
│   ├── middleware/{error-handler,rate-limiter,request-id}.ts
│   ├── types/index.ts
│   └── utils/response.ts          # success/error envelope builders
├── tests/{unit,integration}/
└── scripts/seed.ts
4. Environment variables (.env.example)
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://...           # Supabase connection string
REDIS_URL=redis://...                   # Railway Redis plugin internal URL

CORS_ORIGIN=http://localhost:5173

SIM_MATCH_COUNT=4
SIM_TICK_MS=1000                        # 1 real second = 1 match minute
SIM_AUTOSTART=true

CHAT_MAX_MESSAGE_LENGTH=500
CHAT_RATE_LIMIT_MAX=5
CHAT_RATE_LIMIT_WINDOW_MS=10000
TYPING_TIMEOUT_MS=3000

LOG_LEVEL=info
5. Data model (Prisma)
prisma
enum MatchStatus {
  NOT_STARTED
  FIRST_HALF
  HALF_TIME
  SECOND_HALF
  FULL_TIME
}

enum MatchEventType {
  GOAL
  YELLOW_CARD
  RED_CARD
  SUBSTITUTION
  FOUL
  SHOT
}

model Team {
  id        String   @id @default(uuid())
  name      String
  shortName String
  crestUrl  String?
  homeMatches Match[] @relation("HomeTeam")
  awayMatches Match[] @relation("AwayTeam")
}

model Match {
  id          String       @id @default(uuid())
  homeTeamId  String
  awayTeamId  String
  homeTeam    Team         @relation("HomeTeam", fields: [homeTeamId], references: [id])
  awayTeam    Team         @relation("AwayTeam", fields: [awayTeamId], references: [id])
  homeScore   Int          @default(0)
  awayScore   Int          @default(0)
  minute      Int          @default(0)
  status      MatchStatus  @default(NOT_STARTED)
  startedAt   DateTime?
  updatedAt   DateTime     @updatedAt
  createdAt   DateTime     @default(now())
  events      MatchEvent[]
  statistics  MatchStatistic[]
  chatMessages ChatMessage[]
}

model MatchEvent {
  id        String         @id @default(uuid())
  matchId   String
  match     Match          @relation(fields: [matchId], references: [id])
  seq       Int            @default(autoincrement()) // for SSE Last-Event-ID
  minute    Int
  type      MatchEventType
  teamId    String?
  player    String?
  detail    Json?
  createdAt DateTime       @default(now())

  @@index([matchId, seq])
}

model MatchStatistic {
  matchId        String
  teamId         String
  match          Match  @relation(fields: [matchId], references: [id])
  possession     Int    @default(50)
  shotsTotal     Int    @default(0)
  shotsOnTarget  Int    @default(0)
  corners        Int    @default(0)
  fouls          Int    @default(0)
  yellowCards    Int    @default(0)
  redCards       Int    @default(0)

  @@id([matchId, teamId])
}

model ChatMessage {
  id        String   @id @default(uuid())
  matchId   String
  match     Match    @relation(fields: [matchId], references: [id])
  userId    String
  username  String
  message   String
  createdAt DateTime @default(now())

  @@index([matchId, createdAt])
}

Statistics are simulator-maintained rather than derived purely from events (possession isn't cleanly derivable from discrete events), so the simulator writes to MatchStatistic directly alongside generating events.

MatchEvent.seq (autoincrement) is what powers SSE reconnection — see §8.

6. Redis key/channel map
Key/Channel	Type	Purpose
match:{matchId}:events	pub/sub channel	Simulator → broadcaster. Payload: { kind: 'SCORE'|'EVENT'|'STATS'|'STATUS', data }
chat:{matchId}:users	hash	userId -> { username, socketCount, joinedAt } — refcounted so duplicate joins from the same user (multiple tabs) don't double-fire join/leave events
ratelimit:chat:{userId}	string, TTL	Fixed-window counter for chat rate limiting
Socket.IO adapter (optional stretch)	—	@socket.io/redis-adapter for cross-instance broadcast if horizontally scaled

Typing indicators are not stored in Redis — they're highly ephemeral and per-connection, so they're tracked as in-memory debounce timers on the gateway instance handling that socket. This still works correctly even with multiple server instances, since the broadcast of typing state goes through Socket.IO (optionally Redis-adapter- backed) regardless of where the timer lives.

7. REST API

Response envelope, every route, always:

json
// success
{ "success": true, "data": { ... }, "meta": { "requestId": "..." } }
// error
{ "success": false, "error": { "code": "MATCH_NOT_FOUND", "message": "..." }, "meta": { "requestId": "..." } }

GET /api/matches Query params: status (optional filter), limit/offset (optional pagination). Returns array of matches with teams, score, minute, status — no nested events/stats (keep the list endpoint light).

GET /api/matches/:id Path param id validated as UUID (400 if malformed, not a 500). Returns full match: teams, score, minute, status, events[] (chronological), statistics[] (per team). 404 with MATCH_NOT_FOUND if no match exists with that id.

8. Real-time contract (Socket.IO)

Client → Server

Event	Payload
match:subscribe	{ matchId }
match:unsubscribe	{ matchId }
chat:join	{ matchId, username }
chat:leave	{ matchId }
chat:message	{ matchId, message }
chat:typing:start	{ matchId }
chat:typing:stop	{ matchId }

Server → Client

Event	Payload
match:score_update	{ matchId, homeScore, awayScore, minute }
match:event	{ matchId, event: MatchEvent }
match:stats_update	{ matchId, statistics }
match:status_change	{ matchId, status }
chat:message	{ matchId, id, userId, username, message, createdAt }
chat:user_joined	{ matchId, userId, username, userCount }
chat:user_left	{ matchId, userId, username, userCount }
chat:typing	{ matchId, userId, username, isTyping }
error	{ code, message }

Room design: match:{matchId} for score/event/stat updates, chat:{matchId} for chat — kept separate so a client watching a score doesn't have to also join the chat room. Every payload is Zod-validated on receipt; a malformed payload emits error with a descriptive code, never crashes the connection or the server.

Ping/pong: configure Socket.IO pingInterval: 25000, pingTimeout: 20000 explicitly (this is a graded requirement, not just a default to leave alone).

9. SSE stream — GET /api/matches/:id/events/stream
Content-Type: text/event-stream, each event formatted as:
  id: 42
  event: match_event
  data: {"type":"GOAL","minute":23,...}
Server sends event: heartbeat\ndata: {}\n\n every 15s to keep the connection alive through proxies with idle timeouts.
Reconnection: client sends Last-Event-ID header on reconnect. Server queries MatchEvent where matchId = :id AND seq > lastEventId, replays those, then attaches to the live Redis subscription. This is why MatchEvent.seq exists.
On client disconnect, the route handler must unsubscribe from Redis and clear the heartbeat interval — verify this with a test, leaked subscriptions are the most common bug in SSE implementations.
10. Match simulator

Config: SIM_MATCH_COUNT (default 4, brief asks for 3–5), SIM_TICK_MS (default 1000ms = 1 match minute).

State machine per match: NOT_STARTED → FIRST_HALF → HALF_TIME → SECOND_HALF → FULL_TIME. Kickoff starts FIRST_HALF; at minute 45(+stoppage) → HALF_TIME (pause ticking for a short real-time interval, e.g. 5s); resume at minute 46 → SECOND_HALF; at 90(+stoppage) → FULL_TIME and stop ticking.

Event timing — model as scheduled next-occurrence rather than per-tick probability, since the brief specifies intervals, not just totals:

Fouls: schedule next foul at now + random(2, 3) minutes
Shots: schedule next shot at now + random(3, 5) minutes
Goals: target ~2.5/match — draw from a light Poisson-ish distribution across 90 minutes per match so the expected count lands near 2.5 without being deterministic
Yellow cards: target 3–4/match, similar distribution
Red cards: rare — flat low probability per match (e.g. ~8% chance of exactly one)
Substitutions: 3–5 per team, weighted to occur after minute 60

Each generated event: write to MatchEvent, update Match.homeScore/awayScore/minute and relevant MatchStatistic row, publish to match:{matchId}:events.

11. Chat rules
Max length CHAT_MAX_MESSAGE_LENGTH (default 500), trimmed, rejected if empty after trim.
Rate limit: CHAT_RATE_LIMIT_MAX messages per CHAT_RATE_LIMIT_WINDOW_MS per user, enforced via Redis INCR + PEXPIRE. Over limit → error event, message dropped, not a disconnect.
Duplicate joins: keyed by userId, not socket.id. Track socket count per user in the chat:{matchId}:users Redis hash. chat:user_joined fires only on the 0→1 transition; chat:user_left only on 1→0. A second tab from the same user increments the count silently and gets current room state on join, but doesn't spam the room.
Typing indicator auto-clears after TYPING_TIMEOUT_MS of inactivity via a per-socket debounce timer, without the client needing to send an explicit stop.
12. Build phases (target: 1–2 days)

Phase 0 — Scaffolding (~30–45 min) Repo init, TS config, Fastify boilerplate, env validation, Prisma + Supabase connection, Redis connection, /health route, logger, central error handler. Deploy this to Railway before writing another feature — confirms the deploy path works while the stakes are low.

Phase 1 — REST API (~2–3 hrs) Migrations, seed script (a handful of teams + a few matches), both REST endpoints, validation, unit + integration tests.

Phase 2 — Real-time core (~3–4 hrs) Socket.IO server, subscribe/unsubscribe rooms, Redis pub/sub bridge, simulator MVP (score/minute/goals/cards only), ping/pong config, end-to-end wiring verified with a real socket client test.

Phase 3 — Chat (~2–3 hrs) Join/leave, message send + validation + rate limit, typing indicators, user counts, duplicate-join handling, chat history persistence.

Phase 4 — SSE stream (~1–2 hrs) Stream endpoint, heartbeat, Last-Event-ID reconnection/replay, remaining event types (fouls, shots, subs) in the simulator.

Phase 5 — Hardening (~2–3 hrs) CORS lockdown, request-ID logging, graceful shutdown, remaining tests, README, final deploy + smoke test against the live URL with a real client (not just curl).

13. Deployment steps
Supabase: create a project at supabase.com → Settings → Database → copy the connection string into DATABASE_URL.
Railway: new project → deploy from GitHub repo → add a Redis plugin to the same project (gives you REDIS_URL as an internal variable automatically, no separate signup) → set DATABASE_URL, CORS_ORIGIN, and the SIM_*/CHAT_* vars from .env.example in Railway's variables tab → set build command npm run build, start command npm start.
Confirm the deployed /health route responds before building further — this catches env/connection issues while there's only one moving part to debug.
14. Final README must include
Setup instructions (local dev + how to point at Supabase/Redis)
API documentation (both REST routes, all socket events, the SSE contract)
Architecture decisions (the pub/sub-as-decoupling-layer choice is worth explaining)
Known limitations (be honest — e.g. single-instance only unless the Redis Socket.IO adapter stretch goal is done, in-memory typing state, whatever didn't get built)
Trade-offs made under the time constraint