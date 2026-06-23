# 15 — Glossary

[← Back to index](./README.md)

Definitions of the domain and technical terms used throughout this documentation. Terms are grouped for easier scanning.

---

## Domain terms

| Term | Definition |
|------|------------|
| **Conversation** | The aggregate that groups messages. Either `direct` (1:1) or `group`. Stored in the `conversations` collection. |
| **Direct conversation** | A 1:1 conversation between exactly two users, uniquely keyed by a `directKey`. |
| **Group conversation** | A multi-party conversation (2+ participants) with a name/avatar, an owner (`createdBy`), and admin/member roles. |
| **Participant** | An embedded record of a user's membership in a conversation, carrying role + per-user preferences (pin/archive/mute/lastReadAt). |
| **directKey** | A deterministic, sorted concatenation of two user ids (`idA:idB`) used to uniquely identify and de-duplicate a direct conversation. |
| **Message** | A single chat item (text and/or media) belonging to a conversation. |
| **Reaction** | An emoji a user attaches to a message (`{userId, emoji}`). |
| **Reply** | A message that references another via `replyTo`. |
| **Thread** | A set of replies under a `threadRoot` message; `replyCount` caches the size. |
| **Mention** | A user referenced in a message via `@`; stored in `mentions[]` and triggers a notification. |
| **Scheduled message** | A message with a future `sendAt`, stored `pending` and released later by the scheduler. |
| **Disappearing message** | A message that auto-expires after `disappearAfterMs` (computed into `expiresAt`) and is then soft-deleted. |
| **Soft delete** | Marking a message `isDeleted` and blanking its content/media while keeping the document (preserves threads/receipts). |
| **Star** | A per-user bookmark on a message (`starredBy[]`). |
| **Forward** | Copying a message into other conversations/users. |
| **Unfurl / Link preview** | Server-fetched Open Graph metadata for a URL in a message (`preview`). |
| **Presence** | Whether a user is online (has ≥1 connected socket) and their `lastSeen` timestamp. |
| **Read receipt** | Evidence a message was read: per-user `readBy[]`, plus the legacy `seen` boolean for direct chats. |
| **Delivery receipt** | Evidence a message reached a recipient: per-user `deliveredTo[]` and the coarse `status`. |
| **Block** | A user preventing messaging/calling with another (bidirectional enforcement). |
| **Report** | A trust-and-safety submission against a user or message. |

## Status & state values

| Term | Definition |
|------|------------|
| **Message `status`** | `sent → delivered → read` — the coarse, tick-driving state. (Client also models transient `sending`/`failed`.) |
| **`scheduledStatus`** | `pending` (awaiting release) / `processing` (claimed by a scheduler tick) / `released` (live). |
| **Call state** | `ringing → connecting → active → ended` (client adds `idle`/`incoming`). |

## Technical terms

| Term | Definition |
|------|------------|
| **MERN** | MongoDB, Express, React, Node.js — the core stack. |
| **SPA** | Single-Page Application; the React frontend. |
| **PWA** | Progressive Web App; installable, service-worker-enabled web app. |
| **Socket.IO** | The realtime (WebSocket-based) library used for events. |
| **Room** | A Socket.IO broadcast group; here `conversation:<id>`. |
| **Handshake** | The initial socket connection where the JWT is verified. |
| **JWT** | JSON Web Token; the signed credential for sessions (and the 2FA challenge). |
| **TOTP** | Time-based One-Time Password; the 2FA algorithm (`otplib`). |
| **VAPID** | Voluntary Application Server Identification; key pair authenticating Web Push. |
| **Web Push** | Browser push-notification protocol for offline delivery. |
| **Service Worker** | Background script (`sw.js`) handling push + notification clicks. |
| **WebRTC** | Browser peer-to-peer audio/video media stack. |
| **SDP** | Session Description Protocol; the offer/answer describing a WebRTC session. |
| **ICE candidate** | A possible network path for WebRTC media. |
| **STUN** | A server that helps a peer discover its public address (NAT discovery). |
| **TURN** | A relay server that forwards media when direct P2P is blocked (Twilio here). |
| **NAT** | Network Address Translation; why STUN/TURN are needed. |
| **Signaling** | Exchanging SDP/ICE (over Socket.IO here) to set up a WebRTC call. |
| **Cloudinary** | Managed media storage + CDN. |
| **Signed (direct) upload** | Browser uploads media straight to Cloudinary using a server-signed request. |
| **public_id** | Cloudinary's identifier for an asset, used to delete it. |
| **Optimistic UI** | Rendering an action's result immediately, before server confirmation. |
| **Reconciliation** | Replacing an optimistic item with the authoritative server item (here, by `clientId`). |
| **clientId** | A client-generated idempotency key on a message to prevent duplicate sends. |
| **Idempotency** | A repeated operation having the same effect as doing it once. |
| **Cursor / keyset pagination** | Paging via a stable cursor (`createdAt` + `_id`) rather than offsets. |
| **Around mode** | Fetching a window of messages centered on a target message ("jump to message"). |
| **Virtualization** | Rendering only visible list rows (via `react-virtuoso`) to bound DOM size. |
| **Claim / lease** | Marking a job `processing` so only one worker handles it, with stale-claim recovery. |
| **Single-flight** | Ensuring only one instance of an operation runs at a time (the scheduler tick guard). |
| **Partial index** | A MongoDB index covering only documents matching a filter (used for scheduling/expiry). |
| **Sparse index** | An index that only includes documents where the field exists (`directKey`, `clientId`). |
| **`select:false`** | A Mongoose flag excluding a field from normal queries (secrets/large arrays). |
| **`.lean()`** | A Mongoose option returning plain objects (no document hydration) for speed. |
| **SSRF** | Server-Side Request Forgery; mitigated in the unfurl fetcher. |
| **XSS** | Cross-Site Scripting; mitigated via markdown sanitization. |
| **CSRF** | Cross-Site Request Forgery; mitigated via cookie `sameSite` + bearer-token usage. |
| **CORS** | Cross-Origin Resource Sharing; controlled by the origin allowlist. |
| **helmet** | Express middleware that sets secure HTTP headers. |
| **Rate limiting** | Capping request/event frequency to prevent abuse. |
| **Modular monolith** | A single deployable process internally organized into bounded modules. |
| **Context (React)** | React's dependency-injection mechanism for cross-cutting state. |
| **HMR** | Hot Module Replacement; Vite's instant-update dev feature. |
| **RTL** | Right-to-left text direction (e.g. Arabic). |
| **i18n** | Internationalization. |

---

[← Back to index](./README.md)
