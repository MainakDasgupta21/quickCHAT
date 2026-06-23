import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../context/LocaleContext";

const REPORT_REASON_VALUES = [
  "spam",
  "harassment",
  "hate",
  "violence",
  "impersonation",
  "scam",
  "self_harm",
  "other",
];

const ReportModal = ({
  isOpen = false,
  title = "",
  description = "",
  targetLabel = "",
  onClose = () => {},
  onSubmit = async () => false,
}) => {
  const { t } = useLocale();
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const resolvedTitle = title || t("reportModal.defaultTitle");
  const resolvedDescription = description || t("reportModal.defaultDescription");
  const reasonOptions = useMemo(
    () =>
      REPORT_REASON_VALUES.map((value) => ({
        value,
        label: t(`reportModal.reasons.${value}`),
      })),
    [t]
  );

  useEffect(() => {
    if (!isOpen) {
      setReason("spam");
      setDetails("");
      setIsSubmitting(false);
      return;
    }
    closeButtonRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const dialogElement = dialogRef.current;
    const handleTabTrap = (event) => {
      if (event.key !== "Tab") return;
      const focusableItems = dialogElement?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableItems?.length) return;

      const firstFocusable = focusableItems[0];
      const lastFocusable = focusableItems[focusableItems.length - 1];
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.addEventListener("keydown", handleTabTrap);
    return () => {
      document.removeEventListener("keydown", handleTabTrap);
    };
  }, [isOpen]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    const didSubmit = await onSubmit({
      reason,
      details: String(details || "").trim(),
    });
    setIsSubmitting(false);
    if (didSubmit) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[62] bg-black/55 backdrop-blur-[2px] flex items-start justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={resolvedTitle}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-xl max-h-[92dvh] overflow-y-auto rounded-3xl border border-white/14 bg-[linear-gradient(180deg,rgba(29,25,48,0.98),rgba(13,12,21,0.98))] shadow-soft animate-slide-up"
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">{resolvedTitle}</h3>
            <p className="text-xs text-white/55 mt-0.5">
              {resolvedDescription}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="icon-btn h-9 w-9 rounded-xl"
            aria-label={t("reportModal.closeDialogAria")}
            disabled={isSubmitting}
          >
            x
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {targetLabel && (
            <div className="rounded-xl border border-white/12 bg-white/[0.03] px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-white/50">
                {t("reportModal.reportingLabel")}
              </p>
              <p className="mt-1 text-sm text-white/90 break-words">{targetLabel}</p>
            </div>
          )}

          <label className="block text-sm text-white/85">
            <span className="block mb-1.5">{t("reportModal.reasonLabel")}</span>
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="w-full rounded-xl border border-white/15 bg-white/8 px-3 py-2.5 text-sm text-white"
              aria-label={t("reportModal.reportReasonAria")}
            >
              {reasonOptions.map((option) => (
                <option key={option.value} value={option.value} className="bg-surface-900">
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-white/85">
            <span className="block mb-1.5">{t("reportModal.detailsLabel")}</span>
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={2000}
              rows={5}
              placeholder={t("reportModal.detailsPlaceholder")}
              className="w-full rounded-xl border border-white/15 bg-white/8 px-3 py-2.5 text-sm text-white placeholder:text-white/45 resize-y min-h-[96px]"
              aria-label={t("reportModal.detailsAria")}
            />
            <span className="mt-1.5 block text-[11px] text-white/50">
              {details.length}/2000
            </span>
          </label>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/18 px-3 py-2 text-xs text-white/75 hover:bg-white/8"
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="rounded-xl btn-gradient px-3.5 py-2 text-xs font-medium disabled:opacity-45 disabled:cursor-not-allowed"
              disabled={isSubmitting}
            >
              {isSubmitting ? t("reportModal.submitting") : t("reportModal.submitReport")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default React.memo(ReportModal);
