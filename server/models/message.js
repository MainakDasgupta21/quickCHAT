import mongoose from "mongoose";

const reactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    emoji: { type: String, required: true },
  },
  { _id: false }
);

const fileSchema = new mongoose.Schema(
  {
    url: { type: String },
    name: { type: String },
    type: { type: String },
    size: { type: Number },
    publicId: { type: String, default: "" },
    resourceType: { type: String, default: "" },
  },
  { _id: false }
);

const audioSchema = new mongoose.Schema(
  {
    url: { type: String },
    duration: { type: Number, default: 0 },
    publicId: { type: String, default: "" },
    resourceType: { type: String, default: "" },
  },
  { _id: false }
);

const previewSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    siteName: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "ready", "failed"],
      default: "pending",
    },
    fetchedAt: { type: Date, default: null },
    error: { type: String, default: "" },
  },
  { _id: false }
);

const readReceiptSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    readAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const deliveredReceiptSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deliveredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
    },
    text: { type: String, default: "" },
    image: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },
    imageResourceType: { type: String, default: "" },
    file: { type: fileSchema, default: null },
    audio: { type: audioSchema, default: null },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    threadRoot: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    replyCount: { type: Number, default: 0, min: 0 },
    mentions: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      default: [],
    },
    preview: { type: previewSchema, default: null },
    sendAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    disappearAfterMs: { type: Number, default: null, min: 0 },
    scheduledStatus: {
      type: String,
      enum: ["pending", "processing", "released"],
      default: "released",
    },
    starredBy: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      default: [],
    },
    reactions: { type: [reactionSchema], default: [] },
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },
    clientId: { type: String, default: null },
    readBy: { type: [readReceiptSchema], default: [] },
    deliveredTo: { type: [deliveredReceiptSchema], default: [] },
    seen: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ text: "text" });
// Conversation history + last-message lookups in both directions.
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, senderId: 1, createdAt: -1 });
// Unseen-count aggregation for the sidebar.
messageSchema.index({ receiverId: 1, seen: 1 });
// Idempotency key for optimistic send retries from the same sender.
messageSchema.index({ senderId: 1, clientId: 1 }, { sparse: true });
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
messageSchema.index({ conversationId: 1, senderId: 1, clientId: 1 }, { sparse: true });
messageSchema.index({ conversationId: 1, threadRoot: 1, createdAt: 1, _id: 1 });
messageSchema.index({ mentions: 1, createdAt: -1 });
messageSchema.index({ starredBy: 1, createdAt: -1 });
messageSchema.index(
  { scheduledStatus: 1, sendAt: 1, _id: 1 },
  {
    partialFilterExpression: {
      scheduledStatus: "pending",
      sendAt: { $type: "date" },
    },
  }
);
messageSchema.index(
  { isDeleted: 1, expiresAt: 1, _id: 1 },
  {
    partialFilterExpression: {
      isDeleted: false,
      expiresAt: { $type: "date" },
    },
  }
);


const Message = mongoose.model("Message", messageSchema);

export default Message;