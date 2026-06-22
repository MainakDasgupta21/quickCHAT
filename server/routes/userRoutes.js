import express from "express"
import { checkAuth, login, logout, Signup, updateProfile } from "../controllers/userControllers.js";
import { protectRoute } from "../middleware/auth.js";
import { authRateLimiter } from "../middleware/rateLimit.js";


const userRouter = express.Router();

userRouter.post('/signup', authRateLimiter, Signup);
userRouter.post('/login', authRateLimiter, login);
userRouter.post('/logout', logout);
userRouter.put('/update-profile' , protectRoute , updateProfile);
userRouter.get('/check' , protectRoute , checkAuth);


export default userRouter;