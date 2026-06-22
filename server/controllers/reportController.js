import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/message.js";
import Report, { REPORT_REASONS, REPORT_TARGET_TYPES } from "../models/Report.js";
import User from "../models/User.js";
import { getConversationParticipantIds, toNormalizedId } from "../lib/conversationHelpers.js";

const MAX_REPORT_DETAILS_LENGTH = 2000;
const ALLOWED_REPORT_TARGET_TYPES = new Set(REPORT_TARGET_TYPES);
const ALLOWED_REPORT_REASONS = new Set(REPORT_REASONS);

const toReportPayload = (report) => ({
  _id: toNormalizedId(report?._id),
  targetType: String(report?.targetType || ""),
  reason: String(report?.reason || ""),
  details: String(report?.details || ""),
  status: String(report?.status || ""),
  reporterId: toNormalizedId(report?.reporterId),
  targetUserId: toNormalizedId(report?.targetUserId),
  messageId: toNormalizedId(report?.messageId),
  conversationId: toNormalizedId(report?.conversationId),
  createdAt: report?.createdAt || null,
  updatedAt: report?.updatedAt || null,
});

const toSanitizedDetails = (detailsValue) =>
  String(detailsValue || "").trim().slice(0, MAX_REPORT_DETAILS_LENGTH);

export const createReport = async (req, res) => {
  try {
    const reporterId = toNormalizedId(req.user?._id);
    const targetType = String(req.body?.targetType || "").trim().toLowerCase();
    const reason = String(req.body?.reason || "").trim().toLowerCase();
    const details = toSanitizedDetails(req.body?.details);

    if (!ALLOWED_REPORT_TARGET_TYPES.has(targetType)) {
      return res.json({ success: false, message: "Invalid report target type" });
    }
    if (!ALLOWED_REPORT_REASONS.has(reason)) {
      return res.json({ success: false, message: "Invalid report reason" });
    }

    let targetUserId = "";
    let messageId = "";
    let conversationId = "";

    if (targetType === "user") {
      targetUserId = toNormalizedId(req.body?.targetUserId);
      if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res.json({ success: false, message: "Invalid target user id" });
      }
      if (targetUserId === reporterId) {
        return res.json({ success: false, message: "You cannot report yourself" });
      }

      const targetExists = await User.exists({ _id: targetUserId });
      if (!targetExists) {
        return res.json({ success: false, message: "Target user not found" });
      }
    } else {
      messageId = toNormalizedId(req.body?.messageId);
      if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
        return res.json({ success: false, message: "Invalid message id" });
      }

      const message = await Message.findById(messageId)
        .select("_id senderId receiverId conversationId")
        .lean();
      if (!message) {
        return res.json({ success: false, message: "Message not found" });
      }

      targetUserId = toNormalizedId(message.senderId);
      conversationId = toNormalizedId(message.conversationId);

      if (targetUserId === reporterId) {
        return res.json({ success: false, message: "You cannot report your own message" });
      }

      let canReport = false;
      if (conversationId) {
        const conversation = await Conversation.findById(conversationId)
          .select("participants")
          .lean();
        if (conversation) {
          const participantIds = getConversationParticipantIds(conversation);
          canReport = participantIds.includes(reporterId);
        }
      }

      if (!canReport) {
        const senderId = toNormalizedId(message.senderId);
        const receiverId = toNormalizedId(message.receiverId);
        canReport = senderId === reporterId || receiverId === reporterId;
      }

      if (!canReport) {
        return res.json({ success: false, message: "Not authorized to report this message" });
      }
    }

    const report = await Report.create({
      reporterId,
      targetType,
      targetUserId: targetUserId || null,
      messageId: messageId || null,
      conversationId: conversationId || null,
      reason,
      details,
      status: "open",
    });

    return res.json({
      success: true,
      message: "Report submitted",
      report: toReportPayload(report),
    });
  } catch (error) {
    console.log(error.message);
    return res.json({ success: false, message: error.message });
  }
};
