# quickCHAT — Engineering Documentation

Welcome to the complete, production-grade documentation set for **quickCHAT**, a full-stack, real-time messaging platform built on the MERN stack with Socket.IO, WebRTC, and Cloudinary.

This documentation is written so that a brand-new developer, architect, DevOps engineer, QA engineer, or stakeholder can fully understand, operate, maintain, extend, and deploy the system **without any prior knowledge of the project**.

> If you read only one page first, read [Project Overview](./01-project-overview.md), then the [Architecture](./02-architecture.md) and the [Development Guide](./12-development-guide.md).

---

## What is quickCHAT?

quickCHAT is a 1:1 and group real-time chat application with:

- JWT + HTTP-only cookie authentication, with optional TOTP two-factor authentication.
- Direct (1:1) and group conversations with roles, pin/archive/mute preferences.
- Real-time messaging over Socket.IO: presence, typing, read receipts, reactions, edits, soft-delete.
- Optimistic sending with automatic retry and `sending → sent → delivered → read → failed` status.
- Cursor-based message pagination with virtualized rendering and "jump to message".
- Rich media via Cloudinary: images, files, voice notes, video — with signed direct uploads and progress.
- Mentions, threads, message starring, forwarding, global and in-conversation search.
- Scheduled messages and disappearing (auto-expiring) messages, driven by a background scheduler.
- Server-side link unfurling (SSRF-hardened), markdown rendering, and link preview cards.
- Web Push notifications via a service worker + PWA install manifest.
- 1:1 audio/video calling over WebRTC with Socket.IO signaling and Twilio TURN.
- Block/report safety tooling, light/dark theming, i18n scaffolding (English + Arabic/RTL).

---

## Documentation map

| # | Document | Audience | What's inside |
|---|----------|----------|---------------|
| 01 | [Project Overview](./01-project-overview.md) | Everyone | Purpose, business goals, use cases, feature catalogue, high-level system view |
| 02 | [Architecture](./02-architecture.md) | Architects, devs | System architecture, patterns, decisions, component & data-flow & sequence diagrams, scalability, fault tolerance |
| 03 | [System Design (HLD & LLD)](./03-system-design.md) | Architects, devs | High- and low-level design, module decomposition, domain model, design patterns, trade-offs, performance |
| 04 | [Backend Reference](./04-backend.md) | Backend devs | Service architecture, business-logic layers, every controller/route/middleware/lib, scheduler & jobs |
| 05 | [Database](./05-database.md) | Backend devs, DBAs | Schema, entity relationships, indexing strategy, migrations, query optimization, data lifecycle |
| 06 | [API Reference](./06-api-reference.md) | Frontend/backend/integrators | Every REST endpoint, payloads, auth, validation, error codes, rate limits, flow examples |
| 07 | [Frontend Reference](./07-frontend.md) | Frontend devs | UI architecture, state management, routing, component hierarchy, styling system, user flows |
| 08 | [Real-Time & Calling](./08-realtime-and-calls.md) | Full-stack devs | Socket.IO events, presence model, rooms, delivery, WebRTC calling signaling and ICE |
| 09 | [Security](./09-security.md) | Security, devs | Authentication, authorization model, hardening, data protection, threat mitigation |
| 10 | [DevOps & Infrastructure](./10-devops-and-infrastructure.md) | DevOps/SRE | Deployment architecture, environments, CI/CD, containerization, monitoring/logging, DR |
| 11 | [Testing](./11-testing.md) | QA, devs | Testing strategy, unit/integration/E2E, coverage expectations, mocking strategy |
| 12 | [Development Guide](./12-development-guide.md) | New developers | Prerequisites, local setup, env vars, running, debugging, contribution guidelines |
| 13 | [Maintenance Guide](./13-maintenance-guide.md) | On-call, maintainers | Troubleshooting, known limitations, upgrades, technical debt, future improvements |
| 14 | [Code Reference (File-by-File)](./14-code-reference.md) | Devs | Annotated folder/file map, key functions and contracts across the whole repo |
| 15 | [Glossary](./15-glossary.md) | Everyone | Definitions of domain and technical terms used throughout |

The original product/engineering roadmap lives at [`../ROADMAP.md`](../ROADMAP.md). Much of what the roadmap proposed has since been implemented; this documentation describes the system **as it exists today**.

---

## Repository at a glance

```text
quickCHAT/
├── client/                 # React 19 + Vite 7 single-page application (frontend)
│   ├── context/            # React context providers (Auth, Chat, Call, Locale)
│   ├── public/             # Static assets, service worker, PWA manifest
│   ├── src/
│   │   ├── components/      # UI components (chat, sidebar, modals, calls)
│   │   ├── pages/           # Route-level pages (Home, Login, Profile)
│   │   ├── lib/             # Client utilities (conversations, webrtc, upload, sound, i18n helpers)
│   │   ├── i18n/            # Locale runtime + translation JSON (en, ar)
│   │   ├── assets/          # Icons/images
│   │   ├── App.jsx          # Routing + global chrome
│   │   ├── main.jsx         # App bootstrap + provider tree
│   │   └── index.css        # Tailwind v4 theme tokens + design system
│   ├── vite.config.js
│   └── package.json
├── server/                 # Node.js + Express 5 + Socket.IO backend
│   ├── controllers/        # Request handlers (users, messages, conversations, calls, push, reports, upload)
│   ├── routes/             # Express routers
│   ├── middleware/          # Auth + rate limiting
│   ├── models/             # Mongoose schemas (User, Message, Conversation, Report)
│   ├── lib/                # DB, JWT, Cloudinary, push, unfurl, scheduler, calls, helpers
│   ├── scripts/            # One-off migration/maintenance scripts
│   ├── server.js           # HTTP + Socket.IO entrypoint
│   └── package.json
├── ROADMAP.md              # Product & engineering roadmap
├── README.md              # Quick-start README
└── docs/                  # ← You are here
```

---

## Technology stack summary

**Backend:** Node.js (ESM), Express 5, Socket.IO 4, Mongoose 8 / MongoDB, JWT (`jsonwebtoken`), `bcryptjs`, Cloudinary SDK, `web-push`, `otplib` + `qrcode` (TOTP 2FA), `helmet`, `express-rate-limit`, `cookie-parser`, `dotenv`.

**Frontend:** React 19, React Router 7, Vite 7, Tailwind CSS 4, `axios`, `socket.io-client`, `react-hot-toast`, `react-markdown` + `remark-gfm` + `rehype-sanitize`, `react-virtuoso`, `emoji-picker-react`.

**Infrastructure:** MongoDB Atlas, Cloudinary (media), Twilio (TURN for calls), Vercel (hosting for both client and server), Web Push (VAPID).

See [Architecture](./02-architecture.md) for how these fit together and **why** each was chosen.

---

## Conventions used in these docs

- **Mermaid diagrams** are embedded throughout. They render natively on GitHub and in most Markdown viewers. If your viewer does not render Mermaid, the diagrams are still readable as text.
- Code references point at real files using `path/to/file.js` notation.
- Environment variable names are written in `UPPER_SNAKE_CASE`. **No real secret values appear anywhere in this documentation** — only placeholders.
- "Direct" = 1:1 conversation; "Group" = multi-party conversation. See the [Glossary](./15-glossary.md).
