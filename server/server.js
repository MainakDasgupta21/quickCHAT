import express from "express";
import "dotenv/config";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { connectDB } from "./lib/db.js";
import userRouter from "./routes/userRoutes.js";
import messageRouter from "./routes/messageRoutes.js";
import conversationRouter from "./routes/conversationRoutes.js";
import Message from "./models/message.js";
import Conversation from "./models/Conversation.js";
import User from "./models/User.js";
import { getConversationRoomName } from "./lib/conversationHelpers.js";
import { Server } from "socket.io"




//create express app and http server
const app = express();
const server = http.createServer(app)

const DEFAULT_CLIENT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const configuredClientOrigins = String(process.env.CLIENT_ORIGINS || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
const ALLOWED_CLIENT_ORIGINS = [
        ...new Set([...DEFAULT_CLIENT_ORIGINS, ...configuredClientOrigins]),
];

const corsOriginHandler = (origin, callback) => {
        if (!origin || ALLOWED_CLIENT_ORIGINS.includes(origin)) {
                callback(null, true);
                return;
        }
        callback(new Error("Not allowed by CORS"));
};


//initialize socket.io server
export const io = new Server(server, {
        cors: {
                origin: corsOriginHandler,
                credentials: true,
        }
})

io.use((socket, next) => {
        try {
                const token = socket.handshake?.auth?.token;
                if (typeof token !== "string" || !token.trim()) {
                        return next(new Error("Not authorized"));
                }

                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const userId = decoded?.userId;
                if (!userId) {
                        return next(new Error("Not authorized"));
                }

                socket.userId = userId.toString();
                next();
        } catch (error) {
                next(new Error("Not authorized"));
        }
});



// store online users
export const userSocketMap = new Map(); // Map<userId, Set<socketId>>

const toNormalizedUserId = (userId) => String(userId || "").trim();

const getOnlineUserIds = () =>
        Array.from(userSocketMap.keys()).filter(Boolean);

const addUserSocket = (userId, socketId) => {
        const normalizedUserId = toNormalizedUserId(userId);
        if (!normalizedUserId || !socketId) return false;

        let socketIds = userSocketMap.get(normalizedUserId);
        const wasOffline = !socketIds || socketIds.size === 0;
        if (!socketIds) {
                socketIds = new Set();
                userSocketMap.set(normalizedUserId, socketIds);
        }

        socketIds.add(socketId);
        return wasOffline;
};

const removeUserSocket = (userId, socketId) => {
        const normalizedUserId = toNormalizedUserId(userId);
        if (!normalizedUserId || !socketId) return false;

        const socketIds = userSocketMap.get(normalizedUserId);
        if (!socketIds) return false;

        socketIds.delete(socketId);
        if (socketIds.size > 0) return false;

        userSocketMap.delete(normalizedUserId);
        return true;
};

export const getUserSocketIds = (userId) => {
        const normalizedUserId = toNormalizedUserId(userId);
        if (!normalizedUserId) return [];
        const socketIds = userSocketMap.get(normalizedUserId);
        return socketIds ? Array.from(socketIds) : [];
};

export const isUserOnline = (userId) => getUserSocketIds(userId).length > 0;

const emitToUserSockets = (userId, eventName, payload) => {
        getUserSocketIds(userId).forEach((socketId) => {
                io.to(socketId).emit(eventName, payload);
        });
};

const joinSocketToUserConversationRooms = async (socket, userId) => {
        if (!socket || !userId) return;

        try {
                const userConversations = await Conversation.find({
                        "participants.userId": userId,
                })
                        .select("_id")
                        .lean();

                userConversations.forEach((conversation) => {
                        socket.join(getConversationRoomName(conversation._id));
                });
        } catch (error) {
                console.log(error.message);
        }
};

const markPendingDelivered = async (receiverId) => {
        if (!receiverId) return;

        try {
                const pendingMessages = await Message.find({
                        receiverId,
                        seen: false,
                        status: "sent",
                })
                        .select("_id senderId")
                        .lean();

                if (!pendingMessages.length) return;

                const pendingMessageIds = pendingMessages.map((message) => message._id);
                await Message.updateMany(
                        { _id: { $in: pendingMessageIds } },
                        { status: "delivered" }
                );

                const senderToMessageIds = new Map();
                pendingMessages.forEach((message) => {
                        const senderId = message.senderId?.toString();
                        if (!senderId) return;
                        if (!senderToMessageIds.has(senderId)) {
                                senderToMessageIds.set(senderId, []);
                        }
                        senderToMessageIds.get(senderId).push(message._id.toString());
                });

                senderToMessageIds.forEach((messageIds, senderId) => {
                        emitToUserSockets(senderId, "messageDelivered", {
                                messageIds,
                                status: "delivered",
                        });
                });
        } catch (error) {
                console.log(error.message);
        }
};




//socket.io connection handler
io.on("connection", (socket) => {
        const userId = socket.userId;
        console.log("User Connected", userId);

        if (userId) {
                const didBecomeOnline = addUserSocket(userId, socket.id);
                if (didBecomeOnline) {
                        io.emit("userPresenceUpdated", {
                                userId,
                                online: true,
                                lastSeen: null,
                        });
                }
        }
        void markPendingDelivered(userId);
        void joinSocketToUserConversationRooms(socket, userId);

        //Emit online users to all connected client
        io.emit("getOnlineUsers", getOnlineUserIds())


        socket.on("typing", ({ to, conversationId }) => {
                if (!userId) return;

                if (conversationId) {
                        const roomName = getConversationRoomName(conversationId);
                        if (!socket.rooms.has(roomName)) return;
                        socket.to(roomName).emit("typing", {
                                from: userId,
                                conversationId: String(conversationId),
                        });
                        return;
                }

                if (!to) return;
                emitToUserSockets(to, "typing", { from: userId });
        });

        socket.on("stopTyping", ({ to, conversationId }) => {
                if (!userId) return;

                if (conversationId) {
                        const roomName = getConversationRoomName(conversationId);
                        if (!socket.rooms.has(roomName)) return;
                        socket.to(roomName).emit("stopTyping", {
                                from: userId,
                                conversationId: String(conversationId),
                        });
                        return;
                }

                if (!to) return;
                emitToUserSockets(to, "stopTyping", { from: userId });
        });

        socket.on("messagesSeen", ({ to, messageIds, conversationId }) => {
                if (!userId) return;

                if (conversationId) {
                        const roomName = getConversationRoomName(conversationId);
                        if (!socket.rooms.has(roomName)) return;
                        socket.to(roomName).emit("messagesSeen", {
                                from: userId,
                                conversationId: String(conversationId),
                                messageIds: Array.isArray(messageIds) ? messageIds : [],
                        });
                        return;
                }

                if (!to) return;
                emitToUserSockets(to, "messagesSeen", {
                        from: userId,
                        messageIds: Array.isArray(messageIds) ? messageIds : [],
                });
        });

        socket.on("messageUpdated", ({ to, message, conversationId }) => {
                if (!userId || !message) return;

                if (conversationId) {
                        const roomName = getConversationRoomName(conversationId);
                        if (!socket.rooms.has(roomName)) return;
                        socket.to(roomName).emit("messageUpdated", {
                                conversationId: String(conversationId),
                                message,
                        });
                        return;
                }

                if (!to) return;
                emitToUserSockets(to, "messageUpdated", { message });
        });

        socket.on("messageDeleted", ({ to, messageId, message, conversationId }) => {
                if (!userId || !messageId) return;

                if (conversationId) {
                        const roomName = getConversationRoomName(conversationId);
                        if (!socket.rooms.has(roomName)) return;
                        socket.to(roomName).emit("messageDeleted", {
                                conversationId: String(conversationId),
                                messageId,
                                message,
                        });
                        return;
                }

                if (!to) return;
                emitToUserSockets(to, "messageDeleted", {
                        messageId,
                        message,
                });
        });

        socket.on("messageReaction", ({ to, messageId, reactions, conversationId }) => {
                if (!userId || !messageId) return;

                if (conversationId) {
                        const roomName = getConversationRoomName(conversationId);
                        if (!socket.rooms.has(roomName)) return;
                        socket.to(roomName).emit("messageReaction", {
                                conversationId: String(conversationId),
                                messageId,
                                reactions: Array.isArray(reactions) ? reactions : [],
                        });
                        return;
                }

                if (!to) return;
                emitToUserSockets(to, "messageReaction", {
                        messageId,
                        reactions: Array.isArray(reactions) ? reactions : [],
                });
        });

        socket.on("disconnect", async () => {
                console.log("User Disconnected", userId);
                const didBecomeOffline = removeUserSocket(userId, socket.id);
                if (didBecomeOffline) {
                        const lastSeen = new Date();
                        try {
                                await User.findByIdAndUpdate(userId, { lastSeen });
                        } catch (error) {
                                console.log(error.message);
                        }

                        io.emit("userPresenceUpdated", {
                                userId: String(userId),
                                online: false,
                                lastSeen: lastSeen.toISOString(),
                        });
                }
                io.emit("getOnlineUsers", getOnlineUserIds())
        })
})

//middleware setup
// Base64-encoded uploads inflate payloads by ~33%, so a "4mb" cap silently
// rejected ~3MB images. 8mb gives headroom for the 5MB client-side file cap.
app.use(helmet())
app.use(cookieParser())
app.use(express.json({ limit: "8mb" }))
app.use(cors({ origin: corsOriginHandler, credentials: true }))

app.use("/api/status", (req, res) => res.send("Server is live"));
app.use("/api/auth", userRouter);
app.use("/api/messages", messageRouter);
app.use("/api/conversations", conversationRouter);

//connect to MongoDB
await connectDB();


if (process.env.NODE_ENV !== 'production') {
        const PORT = process.env.PORT || 5000;
        server.listen(PORT, () => console.log("server is running on PORT ", PORT));
}


export default server;