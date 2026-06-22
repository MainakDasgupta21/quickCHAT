import express from "express"
import {
  blockUser,
  checkAuth,
  getBlockedUsers,
  login,
  logout,
  Signup,
  unblockUser,
  updateProfile,
} from "../controllers/userControllers.js";
import { protectRoute } from "../middleware/auth.js";
import { authRateLimiter, blockActionRateLimiter } from "../middleware/rateLimit.js";


const userRouter = express.Router();

userRouter.post('/signup', authRateLimiter, Signup);
userRouter.post('/login', authRateLimiter, login);
userRouter.post('/logout', logout);
userRouter.put('/update-profile' , protectRoute , updateProfile);
userRouter.get('/check' , protectRoute , checkAuth);
userRouter.get("/blocked-users", protectRoute, getBlockedUsers);
userRouter.post("/block/:id", protectRoute, blockActionRateLimiter, blockUser);
userRouter.delete("/block/:id", protectRoute, blockActionRateLimiter, unblockUser);


export default userRouter;