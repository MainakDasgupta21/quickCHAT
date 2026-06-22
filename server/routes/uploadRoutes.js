import express from "express";
import { protectRoute } from "../middleware/auth.js";
import { getUploadSignature } from "../controllers/uploadController.js";

const uploadRouter = express.Router();

uploadRouter.get("/signature", protectRoute, getUploadSignature);

export default uploadRouter;
