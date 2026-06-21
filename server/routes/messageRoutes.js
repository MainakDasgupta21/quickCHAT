import express from "express"
import { protectRoute } from "../middleware/auth.js";
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

messageRouter.get("/users" , protectRoute , getUserForSidebar)
messageRouter.get("/search/:id", protectRoute, searchMessages)
messageRouter.get("/:id" , protectRoute , getMessages)
messageRouter.put("/mark/:id" , protectRoute , markMessageAsSeen)
messageRouter.post("/send/:id" , protectRoute , sendMessage)
messageRouter.put("/edit/:id", protectRoute, editMessage)
messageRouter.delete("/:id", protectRoute, deleteMessage)
messageRouter.post("/react/:id", protectRoute, reactToMessage)


export default messageRouter 