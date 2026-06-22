import User from "../models/User.js";
import { getVapidPublicKey, isPushConfigured } from "../lib/pushService.js";

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

export const getPublicVapidKey = (req, res) => {
  if (!isPushConfigured()) {
    return res.json({
      success: false,
      message: "Push notifications are not configured on the server",
    });
  }

  const publicKey = getVapidPublicKey();
  return res.json({ success: true, publicKey });
};

export const subscribeToPush = async (req, res) => {
  try {
    const subscription = toValidSubscription(req.body?.subscription || req.body);
    if (!subscription) {
      return res.json({
        success: false,
        message: "Invalid push subscription payload",
      });
    }

    const userId = req.user?._id;
    await User.updateOne(
      { _id: userId },
      {
        $pull: {
          pushSubscriptions: { endpoint: subscription.endpoint },
        },
      }
    );
    await User.updateOne(
      { _id: userId },
      {
        $addToSet: {
          pushSubscriptions: subscription,
        },
      }
    );

    return res.json({ success: true });
  } catch (error) {
    console.log(error.message);
    return res.json({ success: false, message: error.message });
  }
};

export const unsubscribeFromPush = async (req, res) => {
  try {
    const endpoint = String(
      req.body?.endpoint || req.body?.subscription?.endpoint || ""
    ).trim();
    if (!endpoint) {
      return res.json({ success: false, message: "Push endpoint is required" });
    }

    await User.updateOne(
      { _id: req.user?._id },
      { $pull: { pushSubscriptions: { endpoint } } }
    );

    return res.json({ success: true });
  } catch (error) {
    console.log(error.message);
    return res.json({ success: false, message: error.message });
  }
};
