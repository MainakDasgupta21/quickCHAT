import {
  expireDueMessages,
  releaseDueScheduledMessages,
  resetStaleScheduledMessages,
} from "../controllers/messageController.js";

const toPositiveInteger = (value, fallbackValue) => {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) return fallbackValue;
  return parsedValue;
};

const isSchedulerEnabled = () =>
  String(process.env.MESSAGE_SCHEDULER_ENABLED || "true").trim().toLowerCase() !==
  "false";

const POLL_MS = toPositiveInteger(process.env.MESSAGE_SCHEDULER_POLL_MS, 5000);
const RELEASE_BATCH_SIZE = toPositiveInteger(
  process.env.MESSAGE_SCHEDULER_RELEASE_BATCH,
  25
);
const EXPIRE_BATCH_SIZE = toPositiveInteger(
  process.env.MESSAGE_SCHEDULER_EXPIRE_BATCH,
  50
);
const STALE_CLAIM_MS = toPositiveInteger(
  process.env.MESSAGE_SCHEDULER_STALE_CLAIM_MS,
  2 * 60 * 1000
);

let schedulerTimer = null;
let tickInFlight = false;

const runSchedulerTick = async () => {
  if (tickInFlight) return;
  tickInFlight = true;

  try {
    const resetCount = await resetStaleScheduledMessages({
      staleAfterMs: STALE_CLAIM_MS,
    });
    const releasedCount = await releaseDueScheduledMessages({
      limit: RELEASE_BATCH_SIZE,
    });
    const expiredCount = await expireDueMessages({
      limit: EXPIRE_BATCH_SIZE,
    });

    if (resetCount || releasedCount || expiredCount) {
      console.log(
        `[message-scheduler] reset=${resetCount} released=${releasedCount} expired=${expiredCount}`
      );
    }
  } catch (error) {
    console.log(`[message-scheduler] ${error.message}`);
  } finally {
    tickInFlight = false;
  }
};

export const startMessageScheduler = () => {
  if (!isSchedulerEnabled()) {
    console.log("[message-scheduler] disabled");
    return;
  }
  if (schedulerTimer) return;

  schedulerTimer = setInterval(() => {
    void runSchedulerTick();
  }, POLL_MS);
  void runSchedulerTick();
  console.log(
    `[message-scheduler] started poll=${POLL_MS}ms releaseBatch=${RELEASE_BATCH_SIZE} expireBatch=${EXPIRE_BATCH_SIZE}`
  );
};

export const stopMessageScheduler = () => {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
  tickInFlight = false;
  console.log("[message-scheduler] stopped");
};
