import express from "express";
import { getCallTelemetry, getIceServers } from "../controllers/callController.js";
import { protectRoute } from "../middleware/auth.js";
import { callIceRateLimiter } from "../middleware/rateLimit.js";

const callRouter = express.Router();

callRouter.get("/ice-servers", protectRoute, callIceRateLimiter, getIceServers);
callRouter.get("/telemetry", protectRoute, getCallTelemetry);

export default callRouter;
