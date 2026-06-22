import User from "../models/User.js";
import jwt from "jsonwebtoken";


//middleware to protect the routes
export const protectRoute = async (req , res , next) => {
        try{
                const token = req.headers.token;
                if(!token){
                        return res.status(401).json({success:false , message:"Not authorized, no token"});
                }

                const decoded = jwt.verify(token,process.env.JWT_SECRET)
                const user = await User.findById(decoded.userId).select("-password")
                if(!user){
                        return res.status(401).json({success:false , message:"User not found"});
                }

                req.user = user;
                next();
        }catch(error){
                // Invalid/expired tokens should surface as 401 so clients can clear
                // the stale credential and redirect to login.
                console.log(error.message);
                res.status(401).json({success: false , message: "Not authorized, token failed"});
        }
}






