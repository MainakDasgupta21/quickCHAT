import jwt from "jsonwebtoken";

//function to generate token for a user
export const generateToken = (userId) => {
        // Tokens previously never expired, so a leaked token was valid forever.
        // Scope sessions to 7 days; clients clear invalid/expired tokens on 401.
        const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
                expiresIn: "7d",
        });
        return token;
}