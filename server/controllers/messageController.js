import mongoose from "mongoose";
import Message from "../models/message.js";
import User from "../models/User.js";
import cloudinary from "../lib/cloudinary.js";
import { io } from "../server.js";
import { userSocketMap } from "../server.js";

const getConversationFilter = (userA, userB) => ({
  $or: [
    { senderId: userA, receiverId: userB },
    { senderId: userB, receiverId: userA },
  ],
});

const emitToUser = (userId, eventName, payload) => {
  const socketId = userSocketMap[userId?.toString()];
  if (socketId) {
    io.to(socketId).emit(eventName, payload);
  }
};

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getMessagePreview = (message) => {
  if (!message) return "";
  if (message.isDeleted) return "Message deleted";
  if (message.text?.trim()) return message.text.trim();
  if (message.image) return "Photo";
  if (message.audio?.url) return "Voice note";
  if (message.file?.name) return `File: ${message.file.name}`;
  return "Attachment";
};

const uploadBase64 = async (base64Data, folder, resourceType = "image") => {
  if (!base64Data) return "";
  const upload = await cloudinary.uploader.upload(base64Data, {
    folder,
    resource_type: resourceType,
  });
  return upload.secure_url;
};

//get all users except the logged in user
export const getUserForSidebar = async (req, res) => {
  try {
    const userId = req.user._id;
    const filteredUsers = await User.find({ _id: { $ne: userId } }).select(
      "-password"
    );

    const unseenMessages = {};
    const usersWithMeta = await Promise.all(
      filteredUsers.map(async (user) => {
        const unseenCount = await Message.countDocuments({
          senderId: user._id,
          receiverId: userId,
          seen: false,
        });

        if (unseenCount > 0) {
          unseenMessages[user._id] = unseenCount;
        }

        const latestMessage = await Message.findOne(
          getConversationFilter(userId, user._id)
        )
          .sort({ createdAt: -1 })
          .select("text image file audio isDeleted createdAt");

        return {
          ...user.toObject(),
          lastMessagePreview: getMessagePreview(latestMessage),
          lastMessageAt: latestMessage?.createdAt || null,
        };
      })
    );

    res.json({ success: true, users: usersWithMeta, unseenMessages });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

//get all messages for selected user
export const getMessages = async (req, res) => {
  try {
    const { id: selectedUserId } = req.params;
    const myId = req.user._id;

    const messages = await Message.find(
      getConversationFilter(myId, selectedUserId)
    )
      .sort({ createdAt: 1 })
      .populate("replyTo", "text image file audio senderId isDeleted");

    await Message.updateMany(
      { senderId: selectedUserId, receiverId: myId, seen: false },
      { seen: true }
    );

    res.json({ success: true, messages });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};


//api to mark message as seen using message id
export const markMessageAsSeen = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await Message.findById(id);

    if (!message) {
      return res.json({ success: false, message: "Message not found" });
    }

    if (!message.seen) {
      message.seen = true;
      await message.save();
    }

    if (message.senderId.toString() !== req.user._id.toString()) {
      emitToUser(message.senderId, "messagesSeen", {
        from: req.user._id.toString(),
        messageIds: [message._id.toString()],
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

//send message to selected user
export const sendMessage = async (req, res) => {
  try {
    const { text = "", image, file, audio, replyTo } = req.body;
    const receiverId = req.params.id;
    const senderId = req.user._id;

    let imageUrl = "";
    let filePayload = null;
    let audioPayload = null;

    if (image) {
      imageUrl = await uploadBase64(image, "quickchat/images", "image");
    }

    if (file?.data) {
      const fileUrl = await uploadBase64(file.data, "quickchat/files", "auto");
      filePayload = {
        url: fileUrl,
        name: file.name || "Attachment",
        type: file.type || "application/octet-stream",
        size: Number(file.size || 0),
      };
    }

    if (audio?.data) {
      const audioUrl = await uploadBase64(audio.data, "quickchat/audio", "auto");
      audioPayload = {
        url: audioUrl,
        duration: Number(audio.duration || 0),
      };
    }

    const cleanedText = String(text || "").trim();
    if (!cleanedText && !imageUrl && !filePayload && !audioPayload) {
      return res.json({ success: false, message: "Message content is empty" });
    }

    const newMessage = await Message.create({
      senderId,
      receiverId,
      text: cleanedText,
      image: imageUrl,
      file: filePayload,
      audio: audioPayload,
      replyTo:
        replyTo && mongoose.Types.ObjectId.isValid(replyTo)
          ? replyTo
          : null,
    });

    const populatedMessage = await Message.findById(newMessage._id).populate(
      "replyTo",
      "text image file audio senderId isDeleted"
    );

    emitToUser(receiverId, "newMessage", populatedMessage);
    res.json({ success: true, newMessage: populatedMessage });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text = "" } = req.body;
    const cleanedText = String(text).trim();

    if (!cleanedText) {
      return res.json({ success: false, message: "Edited text is required" });
    }

    const message = await Message.findById(id);
    if (!message) {
      return res.json({ success: false, message: "Message not found" });
    }

    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.json({ success: false, message: "Not authorized" });
    }

    if (message.isDeleted) {
      return res.json({ success: false, message: "Message is deleted" });
    }

    message.text = cleanedText;
    message.editedAt = new Date();
    await message.save();

    const populatedMessage = await Message.findById(message._id).populate(
      "replyTo",
      "text image file audio senderId isDeleted"
    );

    const peerId =
      message.senderId.toString() === req.user._id.toString()
        ? message.receiverId
        : message.senderId;
    emitToUser(peerId, "messageUpdated", { message: populatedMessage });

    res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await Message.findById(id);

    if (!message) {
      return res.json({ success: false, message: "Message not found" });
    }

    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.json({ success: false, message: "Not authorized" });
    }

    message.text = "";
    message.image = "";
    message.file = null;
    message.audio = null;
    message.reactions = [];
    message.isDeleted = true;
    message.editedAt = new Date();
    await message.save();

    const peerId =
      message.senderId.toString() === req.user._id.toString()
        ? message.receiverId
        : message.senderId;
    emitToUser(peerId, "messageDeleted", {
      messageId: message._id.toString(),
      message,
    });

    res.json({ success: true, messageId: message._id.toString(), message });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const reactToMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;

    if (!emoji) {
      return res.json({ success: false, message: "Emoji is required" });
    }

    const message = await Message.findById(id);
    if (!message) {
      return res.json({ success: false, message: "Message not found" });
    }

    if (message.isDeleted) {
      return res.json({ success: false, message: "Cannot react to deleted message" });
    }

    const userId = req.user._id.toString();
    const currentReactionIndex = message.reactions.findIndex(
      (reaction) => reaction.userId.toString() === userId
    );

    if (currentReactionIndex >= 0) {
      const current = message.reactions[currentReactionIndex];
      if (current.emoji === emoji) {
        message.reactions.splice(currentReactionIndex, 1);
      } else {
        message.reactions[currentReactionIndex].emoji = emoji;
      }
    } else {
      message.reactions.push({ userId: req.user._id, emoji });
    }

    await message.save();

    const peerId =
      message.senderId.toString() === userId ? message.receiverId : message.senderId;
    emitToUser(peerId, "messageReaction", {
      messageId: message._id.toString(),
      reactions: message.reactions,
    });

    res.json({
      success: true,
      messageId: message._id.toString(),
      reactions: message.reactions,
    });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const searchMessages = async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const { id: selectedUserId } = req.params;
    const myId = req.user._id;

    if (!query) {
      return res.json({ success: true, messages: [] });
    }

    const messages = await Message.find({
      ...getConversationFilter(myId, selectedUserId),
      isDeleted: false,
      text: { $regex: escapeRegex(query), $options: "i" },
    })
      .sort({ createdAt: 1 })
      .select("_id text senderId createdAt");

    res.json({ success: true, messages });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};
