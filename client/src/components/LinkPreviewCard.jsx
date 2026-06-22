import React from "react";

const toPreviewHost = (urlValue = "") => {
  try {
    return new URL(String(urlValue || "")).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
};

const LinkPreviewCard = ({ preview = null, isOwn = false }) => {
  const previewUrl = String(preview?.url || "").trim();
  if (!previewUrl) return null;

  const previewStatus = String(preview?.status || "ready").toLowerCase();
  if (previewStatus === "failed") return null;

  const hostLabel = String(preview?.siteName || "").trim() || toPreviewHost(previewUrl);
  const titleLabel = String(preview?.title || "").trim() || hostLabel || "Link preview";
  const descriptionLabel = String(preview?.description || "").trim();
  const imageUrl = String(preview?.image || "").trim();
  const cardClassName = isOwn
    ? "mt-1.5 w-full max-w-md rounded-2xl border border-brand-200/40 bg-brand-700/35 overflow-hidden"
    : "mt-1.5 w-full max-w-md rounded-2xl border border-white/16 bg-white/6 overflow-hidden";

  if (previewStatus === "pending") {
    return (
      <div className={cardClassName}>
        <div className="px-3 py-2.5">
          <p className="text-xs text-white/70">Fetching link preview...</p>
          {hostLabel && <p className="mt-0.5 text-[11px] text-white/50 truncate">{hostLabel}</p>}
        </div>
      </div>
    );
  }

  return (
    <a
      href={previewUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={`${cardClassName} block hover:border-white/28 transition`}
    >
      {imageUrl && (
        <div className="w-full max-h-44 overflow-hidden bg-black/20">
          <img
            src={imageUrl}
            alt={titleLabel}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <div className="px-3 py-2.5">
        <p className="text-xs text-white/55 truncate">{hostLabel || "External link"}</p>
        <p className="mt-0.5 text-sm text-white/95 line-clamp-2">{titleLabel}</p>
        {descriptionLabel && (
          <p className="mt-1 text-xs text-white/72 line-clamp-2">{descriptionLabel}</p>
        )}
      </div>
    </a>
  );
};

export default React.memo(LinkPreviewCard);
