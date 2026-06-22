import jwt from "jsonwebtoken";

export const AUTH_COOKIE_NAME = "quickchat_token";
const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const isProduction = () => process.env.NODE_ENV === "production";

const getAuthCookieOptions = () => ({
        httpOnly: true,
        secure: isProduction(),
        sameSite: isProduction() ? "none" : "lax",
        maxAge: AUTH_COOKIE_MAX_AGE_MS,
        path: "/",
});

const getAuthCookieClearOptions = () => ({
        httpOnly: true,
        secure: isProduction(),
        sameSite: isProduction() ? "none" : "lax",
        path: "/",
});

//function to generate token for a user
export const generateToken = (userId) => {
        // Tokens previously never expired, so a leaked token was valid forever.
        // Scope sessions to 7 days; clients clear invalid/expired tokens on 401.
        const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
                expiresIn: "7d",
        });
        return token;
}

export const getTokenFromRequest = (req) => {
        const cookieToken = req?.cookies?.[AUTH_COOKIE_NAME];
        if (typeof cookieToken === "string" && cookieToken.trim()) {
                return cookieToken.trim();
        }

        const headerToken = req?.headers?.token;
        if (typeof headerToken === "string" && headerToken.trim()) {
                return headerToken.trim();
        }

        const authorizationHeader = req?.headers?.authorization;
        if (
                typeof authorizationHeader === "string" &&
                authorizationHeader.toLowerCase().startsWith("bearer ")
        ) {
                const bearerToken = authorizationHeader.slice(7).trim();
                return bearerToken || null;
        }

        return null;
};

export const setAuthCookie = (res, token) => {
        if (!token) return;
        res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());
};

export const clearAuthCookie = (res) => {
        res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieClearOptions());
};