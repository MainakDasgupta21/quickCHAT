import React, { useEffect, useMemo, useState } from "react";
import assets from "../assets/assets";
import { toNormalizedId } from "../lib/conversations";
import { useLocale } from "../../context/LocaleContext";

const EMPTY_ID_LIST = [];

const normalizeIdList = (ids) =>
  (Array.isArray(ids) ? ids : [])
    .map((id) => toNormalizedId(id))
    .filter(Boolean);

const CreateGroupModal = ({
  isOpen,
  onClose,
  contacts = [],
  onSubmit,
  title = "",
  submitLabel = "",
  showGroupName = true,
  selectionMode = "multiple",
  initialGroupName = "",
  initialSelectedIds = EMPTY_ID_LIST,
  excludedUserIds = EMPTY_ID_LIST,
  isLoadingContacts = false,
  onRefreshContacts = null,
  isSubmitting = false,
}) => {
  const [groupName, setGroupName] = useState(initialGroupName);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(normalizeIdList(initialSelectedIds))
  );
  const { t } = useLocale();
  const resolvedTitle = title || t("sidebar.newGroup");
  const resolvedSubmitLabel = submitLabel || t("common.submit");
  const normalizedInitialSelectedIdsKey = useMemo(
    () => [...normalizeIdList(initialSelectedIds)].sort().join("|"),
    [initialSelectedIds]
  );
  const normalizedInitialSelectedIds = useMemo(
    () => (normalizedInitialSelectedIdsKey ? normalizedInitialSelectedIdsKey.split("|") : []),
    [normalizedInitialSelectedIdsKey]
  );
  const isSingleSelectionMode = selectionMode === "single";

  useEffect(() => {
    if (!isOpen) return;
    setGroupName(initialGroupName || "");
    setQuery("");
    setSelectedIds(new Set(normalizedInitialSelectedIds));
  }, [initialGroupName, isOpen, normalizedInitialSelectedIds]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose?.();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, isSubmitting, onClose]);

  const excludedIdsSet = useMemo(
    () => new Set(normalizeIdList(excludedUserIds)),
    [excludedUserIds]
  );

  const filteredContacts = useMemo(() => {
    const loweredQuery = query.trim().toLowerCase();
    return contacts.filter((contact) => {
      const contactId = toNormalizedId(contact._id);
      if (!contactId || excludedIdsSet.has(contactId)) return false;
      if (!loweredQuery) return true;
      return (
        String(contact.fullName || "").toLowerCase().includes(loweredQuery) ||
        String(contact.bio || "").toLowerCase().includes(loweredQuery)
      );
    });
  }, [contacts, excludedIdsSet, query]);

  const selectedCount = selectedIds.size;
  const hasSearchQuery = query.trim().length > 0;
  const canRetryContactLoad =
    !hasSearchQuery && typeof onRefreshContacts === "function" && !isLoadingContacts;

  const toggleSelection = (userId) => {
    const normalizedUserId = toNormalizedId(userId);
    if (!normalizedUserId) return;

    setSelectedIds((previousSelectedIds) => {
      if (isSingleSelectionMode) {
        if (previousSelectedIds.size === 1 && previousSelectedIds.has(normalizedUserId)) {
          return new Set();
        }
        return new Set([normalizedUserId]);
      }

      const nextSelectedIds = new Set(previousSelectedIds);
      if (nextSelectedIds.has(normalizedUserId)) {
        nextSelectedIds.delete(normalizedUserId);
      } else {
        nextSelectedIds.add(normalizedUserId);
      }
      return nextSelectedIds;
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    const payload = {
      name: groupName.trim(),
      participantIds: Array.from(selectedIds),
    };
    await onSubmit?.(payload);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={resolvedTitle}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isSubmitting) {
          onClose?.();
        }
      }}
    >
      <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-3xl border border-white/16 bg-[linear-gradient(180deg,rgba(31,27,50,0.98),rgba(15,13,24,0.98))] shadow-soft">
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-white">{resolvedTitle}</h3>
            <button
              type="button"
              onClick={() => !isSubmitting && onClose?.()}
              className="icon-btn h-9 w-9 rounded-xl"
              aria-label={t("createGroupModal.closeAria")}
            >
              ×
            </button>
          </div>

          <div className="px-5 py-4 space-y-3">
            {showGroupName && (
              <label className="block">
                <span className="text-xs text-white/60">{t("createGroupModal.groupNameLabel")}</span>
                <input
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  maxLength={80}
                  placeholder={t("createGroupModal.groupNamePlaceholder")}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/8 px-3 py-2.5 text-sm text-white placeholder:text-white/45"
                />
              </label>
            )}

            <label className="block">
              <span className="text-xs text-white/60">{t("createGroupModal.addParticipants")}</span>
              <div className="mt-1 rounded-xl border border-white/15 bg-white/8 px-3 py-2.5 flex items-center gap-2">
                <img src={assets.search_icon} alt="" className="h-3.5 w-3.5 opacity-70" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("createGroupModal.searchPeoplePlaceholder")}
                  className="bg-transparent text-sm text-white placeholder:text-white/45 flex-1 outline-none"
                />
              </div>
            </label>

            <div className="max-h-64 overflow-y-auto space-y-1 rounded-xl border border-white/12 bg-white/[0.03] p-2">
              {isLoadingContacts ? (
                <p className="text-xs text-white/55 text-center py-5">
                  {t("loginPage.pleaseWait")}
                </p>
              ) : filteredContacts.length === 0 ? (
                <div className="text-center py-5 space-y-2">
                  <p className="text-xs text-white/55">
                    {hasSearchQuery
                      ? t("createGroupModal.noContactsFound")
                      : t("sidebar.noContactsAvailable")}
                  </p>
                  {canRetryContactLoad && (
                    <button
                      type="button"
                      onClick={() => {
                        void onRefreshContacts();
                      }}
                      disabled={isSubmitting}
                      className="text-xs rounded-lg border border-white/18 bg-white/7 px-2.5 py-1.5 text-white/80 hover:bg-white/12 disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {t("common.retry")}
                    </button>
                  )}
                </div>
              ) : (
                filteredContacts.map((contact) => {
                const contactId = toNormalizedId(contact._id);
                const isSelected = selectedIds.has(contactId);
                return (
                  <button
                    key={contactId}
                    type="button"
                    onClick={() => toggleSelection(contactId)}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl border text-start transition ${
                      isSelected
                        ? "border-brand-300/55 bg-brand-500/18"
                        : "border-transparent hover:border-white/15 hover:bg-white/7"
                    }`}
                  >
                    <img
                      src={contact.profilePic || assets.avatar_icon}
                      alt={`${contact.fullName} profile`}
                      className="h-9 w-9 rounded-full object-cover border border-white/16"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{contact.fullName}</p>
                      <p className="text-xs text-white/55 truncate">
                        {contact.bio || t("createGroupModal.noBio")}
                      </p>
                    </div>
                    <span
                      className={`h-4.5 w-4.5 rounded border ${
                        isSelected
                          ? "bg-brand-300 border-brand-200"
                          : "border-white/35 bg-transparent"
                      }`}
                    />
                  </button>
                );
                })
              )}
            </div>
          </div>

          <div className="px-5 py-4 border-t border-white/10 flex items-center justify-between gap-3">
            <p className="text-xs text-white/60">
              {t("createGroupModal.selectedCount", {
                count: selectedCount,
                label:
                  selectedCount === 1
                    ? t("createGroupModal.person")
                    : t("createGroupModal.people"),
              })}
            </p>
            <button
              type="submit"
              disabled={
                isSubmitting ||
                isLoadingContacts ||
                selectedCount === 0 ||
                (showGroupName && !groupName.trim())
              }
              className="btn-gradient px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t("loginPage.pleaseWait") : resolvedSubmitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateGroupModal;
