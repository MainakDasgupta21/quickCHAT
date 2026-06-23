import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/db.js";
import Conversation from "../models/Conversation.js";

const run = async () => {
  await connectDB();

  const groupsWithDirectKeyBefore = await Conversation.countDocuments({
    type: "group",
    directKey: { $exists: true },
  });

  const updateResult = await Conversation.updateMany(
    {
      type: "group",
      directKey: { $exists: true },
    },
    {
      $unset: { directKey: "" },
    }
  );

  const groupsWithDirectKeyAfter = await Conversation.countDocuments({
    type: "group",
    directKey: { $exists: true },
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        groupsWithDirectKeyBefore,
        matchedCount: updateResult.matchedCount || 0,
        modifiedCount: updateResult.modifiedCount || 0,
        groupsWithDirectKeyAfter,
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
