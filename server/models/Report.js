import mongoose from "mongoose";

export const REPORT_TARGET_TYPES = ["user", "message"];
export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "violence",
  "impersonation",
  "scam",
  "self_harm",
  "other",
];
export const REPORT_STATUSES = ["open", "reviewing", "resolved", "dismissed"];

const reportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: REPORT_TARGET_TYPES,
      required: true,
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },
    reason: {
      type: String,
      enum: REPORT_REASONS,
      required: true,
    },
    details: {
      type: String,
      default: "",
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: REPORT_STATUSES,
      default: "open",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    resolutionNote: {
      type: String,
      default: "",
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

reportSchema.index(
  { reporterId: 1, targetType: 1, targetUserId: 1, messageId: 1, createdAt: -1 },
  { name: "reporter_target_lookup" }
);
reportSchema.index({ status: 1, createdAt: -1 });

const Report = mongoose.model("Report", reportSchema);

export default Report;
