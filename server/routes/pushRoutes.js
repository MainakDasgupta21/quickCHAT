import express from "express";
import { protectRoute } from "../middleware/auth.js";
import {
  getPublicVapidKey,
  subscribeToPush,
  unsubscribeFromPush,
} from "../controllers/pushController.js";

const pushRouter = express.Router();

pushRouter.get("/vapid-public-key", getPublicVapidKey);
pushRouter.post("/subscribe", protectRoute, subscribeToPush);
pushRouter.delete("/subscribe", protectRoute, unsubscribeFromPush);

export default pushRouter;
