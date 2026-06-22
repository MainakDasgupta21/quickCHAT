import express from "express"
import { protectRoute } from "../middleware/auth.js";
import { messageSendRateLimiter, unfurlRateLimiter } from "../middleware/rateLimit.js";
import {
  deleteMessage,
  editMessage,
  forwardMessage,
  getMessages,
  getStarredMessages,
  getThreadMessages,
  getUserForSidebar,
  markMessageAsSeen,
  reactToMessage,
  searchMessagesGlobal,
  searchMessages,
  sendMessage,
  toggleMessageStar,
  unfurlMessageLink,
} from "../controllers/messageController.js";

const messageRouter = express.Router();

// Legacy routes (peer-id compatible).
messageRouter.get("/users" , protectRoute , getUserForSidebar)
messageRouter.get("/unfurl", protectRoute, unfurlRateLimiter, unfurlMessageLink)
messageRouter.get("/search", protectRoute, searchMessagesGlobal)
messageRouter.get("/starred", protectRoute, getStarredMessages)
messageRouter.get("/search/:id", protectRoute, searchMessages)
messageRouter.post("/forward/:id", protectRoute, messageSendRateLimiter, forwardMessage)
messageRouter.post("/star/:id", protectRoute, toggleMessageStar)
messageRouter.get("/thread/:id", protectRoute, getThreadMessages)
messageRouter.get("/:id" , protectRoute , getMessages)
messageRouter.put("/mark/:id" , protectRoute , markMessageAsSeen)
messageRouter.post("/send/:id" , protectRoute , messageSendRateLimiter , sendMessage)
messageRouter.put("/edit/:id", protectRoute, editMessage)
messageRouter.delete("/:id", protectRoute, deleteMessage)
messageRouter.post("/react/:id", protectRoute, reactToMessage)

// Conversation-first aliases.
messageRouter.get("/conversation/:id", protectRoute, getMessages)
messageRouter.get("/conversation/:id/search", protectRoute, searchMessages)
messageRouter.post(
  "/conversation/:id/send",
  protectRoute,
  messageSendRateLimiter,
  sendMessage
)


export default messageRouter 