import { getErrorMessage } from "./utils";

const UPLOAD_SIGNATURE_ENDPOINT = "/api/upload/signature";

const normalizeProgress = (loaded, total) => {
  const safeTotal = Number(total) > 0 ? Number(total) : 0;
  const safeLoaded = Math.max(0, Number(loaded) || 0);
  if (!safeTotal) return 0;
  return Math.min(100, Math.max(0, Math.round((safeLoaded / safeTotal) * 100)));
};

const requestUploadSignature = async (
  axiosInstance,
  { folder, resourceType = "auto" } = {}
) => {
  const { data } = await axiosInstance.get(UPLOAD_SIGNATURE_ENDPOINT, {
    params: {
      folder,
      resourceType,
    },
  });

  if (!data?.success || !data.upload) {
    throw new Error(data?.message || "Could not get upload signature.");
  }

  return data.upload;
};

const uploadWithXhr = ({
  file,
  fileName,
  uploadSignature,
  onProgress = () => {},
}) =>
  new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file, fileName);
    formData.append("api_key", String(uploadSignature.apiKey || ""));
    formData.append("timestamp", String(uploadSignature.timestamp || ""));
    formData.append("signature", String(uploadSignature.signature || ""));
    if (uploadSignature.folder) {
      formData.append("folder", String(uploadSignature.folder));
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", String(uploadSignature.uploadUrl || ""));

    xhr.upload.onprogress = (event) => {
      const percent = normalizeProgress(event.loaded, event.total);
      onProgress({
        loaded: Number(event.loaded || 0),
        total: Number(event.total || 0),
        percent,
      });
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed with status ${xhr.status}`));
        return;
      }

      try {
        const response = JSON.parse(xhr.responseText || "{}");
        if (!response.secure_url || !response.public_id) {
          reject(new Error("Cloudinary upload response is missing required fields."));
          return;
        }
        resolve(response);
      } catch (error) {
        reject(new Error(getErrorMessage(error, "Upload response parsing failed.")));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Upload request failed."));
    };

    xhr.send(formData);
  });

export const uploadFileToCloudinary = async ({
  axiosInstance,
  file,
  fileName = "",
  folder,
  resourceType = "auto",
  onProgress = () => {},
} = {}) => {
  if (!axiosInstance) {
    throw new Error("Upload client is not configured.");
  }
  if (!file) {
    throw new Error("No file selected for upload.");
  }

  const normalizedFileName =
    String(fileName || file.name || "").trim() || "attachment";
  const uploadSignature = await requestUploadSignature(axiosInstance, {
    folder,
    resourceType,
  });
  const uploadedAsset = await uploadWithXhr({
    file,
    fileName: normalizedFileName,
    uploadSignature,
    onProgress,
  });

  return {
    url: uploadedAsset.secure_url,
    publicId: uploadedAsset.public_id,
    resourceType:
      uploadedAsset.resource_type ||
      String(uploadSignature.resourceType || resourceType || "auto"),
    name: normalizedFileName,
    type: String(file.type || uploadedAsset.format || "application/octet-stream"),
    size: Number(file.size || 0),
  };
};
