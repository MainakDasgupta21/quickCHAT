import rateLimit from "express-rate-limit";

const createJsonRateLimiter = ({ windowMs, max, message }) =>
        rateLimit({
                windowMs,
                max,
                standardHeaders: true,
                legacyHeaders: false,
                handler: (_req, res) => {
                        res.status(429).json({
                                success: false,
                                message,
                        });
                },
        });

export const authRateLimiter = createJsonRateLimiter({
        windowMs: 15 * 60 * 1000,
        max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
        message: "Too many authentication attempts. Please try again later.",
});

export const messageSendRateLimiter = createJsonRateLimiter({
        windowMs: 60 * 1000,
        max: Number(process.env.MESSAGE_SEND_RATE_LIMIT_MAX || 45),
        message: "Too many messages sent. Please slow down and try again.",
});
