import express from "express"
import { protectRoute } from "../middleware/auth.js";
import { messageSendRateLimiter } from "../middleware/rateLimit.js";
import {
  deleteMessage,
  editMessage,
  getMessages,
  getUserForSidebar,
  markMessageAsSeen,
  reactToMessage,
  searchMessages,
  sendMessage,
} from "../controllers/messageController.js";

const messageRouter = express.Router();

// Legacy routes (peer-id compatible).
messageRouter.get("/users" , protectRoute , getUserForSidebar)
messageRouter.get("/search/:id", protectRoute, searchMessages)
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