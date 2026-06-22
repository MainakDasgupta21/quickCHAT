import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/db.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/message.js";
import { buildDirectKey } from "../lib/conversationHelpers.js";

const BATCH_SIZE = 200;

const ensureDirectConversation = async ({ userA, userB, lastMessageAt }) => {
  const userAId = String(userA);
  const userBId = String(userB);
  const directKey = buildDirectKey(userAId, userBId);

  return Conversation.findOneAndUpdate(
    { directKey },
    {
      $setOnInsert: {
        type: "direct",
        directKey,
        participants: [
          { userId: userAId, role: "member" },
          { userId: userBId, role: "member" },
        ],
        createdBy: userAId,
      },
      $max: { lastMessageAt: lastMessageAt || null },
    },
    { upsert: true, new: true }
  );
};

const backfillReadReceipts = async () => {
  const seenMessagesWithoutReadBy = await Message.find({
    seen: true,
    receiverId: { $ne: null },
    $or: [{ readBy: { $exists: false } }, { readBy: { $size: 0 } }],
  })
    .select("_id receiverId updatedAt")
    .lean();

  if (!seenMessagesWithoutReadBy.length) {
    return 0;
  }

  const operations = seenMessagesWithoutReadBy.map((message) => ({
    updateOne: {
      filter: { _id: message._id },
      update: {
        $set: {
          readBy: [
            {
              userId: message.receiverId,
              readAt: message.updatedAt || new Date(),
            },
          ],
        },
      },
    },
  }));

  if (!operations.length) return 0;
  const result = await Message.bulkWrite(operations, { ordered: false });
  return result.modifiedCount || 0;
};

const run = async () => {
  await connectDB();

  const dmPairs = await Message.aggregate([
    {
      $match: {
        senderId: { $ne: null },
        receiverId: { $ne: null },
      },
    },
    {
      $project: {
        senderId: 1,
        receiverId: 1,
        createdAt: 1,
        senderIdString: { $toString: "$senderId" },
        receiverIdString: { $toString: "$receiverId" },
      },
    },
    {
      $project: {
        userA: {
          $cond: [
            { $lt: ["$senderIdString", "$receiverIdString"] },
            "$senderId",
            "$receiverId",
          ],
        },
        userB: {
          $cond: [
            { $lt: ["$senderIdString", "$receiverIdString"] },
            "$receiverId",
            "$senderId",
          ],
        },
        createdAt: 1,
      },
    },
    {
      $group: {
        _id: { userA: "$userA", userB: "$userB" },
        lastMessageAt: { $max: "$createdAt" },
      },
    },
  ]);

  let processedPairs = 0;
  let updatedMessagesCount = 0;

  for (let index = 0; index < dmPairs.length; index += BATCH_SIZE) {
    const batch = dmPairs.slice(index, index + BATCH_SIZE);

    for (const pair of batch) {
      const userA = pair?._id?.userA;
      const userB = pair?._id?.userB;
      if (!userA || !userB) continue;

      const conversation = await ensureDirectConversation({
        userA,
        userB,
        lastMessageAt: pair.lastMessageAt,
      });

      const updateResult = await Message.updateMany(
        {
          $or: [
            { senderId: userA, receiverId: userB },
            { senderId: userB, receiverId: userA },
          ],
        },
        {
          $set: {
            conversationId: conversation._id,
          },
        }
      );

      processedPairs += 1;
      updatedMessagesCount += updateResult.modifiedCount || 0;
    }
  }

  const updatedReadReceipts = await backfillReadReceipts();

  console.log(
    JSON.stringify(
      {
        success: true,
        processedPairs,
        updatedMessagesCount,
        updatedReadReceipts,
      },
      null,
      2
    )
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // noop
    }
  });
