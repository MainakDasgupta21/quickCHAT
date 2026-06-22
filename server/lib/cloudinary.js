import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const normalizeResourceType = (resourceType, fallback = "image") => {
  const normalizedValue = String(resourceType || "").trim().toLowerCase();
  return normalizedValue || fallback;
};

export const isCloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );

export const uploadBase64ToCloudinary = async (
  base64Data,
  { folder = "", resourceType = "image" } = {}
) => {
  if (!base64Data) {
    return { secureUrl: "", publicId: "", resourceType: "" };
  }

  const normalizedResourceType = normalizeResourceType(resourceType, "image");
  const upload = await cloudinary.uploader.upload(base64Data, {
    folder: folder || undefined,
    resource_type: normalizedResourceType,
  });

  return {
    secureUrl: upload.secure_url || "",
    publicId: upload.public_id || "",
    resourceType: upload.resource_type || normalizedResourceType,
  };
};

export const destroyCloudinaryAsset = async ({
  publicId = "",
  resourceType = "image",
} = {}) => {
  const normalizedPublicId = String(publicId || "").trim();
  if (!normalizedPublicId) {
    return { success: true, skipped: true };
  }

  const normalizedResourceType = normalizeResourceType(resourceType, "image");
  const resourceTypesToTry =
    normalizedResourceType === "auto"
      ? ["image", "video", "raw"]
      : [normalizedResourceType];

  let lastError = null;
  for (const typeToTry of resourceTypesToTry) {
    try {
      const result = await cloudinary.uploader.destroy(normalizedPublicId, {
        resource_type: typeToTry,
      });

      if (result?.result === "ok" || result?.result === "not found") {
        return { success: true, result: result?.result || "ok" };
      }
    } catch (error) {
      lastError = error;
    }
  }

  return {
    success: false,
    message: lastError?.message || "Could not delete Cloudinary asset",
  };
};

export const createCloudinaryUploadSignature = ({
  folder = "",
  resourceType = "auto",
} = {}) => {
  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const normalizedFolder = String(folder || "").trim();
  const paramsToSign = { timestamp };
  if (normalizedFolder) {
    paramsToSign.folder = normalizedFolder;
  }

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET
  );

  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    signature,
    folder: normalizedFolder,
    resourceType: normalizeResourceType(resourceType, "auto"),
  };
};

export default cloudinary;