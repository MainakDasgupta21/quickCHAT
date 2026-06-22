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

export const twoFactorActionRateLimiter = createJsonRateLimiter({
        windowMs: 15 * 60 * 1000,
        max: Number(process.env.TWO_FACTOR_RATE_LIMIT_MAX || 30),
        message: "Too many two-factor requests. Please try again later.",
});

export const messageSendRateLimiter = createJsonRateLimiter({
        windowMs: 60 * 1000,
        max: Number(process.env.MESSAGE_SEND_RATE_LIMIT_MAX || 45),
        message: "Too many messages sent. Please slow down and try again.",
});

export const unfurlRateLimiter = createJsonRateLimiter({
        windowMs: 60 * 1000,
        max: Number(process.env.UNFURL_RATE_LIMIT_MAX || 25),
        message: "Too many link preview requests. Please try again shortly.",
});

export const blockActionRateLimiter = createJsonRateLimiter({
        windowMs: 60 * 60 * 1000,
        max: Number(process.env.BLOCK_ACTION_RATE_LIMIT_MAX || 80),
        message: "Too many block actions. Please try again later.",
});

export const reportActionRateLimiter = createJsonRateLimiter({
        windowMs: 60 * 60 * 1000,
        max: Number(process.env.REPORT_ACTION_RATE_LIMIT_MAX || 40),
        message: "Too many reports submitted. Please try again later.",
});
