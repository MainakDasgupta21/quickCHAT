# quickCHAT — Product & Engineering Roadmap

## 1. Current product maturity

quickCHAT is a genuinely polished 1:1 real-time messenger that already nails the "table stakes + a layer of craft" tier: Socket.IO presence/typing/seen, reactions, replies, edit, soft-delete, in-conversation regex search with highlight/navigation, Cloudinary image/file/voice attachments with drag-drop/paste, an emoji system, keyboard shortcuts with focus traps, browser notifications, a tokenized glassmorphism design system with skeletons and reduced-motion support, and sensible performance work (memoized `MessageRow`, route-level code splitting, and the sidebar's last-message/unseen aggregation in `getUserForSidebar` that already eliminated the N+1).

Where it is not yet world-class is structural rather than cosmetic:

- The data model is hard-wired to 1:1 (`senderId`/`receiverId` are required on `messageSchema`), so there are no conversations, groups, threads, or mentions.
- Real-time is single-socket-per-user and in-memory (`userSocketMap[userId] = socket.id`), so there's no multi-device, no horizontal scale, and an unauthenticated socket handshake (the `userId` in `socket.handshake.query` is never verified against the JWT).
- `getMessages` returns the entire conversation unbounded with no pagination or virtualization.
- Sends are non-optimistic and silently lossy (a failed `sendMessage` still clears the composer).
- There is no last-seen persistence, no push, no PWA, no theming/i18n, and minimal hardening (CORS `*`, no rate limiting, no helmet, token in localStorage).

Closing those gaps is what moves it from "great portfolio chat app" to "enterprise-ready product."

## 2. Prioritized roadmap

**Effort key:** S ≤1 day · M 2–5 days · L 1–2 weeks · XL multi-week. Risk reflects blast radius on existing features/data.

| # | Feature | Category | Impact | Effort | Risk | Key files / endpoints affected |
|---|---------|----------|--------|--------|------|--------------------------------|
| 1 | Optimistic send + retry + true status states (sending/sent/delivered/read/failed) | Reliability | ★★★★★ | M | Med | `context/ChatContext.jsx` (sendMessage), `components/ChatContainer.jsx` (handleSendMessage), `components/MessageList.jsx`, `controllers/messageController.js` (sendMessage), `models/message.js` (status, clientId) |
| 2 | Message pagination (cursor) + windowed rendering | Reliability/Perf | ★★★★★ | M | Med | `controllers/messageController.js` (getMessages), `routes/messageRoutes.js`, `context/ChatContext.jsx`, `components/ChatContainer.jsx`, `components/MessageList.jsx` |
| 3 | Hardened auth: verified socket handshake + httpOnly cookie + rate limit + helmet | Trust & safety | ★★★★★ | M | High | `server.js` (io connection), `middleware/auth.js`, `lib/utils.js`, `controllers/userControllers.js`, `context/AuthContext.jsx` |
| 4 | Group conversations (introduce Conversation model) | Messaging depth | ★★★★★ | L–XL | High | NEW `models/Conversation.js`, `models/message.js`, all of `messageController.js`, `server.js` rooms, both contexts, Sidebar, ChatContainer |
| 5 | Persistent last-seen + multi-device fan-out | Real-time | ★★★★ | M | Med | `models/User.js` (lastSeen), `server.js` (userSocketMap → Map<id,Set>), controllers, Sidebar, ChatContainer, RightSidebar |
| 6 | PWA install + Web Push notifications | Growth | ★★★★ | M–L | Med | NEW `client/public/manifest.webmanifest` + service worker, `models/User.js` (push subs), NEW push route, `AuthContext.jsx` |
| 7 | Image lightbox/gallery + video messages + upload progress + Cloudinary public_id lifecycle | Media | ★★★★ | M | Low | `MessageList.jsx`, `RightSidebar.jsx`, NEW `Lightbox.jsx`, `ChatContainer.jsx`, `messageController.js`, `models/message.js` |
| 8 | Global cross-conversation search + jump-to-message | Search & org | ★★★ | M | Low | NEW `/api/messages/search` (global), `messageController.js`, `ChatContext.jsx`, NEW search modal, uses existing text index |
| 9 | @Mentions + threads | Collaboration | ★★★★ | L | Med | depends on #4; `message.js` (mentions, threadRoot/replyCount), `messageController.js`, MessageList, composer in ChatContainer |
| 10 | Organization suite: pin · star · archive · mute · forward | Search & org | ★★★ | M | Low–Med | per-user conversation metadata (rides on #4 or a UserMeta), Sidebar, RightSidebar, MessageMenu, new routes |
| 11 | Light theme toggle | Growth/polish | ★★★ | S | Low | `src/index.css` (@theme tokens), `index.html` theme-color, `AuthContext.jsx`, Sidebar menu |
| 12 | Markdown / code blocks / clickable links + link unfurling | Messaging depth | ★★★ | M | Low | `MessageList.jsx` render, NEW unfurl endpoint + `message.js` preview{} |
| 13 | Scheduled & disappearing messages | Messaging depth | ★★★ | M | Med | `message.js` (sendAt, expiresAt TTL), `messageController.js`, scheduler, composer |
| 14 | Blocking & reporting | Trust & safety | ★★★ | M | Low | `models/User.js` (blocked[]), `messageController.js` guards, RightSidebar/MessageMenu |
| 15 | i18n + RTL foundation | Growth/polish | ★★★ | M | Low | new i18n layer, all string sites, `index.html` dir |
| 16 | Redis Socket.IO adapter (horizontal scale) | Real-time | ★★★ | M | Med | `server.js`, infra; prerequisite for multi-instance presence |
| 17 | 2FA (TOTP) | Trust & safety | ★★ | M | Low | `User.js`, `userControllers.js`, `LoginPage.jsx` |
| 18 | Workspaces/teams + roles + admin console + audit log | Enterprise | ★★★★ | XL | High | new Workspace/Membership/AuditLog models, scoping across all queries |
| 19 | Voice/video calling (WebRTC) | Enterprise/depth | ★★★★ | XL | High | new signaling socket events, TURN infra, new UI |
| 20 | E2E encryption | Trust & safety | ★★★ | XL | Very High | conflicts with server search/unfurl/preview; client crypto, key mgmt |

## 3. Detailed write-ups (top 10)

### Feature 1 — Optimistic send + retry + true message status states

**Value prop:** Messages appear instantly and never silently vanish on a flaky network — with real `sending → sent → delivered → read → failed` feedback like WhatsApp/Telegram.

**Problem & behavior:** Today `ChatContainer.handleSendMessage` awaits `ChatContext.sendMessage` and then unconditionally clears the composer (`setInput("")`, clears attachments), while `sendMessage` swallows errors with a toast. A failed POST therefore loses the user's typed message. There is also no "delivered" concept — `MessageList` shows ✓ vs ✓✓ purely from the `seen` boolean, so ✓ is shown even when the recipient was offline and the socket never delivered anything. Expected: the message renders immediately as a pending bubble (clock icon), retries with backoff, shows a "Failed — tap to retry" affordance on error, transitions to ✓ sent (persisted), ✓ delivered (recipient socket ack'd), ✓✓ read (seen).

**Fit with current architecture:**

- `models/message.js`: add `status: { type: String, enum: ["sent","delivered","read"], default: "sent" }` and a transient `clientId` (String, indexed, sparse) to de-dupe the optimistic echo against the server's `newMessage`.
- `context/ChatContext.jsx` `sendMessage`: generate a `clientId`, push a temp message with `status: "sending"` before the request, then reconcile on success (swap temp for `data.newMessage` by `clientId`) or mark `status:"failed"` on error instead of just toasting. Add a `retryMessage(clientId)`.
- `components/ChatContainer.jsx` `handleSendMessage`: only clear the composer for new sends after the optimistic insert (keep current behavior visually) but keep the payload in the failed bubble for retry.
- `components/MessageList.jsx` `MessageRow`: replace the `{message.seen ? "✓✓" : "✓"}` block with a status renderer (sending/failed/sent/delivered/read).
- Server: in `sendMessage`, when `emitToUser(receiverId, "newMessage", …)` finds a live socket, emit a `messageDelivered` back to the sender (and set `status:"delivered"`); on reconnect, flush delivered for messages received while offline.

**Backend implications:** Minimal — one enum field + one sparse index on `clientId`. New socket event `messageDelivered` (sender-side). No migration needed (default `status:"sent"` for existing rows). Pairs naturally with #5 (deliver-on-reconnect).

**Effort/Risk/Deps:** M / Medium. Touches the hot send path; guard the de-dupe carefully. No hard deps; complements #2 and #5.

**Benchmark closed:** WhatsApp/Telegram delivery ticks and offline resilience.

### Feature 2 — Message pagination (cursor) + windowed rendering

**Value prop:** Conversations with thousands of messages open instantly and scroll smoothly instead of fetching and rendering the entire history.

**Problem & behavior:** `getMessages` runs `Message.find(getConversationFilter(...)).sort({createdAt:1})` with no limit, and `ChatContext.getMessages` drops the whole array into state; `MessageList` maps every message (no virtualization). For a long-lived chat this is an unbounded query + unbounded DOM. Expected: load the most recent ~30, lazily fetch older pages when the user scrolls to the top ("load earlier"), and only render a window of rows.

**Fit with current architecture:**

- `controllers/messageController.js` `getMessages`: accept `?before=<messageId|ISO>&limit=30`, query `createdAt < cursor` sorted descending, `.limit(limit)`, then reverse for display; return `hasMore` + `nextCursor`. The existing compound indexes `{senderId,receiverId,createdAt:-1}` / `{receiverId,senderId,createdAt:-1}` already support this efficiently.
- Decouple the seen-marking side-effect: currently `getMessages` also `updateMany(... seen:true)`. Keep that, but only for the fetched page (or move to an explicit mark-as-read on view).
- `context/ChatContext.jsx`: track `hasMore`/`cursor`; add `loadOlderMessages()` that prepends.
- `components/ChatContainer.jsx`: the existing `scrollContainerRef`/`isNearBottom` logic must learn a "near top" trigger and preserve scroll offset on prepend; the "jump to latest" + `pendingBelowCount` logic stays.
- `components/MessageList.jsx`: introduce windowing. Lightweight option first (render last N + "load earlier" button) before a full virtualization lib, because `MessageRow` relies on `messageElementRefs` for reply-scroll and search-scroll — virtualization must keep refs valid for the visible window.

**Backend implications:** No schema change; pure query shaping using existing indexes. Conflicts to watch: in-conversation search (#8/jump-to-message) and reply-scroll assume the target message is in the DOM — add a "fetch around message id" path so jumping to an old match loads its page.

**Effort/Risk/Deps:** M / Medium. Scroll-anchoring on prepend is the fiddly part. Foundational for #4 and #8.

**Benchmark closed:** Slack/Telegram-grade history performance.

### Feature 3 — Hardened auth: verified socket handshake + httpOnly cookie + rate limiting + helmet

**Value prop:** Closes a real impersonation hole and brings the app to a baseline production security posture.

**Problem & behavior:** The socket connection trusts `const userId = socket.handshake.query.userId` without verifying the JWT (`server.js`). Any client can connect with someone else's `userId`, land in `userSocketMap`, and receive that user's real-time `newMessage`/`typing`/`seen` events plus emit forged `typing`/`seen`. Separately: JWT lives in localStorage (XSS-exfiltratable) and travels in a custom token header; CORS is `origin:"*"`; there's no rate limiting on `/api/auth/login` (brute-force) or `sendMessage`, and no helmet.

**Fit with current architecture:**

- `server.js`: read the token from `socket.handshake.auth.token`, `jwt.verify` it, set `socket.userId` from the decoded payload (ignore any client-supplied id). Reject on failure. `context/AuthContext.jsx` `connectSocket` already builds the socket — switch `query:{userId}` to `auth:{ token }`.
- `middleware/auth.js`: accept the token from an httpOnly cookie (fallback to the existing token header for backward compatibility during migration). Add `cookie-parser`.
- `controllers/userControllers.js` (login/Signup): also `res.cookie("token", token, {httpOnly,secure,sameSite})`. Keep returning token in the body during transition so existing clients don't break.
- Add `express-rate-limit` (tight on `/api/auth/*`, looser on messages) and `helmet` in `server.js`; tighten CORS origin to the known frontend URL + `credentials:true`.

**Backend implications:** New deps (`helmet`, `express-rate-limit`, `cookie-parser`). Backward-compat: dual-read token (cookie OR header) so the current localStorage flow keeps working until the client migrates; then drop header. CORS `*` → explicit origin is required for cookies.

**Effort/Risk/Deps:** M / High (auth changes are high-blast-radius — ship behind the dual-read fallback). No deps; should precede any enterprise work (#18).

**Benchmark closed:** Baseline security expected by any enterprise buyer.

### Feature 4 — Group conversations (introduce a Conversation model)

**Value prop:** The single biggest capability gap — turns a 1:1 messenger into a real chat platform (groups like WhatsApp/Slack/Discord).

**Problem & behavior:** Every message requires `senderId` + `receiverId`; routing is 1:1 via `emitToUser(receiverId, …)` and `getConversationFilter`. There is no notion of a room. Expected: create named group chats with N participants, add/remove members, group avatar, per-conversation message fan-out, and a sidebar that lists groups and DMs together.

**Fit with current architecture (migration path):**

- NEW `models/Conversation.js`: `{ type: "direct"|"group", participants:[ObjectId ref User], name, avatar, admins:[ObjectId], lastMessageAt, createdBy }`.
- `models/message.js`: add `conversationId` (ref Conversation, indexed). Keep `senderId`; make `receiverId` optional (`required:false`) for backward compat — backfill a Conversation per existing DM pair and stamp `conversationId` in a one-time migration so old `getConversationFilter` rows still resolve.
- `controllers/messageController.js`: replace pair-based queries with `conversationId`-based ones. `sendMessage` writes once and fans out to all participants; `getUserForSidebar` becomes `getConversations` (aggregate last message + unseen per conversation, not per user) — this also fixes the current "global user directory" scaling problem where `User.find({_id:{$ne:userId}})` returns every user.
- `server.js`: use Socket.IO rooms — on connect, `socket.join(conversationId)` for each membership; emit message/typing/seen to `io.to(conversationId)` instead of a single `receiverSocketId`.
- Client: `ChatContext` shifts from `selectedUser` to `selectedConversation`; Sidebar renders conversations; ChatContainer header shows group name/members; seen receipts become per-participant (a `readBy:[{userId,at}]` array on message rather than a single `seen` boolean).

**Backend implications:** New collection + indexes (`conversationId+createdAt`), a data migration, and a rethink of the `seen` boolean → `readBy[]` (impacts unread counts and the ✓/✓✓ UI). New endpoints: create/update/leave conversation, manage members. This is the keystone that unlocks #9 (threads/mentions) and #10 (pin/archive/mute scale much better keyed by conversation).

**Effort/Risk/Deps:** L–XL / High. Do #2 first (pagination), and ideally #3 (rooms benefit from verified socket identity). Backward-compat hinges on the DM→Conversation backfill.

**Benchmark closed:** Core WhatsApp/Slack/Discord group messaging.

### Feature 5 — Persistent last-seen + multi-device socket fan-out

**Value prop:** Accurate "last seen 5m ago" presence and the ability to stay logged in on phone + laptop simultaneously.

**Problem & behavior:** `onlineUsers` is purely in-memory; Sidebar/ChatContainer/RightSidebar show a hardcoded "Last seen recently" / "Currently offline" because no `lastSeen` is stored. And `userSocketMap[userId] = socket.id` keeps one socket per user — a second device overwrites the first, so the first device stops receiving real-time events.

**Fit with current architecture:**

- `models/User.js`: add `lastSeen: Date`.
- `server.js`: on disconnect, set `User.lastSeen = new Date()`. Change `userSocketMap` from `{userId: socketId}` to `Map<userId, Set<socketId>>`; `emitToUser` (in `messageController.js`) iterates the set; only mark offline/lastSeen when the last socket for a user disconnects. `getOnlineUsers` derives from map keys.
- Client: ChatContainer header and RightSidebar render real `lastSeen` via a `formatLastSeen()` helper in `src/lib/utils.js`; Sidebar row subtitle uses it instead of the literal "Last seen recently."

**Backend implications:** One field; map-shape change ripples through `emitToUser` and every `userSocketMap[...]` lookup in `messageController.js` and `server.js`. With multiple instances this still needs #16 (Redis) to share presence — single-instance is fine today.

**Effort/Risk/Deps:** M / Medium. Pairs with #1 (deliver-on-reconnect) and #3. Multi-instance correctness depends on #16.

**Benchmark closed:** WhatsApp last-seen + Telegram/Slack multi-device.

### Feature 6 — PWA install + Web Push notifications

**Value prop:** Installable app icon and notifications that arrive even when the tab is closed — the difference between a website and a product people keep.

**Problem & behavior:** Notifications today are `new Notification(...)` in `AuthContext.showNotification`, gated on `document.hidden`, so they only fire while the tab is open. There is no manifest, no service worker (`index.html` only sets theme-color/apple-touch-icon). Expected: "Add to home screen," offline app shell, and push delivery via the OS.

**Fit with current architecture:**

- NEW `client/public/manifest.webmanifest` (name, icons from existing `favicon.svg`/logo, `display:standalone`, theme/background from the `#0f0d18` token) + link it in `index.html`.
- NEW service worker (Vite PWA plugin or hand-rolled) for the offline shell + push/notificationclick handlers.
- `models/User.js`: `pushSubscriptions: [{ endpoint, keys }]`.
- NEW route `POST /api/push/subscribe` + server `web-push` with VAPID keys. In `messageController.sendMessage`, after `emitToUser`, if the recipient has no live socket, send a Web Push.
- `context/AuthContext.jsx`: extend `requestNotificationPermission` to also register the SW and persist the PushSubscription.

**Backend implications:** New dep (`web-push`), VAPID env keys, a subscriptions array on User, and push-on-offline logic in the send path. Be careful not to double-notify (socket notification when online, push when offline). Ties into #5 (online/offline decision).

**Effort/Risk/Deps:** M–L / Medium. Independent, but more valuable after #5.

**Benchmark closed:** WhatsApp/Telegram/Slack native-app reach.

### Feature 7 — Image lightbox/gallery + video messages + upload progress + Cloudinary lifecycle

**Value prop:** Media feels first-class — full-screen viewing, inline video, real upload feedback, and no orphaned storage.

**Problem & behavior:** Images open via `window.open(message.image, "_blank")` in both `MessageList` and `RightSidebar` — no in-app lightbox, zoom, or swipe-through gallery. Video isn't supported as a media type (it would render as a generic file link). Uploads have no progress (base64 → Cloudinary happens server-side inside `sendMessage`; the user sees nothing until it returns). And soft-delete in `deleteMessage` clears `message.image`/`file`/`audio` but the Cloudinary asset is never deleted because only `secure_url` is stored — there's no `public_id` to delete by, so storage leaks forever.

**Fit with current architecture:**

- NEW `components/Lightbox.jsx`: full-screen viewer wired to `MessageList` image buttons and `RightSidebar` shared-media grid (`msgImages`), with prev/next across the conversation's images and Esc-to-close (reuse the focus-trap pattern from HomePage/Sidebar).
- Video: add video handling in `ChatContainer.processFileInput` and a `<video>` renderer in `MessageRow`; `message.js` `file.type` already carries the MIME so detection is trivial; Cloudinary already uploads with `resource_type:"auto"`.
- Upload progress: switch the send to axios `onUploadProgress` for the base64 POST and show a determinate bar in the composer preview (the `selectedImage`/`selectedFile`/`selectedAudio` previews already exist).
- Cloudinary lifecycle: store `public_id` alongside url in `fileSchema`/`audioSchema` and image (promote image to an object or add `imagePublicId`). In `deleteMessage`, call `cloudinary.uploader.destroy(public_id)`. Same hygiene for `updateProfile` (old avatar is never removed today).

**Backend implications:** Schema additions for `public_id` (additive, backward-compatible — old rows just won't be destroyable). For large/video files, the base64-through-JSON path (`express.json({limit:"8mb"})`) won't scale — the strategic move is signed direct-to-Cloudinary uploads from the client (new `GET /api/upload/signature` endpoint), bypassing the server body limit and enabling true progress. That also relaxes the current 5MB cap (`MAX_IMAGE_UPLOAD_BYTES`).

**Effort/Risk/Deps:** M / Low. Lightbox + video are quick; signed uploads + public_id are the higher-value, slightly bigger pieces. No deps.

**Benchmark closed:** WhatsApp/Telegram media viewer + larger/video uploads.

### Feature 8 — Global cross-conversation search + jump-to-message

**Value prop:** "Find that message anywhere" — search across all conversations and jump straight to it in context.

**Problem & behavior:** `searchMessages` is scoped to one conversation (`getConversationFilter(myId, selectedUserId)` + regex). There's no global search, and matches can only be navigated within the currently loaded message array.

**Fit with current architecture:**

- NEW `GET /api/messages/search?q=` (no `:id`): query all of the user's messages. The model already has a text index (`messageSchema.index({ text: "text" })`), currently unused by the regex search — switch global search to `$text` (fast, ranked) and keep per-conversation regex for substring/highlight.
- `messageController.js`: return matches grouped by conversation/peer with a snippet + createdAt.
- `context/ChatContext.jsx`: add `globalSearch(query)`; NEW search modal (reuse the HomePage dialog/focus-trap pattern) listing results across chats.
- Jump-to-message: selecting a result sets the conversation and, with #2 in place, fetches the page around that message id then scrolls to it via the existing `messageElementRefs` mechanism in `MessageList`.

**Backend implications:** Uses the existing text index (no new index needed for `$text`; if you keep regex, consider a case-insensitive collation). Jump-to-message depends on #2's "fetch around id."

**Effort/Risk/Deps:** M / Low. Strongly complemented by #2; even better after #4 (search across groups).

**Benchmark closed:** Slack/Telegram global search.

### Feature 9 — @Mentions + threads

**Value prop:** Group conversations stay organized and people get pinged on what matters — the Slack/Discord collaboration core.

**Problem & behavior:** No mentions and no threaded replies (`replyTo` exists but is a single-level quote, not a thread). In a group, every message is equal noise.

**Fit with current architecture (depends on #4):**

- `models/message.js`: add `mentions: [ObjectId ref User]` and thread fields — either reuse `replyTo` as the thread root or add `threadRoot` + `replyCount`.
- Composer in `ChatContainer.jsx`: `@` autocomplete sourced from the conversation's participants; persist matched user ids in `mentions`.
- `messageController.sendMessage`: parse/validate mentions; emit a distinct mention notification (feeds #6 push and the existing `showNotification`), and bump unread differently for mentioned users.
- `MessageList.jsx`: render mention chips; render a "N replies" affordance opening a thread panel (a filtered view by `threadRoot`).

**Backend implications:** Additive fields; a mentions index if you build a "mentions" inbox. Threads multiply read-state complexity — lean on #4's `readBy[]`. Reply-scroll/jump reuse `messageElementRefs`.

**Effort/Risk/Deps:** L / Medium. Hard dependency on #4; benefits from #6 (mention pushes).

**Benchmark closed:** Slack/Discord mentions + threads.

### Feature 10 — Organization suite: pin · star · archive · mute · forward

**Value prop:** Users tame a busy inbox — pin important chats, star key messages, archive/mute the rest, and forward messages onward.

**Problem & behavior:** The sidebar (`getUserForSidebar` → Sidebar) only sorts by `lastMessageAt`. There's no pin/archive/mute and no per-message star or forward. `MessageMenu` exposes only Reply/Edit/Delete.

**Fit with current architecture:**

- Per-user conversation metadata: with #4, store pinned/archived/mutedUntil on the `Conversation.participants` subdoc; without #4, add a `UserConversationMeta` collection keyed by `{userId, peerId}`. (Avoid stuffing UI state onto the global User.)
- Starred messages: `message.js` `starredBy: [ObjectId]` (additive). NEW "Starred" view.
- Forward: a thin `POST /api/messages/forward` that re-runs the existing `sendMessage` create path to one or more targets (copies text/image/file/audio, clears replyTo/reactions). Add "Forward" + "Star" to `MessageMenu.jsx`.
- Mute: suppress sound/notification in `ChatContext.subscribeToMessages` (which currently always calls `playReceiveCue`/`showNotification`) and badge muted chats differently in Sidebar.

**Backend implications:** Mostly additive fields + a couple of small endpoints; archive/mute affect sidebar sorting/filtering and the unread/notification logic in `ChatContext`. Low schema risk.

**Effort/Risk/Deps:** M / Low–Med. Pin/star/forward are near quick-wins; archive/mute are cleanest after #4.

**Benchmark closed:** WhatsApp pin/archive/mute/star/forward.

## 4. Quick wins (≤1 day each)

- **Light theme toggle** — tokens are already CSS-first in `src/index.css` `@theme`; add a `:root[data-theme="light"]` override block, a toggle in the Sidebar actions menu + AuthContext (persist like `soundEnabled`), and swap the fixed `index.html` theme-color/color-scheme. (#11)
- **Clickable links + basic markdown/code blocks** — render-only change in `MessageList.MessageRow` (auto-link URLs, `**bold**`, `` `code` ``, fenced ``` blocks); the unused `code.svg` asset hints this was intended. (Unfurl is the bigger follow-on, #12.)
- **Star a message** — additive `starredBy` + a "Star" item in `MessageMenu.jsx`. (Slice of #10.)
- **Forward a message** — reuse `sendMessage`'s create path behind `POST /api/messages/forward`. (Slice of #10.)
- **Cloudinary cleanup on profile change** — `updateProfile` currently orphans the previous avatar; store/destroy by `public_id`. (Slice of #7.)
- **Image lightbox** — replace `window.open(...)` in `MessageList`/`RightSidebar` with an in-app full-screen viewer. (Slice of #7.)
- **Fix the lossy send** — at minimum, don't clear the composer in `ChatContainer.handleSendMessage` until `sendMessage` resolves successfully. (Down-payment on #1.)
- **helmet + express-rate-limit on /api/auth** — a few lines in `server.js`, big security ROI. (Slice of #3.)
- **Persist lastSeen** — one field on User + a write on socket disconnect; immediately makes the "last seen" UI real. (Slice of #5.)
- **Empty-state "start a new chat"** — Sidebar already lists all users; add an explicit "New chat" entry point.

## 5. Big bets (multi-week)

- **#4 Group conversations** — the keystone Conversation model migration (and `seen` → `readBy[]`); unlocks #9 and scales #10/#8.
- **#18 Workspaces/teams + roles/permissions + admin console + audit log (+ SSO)** — the enterprise tier; requires scoping every query by workspace and a membership/role model. Pairs with SSO (OIDC/SAML) and an immutable AuditLog.
- **#19 Voice/video calling (WebRTC)** — new signaling events over the existing Socket.IO layer + TURN/STUN infra; large new UI surface.
- **#16 Redis Socket.IO adapter + presence store** — prerequisite for running more than one server instance correctly (today `userSocketMap` and `onlineUsers` are per-process); enables true horizontal scale and correct multi-instance presence for #5.
- **#20 End-to-end encryption** — highest-trust feature but conflicts with the current server-side `searchMessages`/text index, link unfurling (#12), and the `getUserForSidebar` last-message preview, all of which read plaintext. Migration path: move search to a client-side encrypted index and drop server-readable previews/unfurl for E2E conversations. Treat as opt-in per conversation.

**Sequencing recommendation for a single author (max impact/effort):** ship the #1/#2/#3 reliability-and-security base and the quick-wins first (they fix real bugs and harden the app with little blast radius), then land #4 Conversations as the keystone, after which #5, #6, #7, #8, #9, #10 slot in cleanly. Save #16/#18/#19/#20 as deliberate big bets.
