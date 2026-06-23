# 14 — Code Reference (File-by-File)

[← Back to index](./README.md) · Related: [Backend](./04-backend.md) · [Frontend](./07-frontend.md) · [Database](./05-database.md)

An annotated map of the entire repository. Use this as the index when you need to find "where does X live?". Deep behavioral explanations live in the linked chapters; this is the directory.

---

## 1. Top level

```text
quickCHAT/
├── client/        # React SPA
├── server/        # Node/Express + Socket.IO API & realtime
├── docs/          # this documentation set
├── ROADMAP.md     # product/engineering roadmap (historical + planned)
└── README.md      # quick-start
```

---

## 2. Backend — `server/`

### 2.1 Entry & config

| File | Purpose |
|------|---------|
| `server.js` | Entrypoint: Express app, HTTP server, Socket.IO init + JWT handshake, presence (`userSocketMap`), socket relay handlers, route mounting, DB connect, scheduler start. ([Backend §2](./04-backend.md#2-entrypoint--serverjs)) |
| `package.json` | Deps + scripts (`server`, `start`, `cleanup:group-direct-keys`). |
| `vercel.json` | Serverless build/route config. |
| `.env` | Secrets/config (not committed). |

### 2.2 `models/`

| File | Exports | Notes |
|------|---------|-------|
| `User.js` | `User` | Account, 2FA secrets (`select:false`), `blockedUsers`, `pushSubscriptions` (`select:false`), `lastSeen`. ([DB §3.1](./05-database.md#31-users-collection--user)) |
| `Conversation.js` | `Conversation` | `direct`/`group`, embedded `participants` (role + per-user prefs), unique sparse `directKey`. ([DB §3.2](./05-database.md#32-conversations-collection--conversation)) |
| `message.js` | `Message` | Content, relationships, scheduling, receipts, reactions, dual-key bridge; many indexes. ([DB §3.3](./05-database.md#33-messages-collection--message)) |
| `Report.js` | `Report`, `REPORT_TARGET_TYPES`, `REPORT_REASONS`, `REPORT_STATUSES` | Trust & safety. ([DB §3.4](./05-database.md#34-reports-collection--report)) |

### 2.3 `routes/`

| File | Mount | Endpoints |
|------|-------|-----------|
| `userRoutes.js` | `/api/auth` | signup, login, 2FA, profile, block. |
| `messageRoutes.js` | `/api/messages` | history, send, mark, edit, delete, react, star, forward, thread, search, unfurl, users + conversation aliases. |
| `conversationRoutes.js` | `/api/conversations` | list/contacts/get, direct/group create, members, prefs, leave, message aliases. |
| `pushRoutes.js` | `/api/push` | VAPID key, subscribe/unsubscribe. |
| `reportRoutes.js` | `/api/reports` | create report. |
| `uploadRoutes.js` | `/api/upload` | upload signature. |
| `callRoutes.js` | `/api/calls` | ICE servers, telemetry. |

Full contracts in [API Reference](./06-api-reference.md).

### 2.4 `middleware/`

| File | Exports | Purpose |
|------|---------|---------|
| `auth.js` | `protectRoute` | JWT verification → `req.user` (401 on failure). |
| `rateLimit.js` | `authRateLimiter`, `twoFactorActionRateLimiter`, `messageSendRateLimiter`, `unfurlRateLimiter`, `blockActionRateLimiter`, `reportActionRateLimiter`, `callIceRateLimiter` | Per-family throttling. |

### 2.5 `controllers/`

| File | Key exports |
|------|-------------|
| `userControllers.js` | `Signup`, `login`, `verifyTwoFactorLogin`, `checkAuth`, `logout`, `updateProfile`, `beginTwoFactorSetup`, `enableTwoFactor`, `disableTwoFactor`, `blockUser`, `unblockUser`, `getBlockedUsers` |
| `messageController.js` | `getMessages`, `sendMessage`, `markMessageAsSeen`, `editMessage`, `deleteMessage`, `reactToMessage`, `toggleMessageStar`, `getStarredMessages`, `forwardMessage`, `getThreadMessages`, `searchMessages`, `searchMessagesGlobal`, `unfurlMessageLink`, `getUserForSidebar`, + scheduler fns `releaseDueScheduledMessages`/`resetStaleScheduledMessages`/`expireDueMessages` |
| `conversationController.js` | `getConversations`, `getConversationContacts`, `getConversationById`, `getOrCreateDirectConversationByUser`, `createGroupConversation`, `addConversationMembers`, `removeConversationMember`, `leaveConversation`, `updateConversation`, `updateConversationPreferences` |
| `uploadController.js` | `getUploadSignature` |
| `pushController.js` | `getPublicVapidKey`, `subscribeToPush`, `unsubscribeFromPush` |
| `reportController.js` | `createReport` |
| `callController.js` | `getIceServers`, `getCallTelemetry` |

Behavioral detail in [Backend §4](./04-backend.md#4-controllers-business-logic-layer).

### 2.6 `lib/`

| File | Key exports / role |
|------|--------------------|
| `db.js` | `connectDB` — Mongo connection. |
| `utils.js` | `generateToken`, `getTokenFromRequest`, `setAuthCookie`, `clearAuthCookie`, `AUTH_COOKIE_NAME`. |
| `cloudinary.js` | `uploadBase64ToCloudinary`, `destroyCloudinaryAsset`, `createCloudinaryUploadSignature`, `isCloudinaryConfigured`. |
| `conversationHelpers.js` | `getConversationRoomName`, `buildDirectKey`, `getOrCreateDirectConversation`, `assertParticipant`, `resolveConversationFromParam`, `emitToConversation`, room-join helpers, id utils. |
| `blockHelpers.js` | `getUserBlockedSet`, `getBlockedSetMap`, `createBlockState`, `isBlockedByEitherSide`, `isMessagingBlocked`, `getConversationBlockState`, `resolveDirectPeerId`, `toBlockMessageForSender`. |
| `pushService.js` | `getVapidPublicKey`, `isPushConfigured`, `sendPushToUsers`, `sendPushToUser`. |
| `linkUnfurl.js` | `extractUrlsFromText`, `fetchLinkPreview` (SSRF-guarded). |
| `messageScheduler.js` | `startMessageScheduler`, `stopMessageScheduler`. |
| `callSignaling.js` | `registerCallSignalingHandlers`, `isCallsFeatureEnabled`, `getCallTelemetrySnapshot`. |
| `callContract.js` | `CALL_TYPES`, `CALL_SOCKET_EVENTS`, `CALL_STATES`, `CALL_ERROR_CODES`, `CALL_END_REASONS`, `isValidCallType`. |
| `twilioTurn.js` | `hasTwilioTurnConfig`, `getFallbackIceServers`, `fetchTwilioIceServers`. |

### 2.7 `scripts/`

| File | Purpose |
|------|---------|
| `migrate-dm-to-conversations.js` | Backfill conversations + `readBy` from legacy DMs. |
| `cleanup-group-direct-keys.js` | Remove stray `directKey` from groups (`npm run cleanup:group-direct-keys`). |

---

## 3. Frontend — `client/`

### 3.1 Entry & config

| File | Purpose |
|------|---------|
| `src/main.jsx` | Bootstrap: provider tree + service-worker registration. |
| `src/App.jsx` | Routes (lazy), auth gate, connection banner, Toaster, splash. |
| `src/index.css` | Tailwind v4 theme tokens, light/dark, component classes, animations, a11y. |
| `index.html` | App shell; PWA manifest/theme-color; inline locale/theme init. |
| `vite.config.js` | React + Tailwind plugins. |
| `eslint.config.js` | ESLint config. |
| `vercel.json` | SPA rewrite. |
| `.env` | `VITE_BACKEND_URL`. |
| `package.json` | Deps + scripts (`dev`, `build`, `preview`, `lint`). |

### 3.2 `context/`

| File | Provides |
|------|----------|
| `AuthContext.jsx` | Session, axios, socket, theme/sound, notifications/push, 2FA, block graph, online users, connection status. |
| `ChatContext.jsx` | Conversations/messages state + all actions + inbound socket subscriptions. |
| `CallContext.jsx` | WebRTC call state + actions. |
| `LocaleContext.jsx` | i18n (`t`, `isRtl`, `direction`, locale switching) + `useLocale`. |

Detail in [Frontend §4](./07-frontend.md#4-state-management--the-four-contexts).

### 3.3 `src/pages/`

| File | Route |
|------|-------|
| `HomePage.jsx` | `/` — workspace grid + modals + call UI. |
| `LoginPage.jsx` | `/login` — signup/login/2FA. |
| `ProfilePage.jsx` | `/profile` — profile + 2FA management. |

### 3.4 `src/components/`

| File | Role |
|------|------|
| `Sidebar.jsx` | Conversation list, search, presence, settings menu, new chat/group. |
| `ChatContainer.jsx` | Conversation pane: header, composer (mentions/scheduling/disappearing/emoji/attachments), reply bar. |
| `MessageList.jsx` | Virtualized messages (Virtuoso), dividers, badges, reply snippets, reactions. |
| `RightSidebar.jsx` | Conversation details/media/members. |
| `MessageMenu.jsx` | Per-message actions. |
| `ReactionBar.jsx` | Emoji reactions. |
| `AudioMessage.jsx` | Voice-note player. |
| `LinkPreviewCard.jsx` | Unfurl preview rendering. |
| `ConversationAvatar.jsx` | Avatar + presence/group indicator. |
| `CreateGroupModal.jsx` | Group creation. |
| `ForwardMessageModal.jsx` | Forward target picker. |
| `GlobalSearchModal.jsx` | Global search. |
| `StarredMessagesModal.jsx` | Starred list. |
| `ReportModal.jsx` | Report user/message. |
| `Lightbox.jsx` | Media viewer. |
| `AppSplash.jsx` | Loading screen. |
| `ErrorBoundary.jsx` | Render-error recovery (class component). |
| `calls/CallOverlay.jsx` | Active-call UI. |
| `calls/CallControls.jsx` | Mute/camera/hang-up. |
| `calls/IncomingCallModal.jsx` | Ringing/accept/reject. |

### 3.5 `src/lib/`

| File | Role |
|------|------|
| `conversations.js` | Conversation/message derivations (title/avatar/peer/preview, block state, pending/expiry). |
| `utils.js` | Formatting, `getErrorMessage`, client-id, size caps. |
| `messageText.jsx` | Sanitized markdown + highlight + safe links. |
| `messageTextPreview.js` | Strip markdown for previews. |
| `mediaUpload.js` | Signed direct Cloudinary upload + progress. |
| `pushNotifications.js` | SW registration + push subscribe/unsubscribe. |
| `sound.js` | Send/receive audio cues. |
| `webrtc/callSession.js` | `RTCPeerConnection` management. |
| `webrtc/mediaDevices.js` | `getUserMedia`. |
| `webrtc/callContract.js` | Client call constants. |

### 3.6 `src/hooks/`, `src/i18n/`, `src/assets/`, `public/`

| Path | Role |
|------|------|
| `hooks/useKeyboardShortcuts.js` | Global keyboard shortcuts. |
| `i18n/runtime.js` | Translation loading/interpolation/number formatting/direction. |
| `i18n/localeMeta.js` | Supported locales (`en` LTR, `ar` RTL). |
| `i18n/locales/<locale>/common.json` | Translation strings. |
| `assets/assets.js` | Curated icon imports (demo data intentionally removed from the bundle). |
| `public/sw.js` | Service worker (push + notification click). |
| `public/manifest.webmanifest` | PWA manifest. |
| `public/favicon.svg`, `public/bgImage.svg` | Static assets. |

---

## 4. "Where do I change…?" quick index

| Goal | Start here |
|------|-----------|
| New REST endpoint | `server/routes/*` + `server/controllers/*` |
| New realtime event | controller emit (`emitToConversation`) + `server.js` relay + `ChatContext` subscribe |
| New DB field | `server/models/*` (+ `server/scripts/*` migration) |
| New UI screen/component | `client/src/pages` or `client/src/components` + context |
| New setting/preference | `Conversation.participants` or `User` + controller + context |
| Styling/theme token | `client/src/index.css` |
| Translation | `client/src/i18n/locales/<locale>/common.json` |
| Calling behavior | `server/lib/callSignaling.js` + `client/context/CallContext.jsx` |
| Rate limits | `server/middleware/rateLimit.js` / `callSignaling.js` |

---

[← Back to index](./README.md)
