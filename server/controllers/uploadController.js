import { createCloudinaryUploadSignature } from "../lib/cloudinary.js";

const ALLOWED_UPLOAD_FOLDERS = new Set([
  "quickchat/images",
  "quickchat/files",
  "quickchat/audio",
  "quickchat/avatars",
]);

const ALLOWED_RESOURCE_TYPES = new Set(["image", "video", "raw", "auto"]);

const normalizeFolder = (value) => String(value || "").trim();

const normalizeResourceType = (value) =>
  String(value || "auto").trim().toLowerCase() || "auto";

export const getUploadSignature = async (req, res) => {
  try {
    const folder = normalizeFolder(req.query?.folder);
    const resourceType = normalizeResourceType(req.query?.resourceType);

    if (!folder || !ALLOWED_UPLOAD_FOLDERS.has(folder)) {
      return res.json({ success: false, message: "Invalid upload folder" });
    }

    if (!ALLOWED_RESOURCE_TYPES.has(resourceType)) {
      return res.json({ success: false, message: "Invalid upload resource type" });
    }

    const signaturePayload = createCloudinaryUploadSignature({
      folder,
      resourceType,
    });

    const uploadUrl = `https://api.cloudinary.com/v1_1/${signaturePayload.cloudName}/${signaturePayload.resourceType}/upload`;

    return res.json({
      success: true,
      upload: {
        uploadUrl,
        apiKey: signaturePayload.apiKey,
        timestamp: signaturePayload.timestamp,
        signature: signaturePayload.signature,
        folder: signaturePayload.folder,
        cloudName: signaturePayload.cloudName,
        resourceType: signaturePayload.resourceType,
      },
    });
  } catch (error) {
    console.log(error.message);
    return res.json({ success: false, message: error.message });
  }
};
