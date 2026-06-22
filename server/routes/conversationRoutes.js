import express from "express";
import { protectRoute } from "../middleware/auth.js";
import { messageSendRateLimiter } from "../middleware/rateLimit.js";
import {
  addConversationMembers,
  createGroupConversation,
  getConversationById,
  getConversationContacts,
  getConversations,
  getOrCreateDirectConversationByUser,
  leaveConversation,
  removeConversationMember,
  updateConversation,
} from "../controllers/conversationController.js";
import {
  getMessages,
  searchMessages,
  sendMessage,
} from "../controllers/messageController.js";

const conversationRouter = express.Router();

conversationRouter.get("/", protectRoute, getConversations);
conversationRouter.get("/contacts", protectRoute, getConversationContacts);
conversationRouter.get("/:id", protectRoute, getConversationById);
conversationRouter.post("/group", protectRoute, createGroupConversation);
conversationRouter.post("/direct/:id", protectRoute, getOrCreateDirectConversationByUser);
conversationRouter.patch("/:id", protectRoute, updateConversation);
conversationRouter.post("/:id/members", protectRoute, addConversationMembers);
conversationRouter.delete(
  "/:id/members/:userId",
  protectRoute,
  removeConversationMember
);
conversationRouter.post("/:id/leave", protectRoute, leaveConversation);

// Conversation-first message endpoints.
conversationRouter.get("/:id/messages", protectRoute, getMessages);
conversationRouter.get("/:id/search", protectRoute, searchMessages);
conversationRouter.post(
  "/:id/messages",
  protectRoute,
  messageSendRateLimiter,
  sendMessage
);

export default conversationRouter;
