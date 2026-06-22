import express from "express";
import { createReport } from "../controllers/reportController.js";
import { protectRoute } from "../middleware/auth.js";
import { reportActionRateLimiter } from "../middleware/rateLimit.js";

const reportRouter = express.Router();

reportRouter.post("/", protectRoute, reportActionRateLimiter, createReport);

export default reportRouter;
