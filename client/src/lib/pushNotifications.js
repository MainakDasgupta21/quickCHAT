const SERVICE_WORKER_PATH = "/sw.js";
const PUSH_PUBLIC_KEY_ENDPOINT = "/api/push/vapid-public-key";
const PUSH_SUBSCRIBE_ENDPOINT = "/api/push/subscribe";
const PUSH_UNSUBSCRIBE_ENDPOINT = "/api/push/subscribe";

const isWindowAvailable = () => typeof window !== "undefined";

export const isServiceWorkerSupported = () =>
  isWindowAvailable() && "serviceWorker" in navigator;

export const isPushSupported = () =>
  isServiceWorkerSupported() && "PushManager" in window;

export const registerServiceWorker = async () => {
  if (!isServiceWorkerSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
    return registration;
  } catch (error) {
    console.log(`Service worker registration failed: ${error.message}`);
    return null;
  }
};

const urlBase64ToUint8Array = (base64String) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputArray;
};

const getSubscriptionPayload = (subscription) => {
  if (!subscription) return null;
  if (typeof subscription.toJSON === "function") {
    return subscription.toJSON();
  }
  return subscription;
};

const getReadyRegistration = async () => {
  if (!isServiceWorkerSupported()) return null;

  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;

  const registered = await registerServiceWorker();
  if (registered) return registered;

  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
};

const getPublicVapidKey = async (axiosInstance) => {
  const { data } = await axiosInstance.get(PUSH_PUBLIC_KEY_ENDPOINT);
  if (!data?.success || !data.publicKey) {
    throw new Error(data?.message || "Push notifications are not configured.");
  }
  return String(data.publicKey).trim();
};

export const subscribeCurrentDeviceForPush = async (axiosInstance) => {
  if (!isPushSupported()) {
    return { success: false, reason: "unsupported" };
  }

  const registration = await getReadyRegistration();
  if (!registration) {
    throw new Error("Could not initialize service worker.");
  }

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const publicKey = await getPublicVapidKey(axiosInstance);
    const applicationServerKey = urlBase64ToUint8Array(publicKey);
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  const payload = getSubscriptionPayload(subscription);
  if (!payload?.endpoint) {
    throw new Error("Could not create push subscription.");
  }

  const { data } = await axiosInstance.post(PUSH_SUBSCRIBE_ENDPOINT, {
    subscription: payload,
  });

  if (!data?.success) {
    throw new Error(data?.message || "Could not save push subscription.");
  }

  return { success: true, subscription: payload };
};

export const unsubscribeCurrentDeviceFromPush = async (axiosInstance) => {
  if (!isPushSupported()) {
    return { success: false, reason: "unsupported" };
  }

  const registration = await getReadyRegistration();
  if (!registration) {
    return { success: true, unsubscribed: false };
  }

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return { success: true, unsubscribed: false };
  }

  const payload = getSubscriptionPayload(subscription);
  if (payload?.endpoint) {
    try {
      await axiosInstance.delete(PUSH_UNSUBSCRIBE_ENDPOINT, {
        data: { endpoint: payload.endpoint },
      });
    } catch {
      // Best effort: still attempt local unsubscribe.
    }
  }

  try {
    await subscription.unsubscribe();
  } catch {
    // Best effort cleanup for stale browser subscriptions.
  }

  return { success: true, unsubscribed: true };
};
