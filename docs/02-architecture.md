# 02 — Architecture

[← Back to index](./README.md) · Related: [System Design](./03-system-design.md) · [Backend](./04-backend.md) · [Frontend](./07-frontend.md) · [Real-Time & Calling](./08-realtime-and-calls.md)

---

## 1. Architectural goals

quickCHAT's architecture is shaped by five priorities, in rough order of importance:

1. **Real-time correctness** — events (messages, presence, receipts) must propagate quickly and consistently, even across multiple devices per user and across reconnects.
2. **Perceived performance** — the UI must feel instant (optimistic updates), bounded in cost (pagination + virtualization), and resilient (retry on failure).
3. **Operational simplicity** — a small team should be able to run the whole thing: one SPA, one backend, managed data/media/TURN providers, serverless hosting.
4. **Security by default** — authenticated sockets, HTTP-only cookies, rate limits, sanitized rendering, SSRF-hardened outbound fetches.
5. **Extensibility** — a conversation-centric domain model and a layered backend so new features are additive.

---

## 2. The 30,000-foot view

quickCHAT is a **client–server web application** with a **managed-service periphery**. There is no microservice mesh: the backend is a single Node.js process exposing both a **stateless REST API** and a **stateful Socket.IO realtime server**, plus an in-process **background scheduler**.

```mermaid
graph TB
  subgraph Browser["Browser / PWA"]
    React["React SPA"]
    SWk["Service Worker"]
    RTC["WebRTC engine<br/>(RTCPeerConnection)"]
  end

  subgraph Backend["Node.js backend (single process)"]
    direction TB
    Express["Express 5<br/>REST API"]
    Socket["Socket.IO<br/>realtime + signaling"]
    Sched["Message scheduler<br/>(setInterval)"]
    Express -.shares models/lib.- Socket
    Socket -.shares models/lib.- Sched
  end

  subgraph Ext["Managed services"]
    Mongo[("MongoDB Atlas")]
    Cloud["Cloudinary"]
    Twilio["Twilio TURN/STUN"]
    Push["Push providers"]
  end

  React <-->|"REST (axios, JSON, cookie)"| Express
  React <-->|"WebSocket"| Socket
  React -->|"signed upload"| Cloud
  RTC <-->|"media (P2P or relayed)"| Twilio
  SWk <-->|"push subscription"| Push

  Express --> Mongo
  Socket --> Mongo
  Sched --> Mongo
  Express --> Cloud
  Express -->|"web-push"| Push
  Express -->|"ICE token mint"| Twilio
```

### Why a single backend process (a "modular monolith")?

A microservice split (separate auth, messaging, presence, calling services) was deliberately **not** chosen. Reasons:

- **Shared state**: Presence and Socket.IO rooms live in process memory (`userSocketMap`). Splitting services would force an external pub/sub (Redis) + sticky sessions immediately — a big jump in operational cost for a product at this scale.
- **Shared domain**: Messaging, conversations, and calls all read/write the same Mongo collections and helper libraries. Keeping them co-located avoids network hops and distributed transactions.
- **Deploy simplicity**: One artifact, one set of env vars, one log stream.

The codebase is nonetheless **internally modular** (controllers / routes / models / lib), so a future split along those seams is feasible. See [Scalability](#9-scalability-considerations).

---

## 3. Architectural patterns in use

| Pattern | Where | Why |
|---------|-------|-----|
| **Layered (n-tier) backend** | `routes → middleware → controllers → models/lib` | Clear separation of transport, auth, business logic, and persistence. |
| **Modular monolith** | Whole `server/` | Single deployable, internally bounded by domain modules. |
| **MVC-ish** | Mongoose models + Express controllers + React views | Familiar separation of data, logic, and presentation. |
| **Event-driven / pub-sub** | Socket.IO rooms & events | Decouples producers (a sender) from consumers (participants, other devices). |
| **Optimistic UI + reconciliation** | `ChatContext` send flow | Instant feedback; server response reconciles the temp message via `clientId`. |
| **Provider/Context (DI for the UI)** | React context tree | Cross-cutting state (auth, chat, calls, locale) injected without prop drilling. |
| **Repository-ish helpers** | `lib/conversationHelpers`, `lib/blockHelpers` | Encapsulate recurring data access/derivation patterns. |
| **Background worker / scheduler** | `lib/messageScheduler` | Time-based side effects (release scheduled, expire disappearing) decoupled from request lifecycles. |
| **Claim-based job processing** | scheduler `resetStale → release → expire` | Safe-ish concurrency control for the scheduled-message queue. |
| **Idempotency key** | message `clientId` | De-duplicates retried sends. |
| **Cursor pagination** | message history | Stable, scalable paging over large histories. |
| **Signed direct upload** | Cloudinary signature endpoint | Offloads media bytes from the server. |
| **Feature flag** | `CALLS_ENABLED`, `MESSAGE_SCHEDULER_ENABLED` | Toggle subsystems without code changes. |
| **Defense in depth** | helmet + cookies + rate limit + sanitize + SSRF guard | Multiple independent safety layers. |

---

## 4. Component architecture

### 4.1 Backend component map

```mermaid
graph LR
  subgraph Entry["server.js (entrypoint)"]
    HTTP["http.createServer"]
    IOInit["Socket.IO init + JWT handshake"]
    Mw["helmet · cookieParser · json · cors"]
  end

  subgraph Routes["routes/"]
    uR["userRoutes"]
    mR["messageRoutes"]
    cR["conversationRoutes"]
    pR["pushRoutes"]
    rR["reportRoutes"]
    upR["uploadRoutes"]
    callR["callRoutes"]
  end

  subgraph Mid["middleware/"]
    auth["auth.protectRoute"]
    rl["rateLimit.*"]
  end

  subgraph Ctrl["controllers/"]
    uC["userControllers"]
    mC["messageController"]
    cC["conversationController"]
    pC["pushController"]
    rC["reportController"]
    upC["uploadController"]
    callC["callController"]
  end

  subgraph Lib["lib/"]
    db["db"]
    utils["utils (JWT/cookies)"]
    cld["cloudinary"]
    convH["conversationHelpers"]
    blkH["blockHelpers"]
    pushS["pushService"]
    unfurl["linkUnfurl"]
    sched["messageScheduler"]
    callSig["callSignaling"]
    callCon["callContract"]
    turn["twilioTurn"]
  end

  subgraph Models["models/"]
    U["User"]
    M["Message"]
    C["Conversation"]
    R["Report"]
  end

  Entry --> Routes
  Routes --> Mid
  Routes --> Ctrl
  Ctrl --> Lib
  Ctrl --> Models
  Lib --> Models
  IOInit --> callSig
  Entry --> sched
```

Each module is documented in detail in [Backend Reference](./04-backend.md) and [Code Reference](./14-code-reference.md).

### 4.2 Frontend component map

```mermaid
graph TB
  main["main.jsx (bootstrap)"]
  EB["ErrorBoundary"]
  Locale["LocaleProvider"]
  Router["BrowserRouter"]
  Auth["AuthProvider"]
  Chat["ChatProvider"]
  Call["CallProvider"]
  App["App.jsx (routes + chrome)"]

  main --> EB --> Locale --> Router --> Auth --> Chat --> Call --> App

  App --> Home["HomePage"]
  App --> Login["LoginPage"]
  App --> Profile["ProfilePage"]

  Home --> Sidebar
  Home --> ChatContainer
  Home --> RightSidebar
  Home --> Modals["Global/Starred/Forward/Report modals · Lightbox"]
  Home --> CallUI["CallOverlay · IncomingCallModal"]

  ChatContainer --> MessageList
  MessageList --> Virtuoso["react-virtuoso rows"]
  MessageList --> MsgBits["ReactionBar · MessageMenu · AudioMessage · LinkPreviewCard · MessageText"]
```

Full hierarchy and props in [Frontend Reference](./07-frontend.md).

---

## 5. Service interactions & responsibilities

| Plane | Responsibility | Notes |
|-------|----------------|-------|
| **React SPA** | Rendering, optimistic state, local reconciliation, media capture/upload, WebRTC peer connection | Holds auth token in `localStorage`; sets it on axios + socket handshake. |
| **Express REST API** | CRUD + commands (auth, profile, messages, conversations, reports, push, upload signatures, ICE) | Stateless per request; relies on JWT for identity. |
| **Socket.IO server** | Realtime fan-out: presence, typing, receipts, reaction/edit/delete relays, call signaling | Stateful: keeps `userSocketMap` and room membership in memory. |
| **Message scheduler** | Release due scheduled messages, expire disappearing messages, reset stale claims | In-process `setInterval`, single-flight guarded. |
| **MongoDB** | System of record for users, messages, conversations, reports | Indexed for the read/write patterns below. |
| **Cloudinary** | Media storage + CDN; deletion via `public_id` | Direct signed uploads from the browser. |
| **Twilio** | TURN/STUN credentials for NAT traversal | Short-lived ICE tokens minted server-side. |
| **Push providers** | Deliver Web Push to offline users | Per-subscription; failed subscriptions are pruned. |

### Authentication's dual role

A single JWT secures **both** transports:

```mermaid
sequenceDiagram
  participant C as Client
  participant API as Express
  participant IO as Socket.IO

  C->>API: POST /api/auth/login (email, password[, 2FA])
  API-->>C: { token, user } + Set-Cookie (httpOnly jwt)
  Note over C: store token in localStorage,<br/>set axios header + socket auth
  C->>API: Subsequent REST (cookie or Bearer header)
  API->>API: protectRoute → verify JWT → req.user
  C->>IO: connect (handshake.auth.token)
  IO->>IO: io.use → jwt.verify → socket.userId
  IO-->>C: connected (joined to conversation rooms)
```

---

## 6. Request/response flows

### 6.1 REST request lifecycle

```mermaid
graph LR
  A["Client axios call"] --> B["CORS check (origin allowlist)"]
  B --> C["helmet headers"]
  C --> D["cookieParser + json(8mb)"]
  D --> E["Route match /api/..."]
  E --> F["Rate limiter (per route family)"]
  F --> G["protectRoute (JWT → req.user)"]
  G --> H["Controller (validate → business logic)"]
  H --> I["Models / lib (Mongo, Cloudinary, push)"]
  I --> J["Optionally emit Socket.IO events"]
  J --> K["JSON response { success, ... }"]
```

Most controllers return a normalized envelope: `{ success: boolean, message?: string, ...data }`. Errors are mapped to appropriate HTTP status codes — see [API Reference](./06-api-reference.md#error-codes).

### 6.2 Realtime event lifecycle

```mermaid
graph LR
  A["Client emits / API triggers"] --> B{"Has conversationId?"}
  B -- "yes" --> C["Verify socket is in conversation room"]
  C --> D["socket.to(room).emit(event)"]
  B -- "no (legacy DM)" --> E["emitToUserSockets(to, event)"]
  D --> F["All other devices in room receive"]
  E --> F
```

Note the **authorization check on relays**: before relaying typing/seen/edit/delete/reaction to a conversation room, the server verifies `socket.rooms.has(roomName)`. A client cannot spoof events into a room it has not joined.

---

## 7. End-to-end data flows

### 7.1 Sending a message (with media, receipts, push)

```mermaid
sequenceDiagram
  autonumber
  participant A as Sender SPA
  participant CLD as Cloudinary
  participant API as Express
  participant DB as MongoDB
  participant IO as Socket.IO
  participant B as Recipient SPA
  participant P as Push

  opt Has attachment
    A->>API: GET /api/upload/signature
    API-->>A: { signature, timestamp, apiKey, folder }
    A->>CLD: direct upload (XHR + progress)
    CLD-->>A: { secure_url, public_id }
  end
  A->>A: Insert optimistic message (clientId, status=sending)
  A->>API: POST /api/messages/send/:conversationId (text, media, clientId)
  API->>API: validate · block check · resolve conversation
  alt sendAt in future
    API->>DB: Message(scheduledStatus=pending, sendAt)
    API-->>A: scheduled message (UI shows badge)
  else immediate
    API->>DB: Message(status=sent, readBy=[A], disappear→expiresAt)
    API->>DB: Conversation.lastMessageAt = now
    API->>IO: emitToConversation(newMessage)
    IO-->>B: newMessage
    IO-->>A: newMessage (other devices)
    API-->>A: created message (reconcile by clientId → status=sent)
    alt recipient online
      API->>DB: status=delivered
      API-->>A: messageDelivered
    else offline & not muted
      API->>P: web push
    end
  end
  B->>API: PUT /api/messages/mark/:id (viewed)
  API->>IO: messagesSeen / readBy update
  IO-->>A: status=read
```

### 7.2 Scheduled & disappearing messages (background job)

```mermaid
sequenceDiagram
  autonumber
  participant T as Scheduler tick (every POLL_MS)
  participant DB as MongoDB
  participant IO as Socket.IO

  loop every ~5s (single-flight)
    T->>DB: resetStaleScheduledMessages (claim older than STALE_CLAIM_MS → pending)
    T->>DB: releaseDueScheduledMessages (sendAt<=now, claim→sent, batch=25)
    DB-->>T: released messages
    T->>IO: emit newMessage to conversations
    T->>DB: expireDueMessages (expiresAt<=now → soft delete, batch=50)
    T->>IO: emit messageDeleted/expired
  end
```

Design rationale: a **claim/lease** model (set `scheduledStatus=processing` with a timestamp, reset stale claims) prevents a crashed tick from permanently stranding messages, and bounds work per tick with batch sizes. See [Backend](./04-backend.md#scheduler) and [Database](./05-database.md#scheduling-fields).

### 7.3 Media upload (direct, signed)

```mermaid
graph LR
  A["User picks file"] --> B["Client validates type/size"]
  B --> C["GET /api/upload/signature"]
  C --> D["Server signs params with API secret"]
  D --> E["Browser uploads bytes directly to Cloudinary"]
  E --> F["Cloudinary returns secure_url + public_id"]
  F --> G["Client sends message referencing URL + public_id"]
  G --> H["On delete: server destroys asset by public_id"]
```

Why: base64-through-the-API uploads inflate payloads ~33% and consume serverless bandwidth/time. Signed direct upload keeps large bytes off the API path while the server retains deletion authority via `public_id`.

### 7.4 Authentication & 2FA

```mermaid
sequenceDiagram
  participant C as Client
  participant API as Express
  participant DB as MongoDB

  C->>API: POST /api/auth/signup (fullName,email,password)
  API->>DB: create User (bcrypt hash)
  API-->>C: token + user

  C->>API: POST /api/auth/login (email,password)
  API->>DB: find user · bcrypt.compare
  alt 2FA enabled & no/invalid code
    API-->>C: { twoFactorRequired: true }
    C->>API: POST /api/auth/login (... + twoFactorToken)
    API->>API: otplib.verify(token, secret)
  end
  API-->>C: token + user (+ httpOnly cookie)
```

Full detail in [Security](./09-security.md).

### 7.5 Calling (WebRTC) — signaling overview

```mermaid
sequenceDiagram
  participant A as Caller
  participant IO as Socket.IO
  participant B as Callee
  participant ICE as Twilio TURN

  A->>IO: call:invite (to, callType)
  IO-->>B: call:incoming
  A->>ICE: GET /api/calls/ice-servers
  B->>ICE: GET /api/calls/ice-servers
  B->>IO: call:accept
  IO-->>A: call:accepted
  A->>IO: call:offer (SDP)
  IO-->>B: call:offer
  B->>IO: call:answer (SDP)
  IO-->>A: call:answer
  A->>IO: call:ice-candidate (trickle)
  IO-->>B: call:ice-candidate
  Note over A,B: Media flows P2P, or relayed via TURN if NAT-blocked
  A->>IO: call:end
  IO-->>B: call:ended
```

Complete state machine and error/end reasons in [Real-Time & Calling](./08-realtime-and-calls.md).

---

## 8. Design decisions & rationale

| Decision | Alternatives considered | Why this choice |
|----------|------------------------|-----------------|
| **MERN + Socket.IO** | Phoenix/Elixir, Go + gRPC, Firebase | One language (JS) across the stack; Socket.IO gives robust reconnection/fallbacks; huge ecosystem. |
| **Conversation-centric model** | Pure message-pair model | Unifies 1:1 and group under one abstraction; per-participant prefs and rooms become natural. |
| **JWT in httpOnly cookie + localStorage token** | Sessions in DB, cookie-only | Cookie protects against XSS token theft for REST; localStorage token enables the socket handshake and cross-origin Bearer fallback during transition. (Trade-off discussed in [Security](./09-security.md).) |
| **In-memory presence map** | Redis pub/sub | Zero extra infra at current scale; explicitly the first thing to externalize when scaling horizontally. |
| **Signed direct Cloudinary uploads** | Proxy through API; S3 | Saves bandwidth/time; CDN delivery; server keeps deletion control. |
| **In-process scheduler** | Cron service, queue (BullMQ/SQS) | Simplest thing that works; claim/lease gives basic safety. Externalize for multi-instance. |
| **Optimistic UI w/ clientId idempotency** | Pessimistic (wait for server) | Instant feel; idempotency avoids duplicate sends on retry. |
| **Cursor pagination + virtualization** | Offset pagination, render-all | Stable under inserts; bounded memory/DOM for long histories. |
| **Sanitized markdown (`rehype-sanitize`)** | Raw HTML, plain text | Rich text without XSS. |
| **SSRF-guarded unfurl** | Naive fetch | Prevents link previews from probing internal networks. |
| **Vercel serverless** | Long-lived VM/container, k8s | Cheap, zero-ops hosting. Trade-off: ephemeral instances complicate in-memory presence + scheduler (see DevOps). |

---

## 9. Scalability considerations

quickCHAT today is optimized for a **single backend instance**. The scaling path is well understood:

```mermaid
graph TB
  subgraph Now["Today (single instance)"]
    I1["Node instance<br/>userSocketMap + rooms in memory<br/>scheduler in-process"]
  end
  subgraph Next["Horizontal scale"]
    LB["Sticky LB / WS-aware ingress"]
    N1["Node #1"]
    N2["Node #2"]
    Redis[("Redis<br/>socket.io-adapter + presence")]
    Job["External job runner<br/>(single scheduler owner)"]
  end
  Now --> Next
  LB --> N1 & N2
  N1 <--> Redis
  N2 <--> Redis
  Job --> Redis
```

**What scales already:**
- REST API is stateless (modulo DB) → trivially horizontally scalable.
- MongoDB indexes target the hot paths (conversation history, search, scheduling). See [Database](./05-database.md#indexing-strategy).
- Media is offloaded to Cloudinary's CDN; the API never streams media bytes.
- Pagination + virtualization bound per-client and per-query cost.

**What must change to scale out horizontally:**
1. **Socket.IO across instances** → add the Redis adapter so rooms/broadcasts span instances; presence must move to Redis (or be derived from adapter room membership).
2. **Scheduler ownership** → only one instance (or an external worker / leader election) should run the release/expire job, or claims must be globally coordinated (the claim/lease model already helps).
3. **Sticky sessions / WS-aware routing** so a socket stays on one instance for its lifetime.
4. **CORS/cookie domains** consolidated to a stable apex domain.

**Vertical/throughput levers available now:**
- Scheduler batch sizes and poll interval are env-tunable (`MESSAGE_SCHEDULER_*`).
- JSON body cap (`8mb`) and rate limits bound abusive load.
- `.lean()` reads and projections keep query payloads small.

---

## 10. Reliability & fault tolerance

| Concern | Mechanism |
|---------|-----------|
| **Flaky client networks** | Socket.IO auto-reconnect; on reconnect, `markPendingDelivered` flips queued `sent` messages to `delivered` and notifies senders; rooms re-joined on connect. |
| **Lost/failed sends** | Optimistic message marked `failed` with retry/discard affordance; `clientId` idempotency prevents duplicates on retry. |
| **Multi-device consistency** | `userSocketMap` is `Map<userId, Set<socketId>>`; events fan out to all of a user's sockets; self-echo keeps other tabs/devices in sync. |
| **Crashed scheduler tick** | `resetStaleScheduledMessages` reclaims messages stuck in `processing` beyond `STALE_CLAIM_MS`; single-flight guard avoids overlapping ticks. |
| **Push delivery failures** | Expired/invalid subscriptions are detected and pruned from the user document. |
| **TURN/calls misconfig** | `CALLS_ENABLED` flag; ICE endpoint returns `503` (with STUN-only fallback path) when Twilio creds are missing, instead of failing opaquely. |
| **Render-time exceptions** | React `ErrorBoundary` catches render errors and offers reload instead of a white screen. |
| **Malicious/oversized input** | Rate limiters per route family; body size cap; markdown sanitization; SSRF guard on unfurl. |
| **Data durability** | MongoDB Atlas (replica set, backups) as system of record; soft deletes preserve audit/threading integrity. |
| **Graceful degradation** | If push/calls/unfurl are unavailable, core messaging continues to function. |

### Known reliability caveats (be honest)

- **In-memory presence + in-process scheduler** assume a single instance. On Vercel's serverless model these are best-effort; see [DevOps](./10-devops-and-infrastructure.md) and [Maintenance → Known limitations](./13-maintenance-guide.md#known-limitations).
- **No message broker**: realtime fan-out is direct; a dropped instance loses its in-flight in-memory state (but never persisted data).

---

## 11. Cross-cutting concerns

| Concern | Approach | Reference |
|---------|----------|-----------|
| **AuthN/AuthZ** | JWT (cookie + bearer), `protectRoute`, room membership checks, block enforcement | [Security](./09-security.md) |
| **Validation** | Per-controller input checks; Mongoose schema constraints | [API](./06-api-reference.md) |
| **Rate limiting** | `express-rate-limit` families (auth, send, unfurl, block, report, calls) | [Backend](./04-backend.md#rate-limiting) |
| **Error handling** | Normalized JSON envelopes + status codes; client `getErrorMessage`; `ErrorBoundary` | [Backend](./04-backend.md) · [Frontend](./07-frontend.md) |
| **Observability** | `console` logging (scheduler, sockets, errors) | [DevOps](./10-devops-and-infrastructure.md#monitoring--logging) |
| **i18n / RTL** | Custom runtime + locale JSON (en, ar), `dir` switching | [Frontend](./07-frontend.md#internationalization) |
| **Theming** | Tailwind v4 CSS variables, `data-theme` light/dark | [Frontend](./07-frontend.md#styling-system) |
| **Config / flags** | Env-driven (`CALLS_ENABLED`, `MESSAGE_SCHEDULER_*`, `CLIENT_ORIGINS`) | [DevOps](./10-devops-and-infrastructure.md#environment-configuration) |

---

## 12. Where to go next

- The concrete module/domain breakdown and design patterns at code level: [System Design](./03-system-design.md).
- Per-module backend internals: [Backend Reference](./04-backend.md).
- The realtime/calling protocols in depth: [Real-Time & Calling](./08-realtime-and-calls.md).
