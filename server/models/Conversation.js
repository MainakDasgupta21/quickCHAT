import mongoose from "mongoose";

const participantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["member", "admin"],
      default: "member",
    },
    joinedAt: { type: Date, default: Date.now },
    lastReadAt: { type: Date, default: null },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["direct", "group"],
      required: true,
    },
    participants: {
      type: [participantSchema],
      default: [],
      validate: {
        validator: (participants) => Array.isArray(participants) && participants.length >= 2,
        message: "Conversation must have at least two participants",
      },
    },
    name: { type: String, default: "" },
    avatar: { type: String, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lastMessageAt: { type: Date, default: null },
    directKey: { type: String, default: null },
  },
  { timestamps: true }
);

conversationSchema.index({ "participants.userId": 1, lastMessageAt: -1 });
conversationSchema.index({ type: 1, lastMessageAt: -1 });
conversationSchema.index({ directKey: 1 }, { unique: true, sparse: true });

const Conversation = mongoose.model("Conversation", conversationSchema);

export default Conversation;
