import express from "express";
import "dotenv/config";
import cors from "cors";
import http from "http";
import { connectDB } from "./lib/db.js";
import userRouter from "./routes/userRoutes.js";
import messageRouter from "./routes/messageRoutes.js";
import { Server } from "socket.io"




//create express app and http server
const app = express();
const server = http.createServer(app)


//initialize socket.io server
export const io = new Server(server, {
        cors: { origin: "*" }
})



//store online users
export const userSocketMap = {}; //{userId: socketId}




//socket.io connection handler
io.on("connection", (socket) => {
        const userId = socket.handshake.query.userId;
        console.log("User Connected", userId);

        if (userId) userSocketMap[userId] = socket.id;

        //Emit online users to all connected client
        io.emit("getOnlineUsers", Object.keys(userSocketMap))


        socket.on("typing", ({ to }) => {
                if (!userId || !to) return;
                const receiverSocketId = userSocketMap[to];
                if (receiverSocketId) {
                        io.to(receiverSocketId).emit("typing", { from: userId });
                }
        });

        socket.on("stopTyping", ({ to }) => {
                if (!userId || !to) return;
                const receiverSocketId = userSocketMap[to];
                if (receiverSocketId) {
                        io.to(receiverSocketId).emit("stopTyping", { from: userId });
                }
        });

        socket.on("messagesSeen", ({ to, messageIds }) => {
                if (!userId || !to) return;
                const receiverSocketId = userSocketMap[to];
                if (receiverSocketId) {
                        io.to(receiverSocketId).emit("messagesSeen", {
                                from: userId,
                                messageIds: Array.isArray(messageIds) ? messageIds : [],
                        });
                }
        });

        socket.on("messageUpdated", ({ to, message }) => {
                if (!userId || !to || !message) return;
                const receiverSocketId = userSocketMap[to];
                if (receiverSocketId) {
                        io.to(receiverSocketId).emit("messageUpdated", { message });
                }
        });

        socket.on("messageDeleted", ({ to, messageId, message }) => {
                if (!userId || !to || !messageId) return;
                const receiverSocketId = userSocketMap[to];
                if (receiverSocketId) {
                        io.to(receiverSocketId).emit("messageDeleted", {
                                messageId,
                                message,
                        });
                }
        });

        socket.on("messageReaction", ({ to, messageId, reactions }) => {
                if (!userId || !to || !messageId) return;
                const receiverSocketId = userSocketMap[to];
                if (receiverSocketId) {
                        io.to(receiverSocketId).emit("messageReaction", {
                                messageId,
                                reactions: Array.isArray(reactions) ? reactions : [],
                        });
                }
        });

        socket.on("disconnect", () => {
                console.log("User Disconnected", userId);
                delete userSocketMap[userId];
                io.emit("getOnlineUsers", Object.keys(userSocketMap))
        })
})

//middleware setup
// Base64-encoded uploads inflate payloads by ~33%, so a "4mb" cap silently
// rejected ~3MB images. 8mb gives headroom for the 5MB client-side file cap.
app.use(express.json({ limit: "8mb" }))
app.use(cors())

app.use("/api/status", (req, res) => res.send("Server is live"));
app.use("/api/auth", userRouter);
app.use("/api/messages", messageRouter);

//connect to MongoDB
await connectDB();


if (process.env.NODE_ENV !== 'production') {
        const PORT = process.env.PORT || 5000;
        server.listen(PORT, () => console.log("server is running on PORT ", PORT));
}


export default server;