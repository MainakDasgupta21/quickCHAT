import webpush from "web-push";
import User from "../models/User.js";

const vapidPublicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const vapidPrivateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const vapidSubject = String(
  process.env.VAPID_SUBJECT || "mailto:quickchat@example.com"
).trim();

let missingConfigLogged = false;
let vapidInitialized = false;

const hasVapidConfig = () =>
  Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject);

const ensureVapidInitialized = () => {
  if (!hasVapidConfig()) {
    if (!missingConfigLogged) {
      missingConfigLogged = true;
      console.log(
        "Web push is disabled: missing VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, or VAPID_SUBJECT."
      );
    }
    return false;
  }

  if (!vapidInitialized) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    vapidInitialized = true;
  }
  return true;
};

const toNormalizedId = (value) => String(value || "").trim();

const toValidSubscription = (subscription) => {
  if (!subscription || typeof subscription !== "object") return null;

  const endpoint = String(subscription.endpoint || "").trim();
  const p256dh = String(subscription.keys?.p256dh || "").trim();
  const auth = String(subscription.keys?.auth || "").trim();
  const expirationTime =
    subscription.expirationTime === null || subscription.expirationTime === undefined
      ? null
      : Number(subscription.expirationTime);

  if (!endpoint || !p256dh || !auth) return null;

  return {
    endpoint,
    keys: { p256dh, auth },
    expirationTime: Number.isFinite(expirationTime) ? expirationTime : null,
  };
};

const isStaleSubscriptionError = (error) => {
  const statusCode = Number(error?.statusCode);
  return statusCode === 404 || statusCode === 410;
};

const toPayloadString = (payload) => {
  if (!payload) return JSON.stringify({});
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload);
};

export const getVapidPublicKey = () => vapidPublicKey;

export const isPushConfigured = () => hasVapidConfig();

export const sendPushToUsers = async (userIds, payload) => {
  if (!ensureVapidInitialized()) {
    return { success: false, sentCount: 0, skipped: "missing_vapid_config" };
  }

  const uniqueUserIds = Array.from(
    new Set((Array.isArray(userIds) ? userIds : []).map((userId) => toNormalizedId(userId)))
  ).filter(Boolean);

  if (!uniqueUserIds.length) {
    return { success: true, sentCount: 0 };
  }

  const users = await User.find({ _id: { $in: uniqueUserIds } })
    .select("+pushSubscriptions")
    .lean();

  if (!users.length) {
    return { success: true, sentCount: 0 };
  }

  const staleEndpointsByUserId = new Map();
  let sentCount = 0;
  const payloadString = toPayloadString(payload);

  for (const user of users) {
    const userId = toNormalizedId(user?._id);
    const subscriptions = Array.isArray(user?.pushSubscriptions)
      ? user.pushSubscriptions
      : [];

    for (const rawSubscription of subscriptions) {
      const subscription = toValidSubscription(rawSubscription);
      if (!subscription) continue;

      try {
        await webpush.sendNotification(subscription, payloadString);
        sentCount += 1;
      } catch (error) {
        if (isStaleSubscriptionError(error)) {
          if (!staleEndpointsByUserId.has(userId)) {
            staleEndpointsByUserId.set(userId, new Set());
          }
          staleEndpointsByUserId.get(userId).add(subscription.endpoint);
        } else {
          console.log(`Push send failed for user ${userId}: ${error.message}`);
        }
      }
    }
  }

  const staleCleanupPromises = Array.from(staleEndpointsByUserId.entries()).map(
    ([userId, endpointSet]) =>
      User.updateOne(
        { _id: userId },
        {
          $pull: {
            pushSubscriptions: {
              endpoint: { $in: Array.from(endpointSet) },
            },
          },
        }
      )
  );

  if (staleCleanupPromises.length > 0) {
    await Promise.all(staleCleanupPromises);
  }

  return { success: true, sentCount };
};

export const sendPushToUser = async (userId, payload) =>
  sendPushToUsers([userId], payload);
