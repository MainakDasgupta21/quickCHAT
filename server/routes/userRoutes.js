import express from "express"
import {
  beginTwoFactorSetup,
  blockUser,
  checkAuth,
  disableTwoFactor,
  enableTwoFactor,
  getBlockedUsers,
  login,
  logout,
  Signup,
  unblockUser,
  updateProfile,
  verifyTwoFactorLogin,
} from "../controllers/userControllers.js";
import { protectRoute } from "../middleware/auth.js";
import {
  authRateLimiter,
  blockActionRateLimiter,
  twoFactorActionRateLimiter,
} from "../middleware/rateLimit.js";


const userRouter = express.Router();

userRouter.post('/signup', authRateLimiter, Signup);
userRouter.post('/login', authRateLimiter, login);
userRouter.post("/2fa/login/verify", authRateLimiter, verifyTwoFactorLogin);
userRouter.post('/logout', logout);
userRouter.put('/update-profile' , protectRoute , updateProfile);
userRouter.get('/check' , protectRoute , checkAuth);
userRouter.post("/2fa/setup", protectRoute, twoFactorActionRateLimiter, beginTwoFactorSetup);
userRouter.post("/2fa/enable", protectRoute, twoFactorActionRateLimiter, enableTwoFactor);
userRouter.post("/2fa/disable", protectRoute, twoFactorActionRateLimiter, disableTwoFactor);
userRouter.get("/blocked-users", protectRoute, getBlockedUsers);
userRouter.post("/block/:id", protectRoute, blockActionRateLimiter, blockUser);
userRouter.delete("/block/:id", protectRoute, blockActionRateLimiter, unblockUser);


export default userRouter;