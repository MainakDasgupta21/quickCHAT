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
  },
  { _id: false }
);

const audioSchema = new mongoose.Schema(
  {
    url: { type: String },
    duration: { type: Number, default: 0 },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String, default: "" },
    image: { type: String, default: "" },
    file: { type: fileSchema, default: null },
    audio: { type: audioSchema, default: null },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    reactions: { type: [reactionSchema], default: [] },
    seen: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ text: "text" });


const Message = mongoose.model("Message", messageSchema);

export default Message;