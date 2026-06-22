import React, { useContext, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import assets from "../assets/assets";
import { ChatContext } from "../../context/ChatContext";
import { AuthContext } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import CreateGroupModal from "./CreateGroupModal";
import ReportModal from "./ReportModal";
import {
  getConversationAvatar,
  getConversationPeerId,
  getConversationTitle,
  isConversationMuted,
  isDirectConversation,
  isGroupConversation,
  toNormalizedId,
} from "../lib/conversations";
import { formatLastSeen } from "../lib/utils";
import { formatLocalizedNumber } from "../i18n/runtime";

const RightSidebar = ({
  mobileSheetOpen = false,
  onCloseMobileSheet = () => {},
  onOpenLightbox = () => {},
}) => {
  const {
    selectedConversation,
    messages,
    contacts,
    getContacts,
    addGroupMembers,
    removeGroupMember,
    leaveConversation,
    updateConversationPreferences = async () => null,
    blockUser = async () => false,
    unblockUser = async () => false,
    reportUser = async () => false,
  } = useContext(ChatContext);
  const { authUser, onlineUsers } = useContext(AuthContext);
  const { isRtl, locale, t } = useLocale();

  const [isManageMembersOpen, setIsManageMembersOpen] = useState(false);
  const [isUpdatingMembers, setIsUpdatingMembers] = useState(false);
  const [isUpdatingPreferences, setIsUpdatingPreferences] = useState(false);
  const [isUpdatingSafetyState, setIsUpdatingSafetyState] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  const isDirect = isDirectConversation(selectedConversation);
  const isGroup = isGroupConversation(selectedConversation);
  const directPeer = isDirect ? selectedConversation?.peer : null;
  const directPeerId = getConversationPeerId(selectedConversation);
  const isDirectPeerOnline = Boolean(
    directPeerId && onlineUsers.includes(directPeerId)
  );
  const isDirectBlockedByMe = Boolean(isDirect && selectedConversation?.blockedByMe);
  const isDirectBlockedByOther = Boolean(isDirect && selectedConversation?.blockedByOther);
  const isDirectBlocked = Boolean(
    isDirect && (selectedConversation?.isBlocked || isDirectBlockedByMe || isDirectBlockedByOther)
  );

  const sharedImages = useMemo(
    () =>
      messages
        .filter((message) => message.image && !message.isDeleted)
        .map((message, index) => ({
          messageId: String(message._id || message.clientId || `message-${index}`),
          url: message.image,
          alt: message.text?.trim() || `Shared media ${index + 1}`,
        })),
    [messages]
  );

  const selectedConversationId = toNormalizedId(selectedConversation?._id);
  const isConversationPinned = Boolean(selectedConversation?.isPinned);
  const isConversationArchived = Boolean(selectedConversation?.isArchived);
  const isConversationMutedState = isConversationMuted(selectedConversation);
  const mutedUntilLabel = selectedConversation?.mutedUntil
    ? new Date(selectedConversation.mutedUntil).toLocaleString(locale)
    : "";
  const memberIds = useMemo(
    () =>
      new Set(
        (selectedConversation?.participants || []).map((participant) =>
          toNormalizedId(participant._id)
        )
      ),
    [selectedConversation?.participants]
  );

  useEffect(() => {
    setIsReportModalOpen(false);
  }, [selectedConversationId]);

  if (!selectedConversation) return null;

  const handleOpenAddMembers = async () => {
    setIsManageMembersOpen(true);
    if (!contacts.length) {
      await getContacts();
    }
  };

  const handleAddMembers = async ({ participantIds }) => {
    if (!selectedConversationId || !participantIds?.length) return;
    setIsUpdatingMembers(true);
    const didAddMembers = await addGroupMembers(
      selectedConversationId,
      participantIds
    );
    if (didAddMembers) {
      toast.success(t("rightSidebar.membersUpdated"));
      setIsManageMembersOpen(false);
    }
    setIsUpdatingMembers(false);
  };

  const handleRemoveMember = async (memberId) => {
    if (!selectedConversationId || !memberId) return;
    setIsUpdatingMembers(true);
    const didRemoveMember = await removeGroupMember(selectedConversationId, memberId);
    if (didRemoveMember) {
      toast.success(t("rightSidebar.memberRemoved"));
    }
    setIsUpdatingMembers(false);
  };

  const handleLeaveConversation = async () => {
    if (!selectedConversationId) return;
    const didLeave = await leaveConversation(selectedConversationId);
    if (didLeave) {
      toast.success(t("rightSidebar.leftConversation"));
      onCloseMobileSheet?.();
    }
  };

  const handleUpdateConversationPreference = async (patch) => {
    if (!selectedConversationId) return;
    setIsUpdatingPreferences(true);
    await updateConversationPreferences(selectedConversationId, patch);
    setIsUpdatingPreferences(false);
  };

  const handleToggleDirectBlock = async () => {
    if (!isDirect || !directPeerId) return;
    setIsUpdatingSafetyState(true);
    if (isDirectBlockedByMe) {
      await unblockUser(directPeerId);
    } else {
      await blockUser(directPeerId);
    }
    setIsUpdatingSafetyState(false);
  };

  const handleSubmitUserReport = async ({ reason, details }) => {
    if (!isDirect || !directPeerId) return false;
    return reportUser(directPeerId, { reason, details });
  };

  const panelBody = (
    <div className="p-5 lg:p-6 pb-6">
      <div className="glass-panel rounded-3xl p-5 text-center animate-slide-up">
        <div className="relative w-fit mx-auto">
          <div className="h-24 w-24 rounded-full p-[2px] bg-[linear-gradient(135deg,#a786ff,#5f47e6)]">
            <img
              src={getConversationAvatar(selectedConversation) || assets.avatar_icon}
              alt={`${getConversationTitle(selectedConversation)} profile`}
              decoding="async"
              className="h-full w-full rounded-full object-cover border border-white/15"
            />
          </div>
          {isDirect && isDirectPeerOnline && (
            <>
              <span
                className={`absolute bottom-1 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-900 ${
                  isRtl ? "left-1" : "right-1"
                }`}
              />
              <span
                className={`absolute bottom-1 h-3.5 w-3.5 rounded-full bg-success/80 animate-pulse-ring ${
                  isRtl ? "left-1" : "right-1"
                }`}
              />
            </>
          )}
        </div>

        <h1 className="mt-4 text-xl font-semibold tracking-wide">
          {getConversationTitle(selectedConversation)}
        </h1>
        <p className="text-xs text-white/60 mt-1">
          {isDirect
            ? isDirectPeerOnline
              ? t("common.onlineAndAvailable")
              : formatLastSeen(directPeer?.lastSeen)
            : t("common.membersCount", {
                count: Math.max((selectedConversation.participants || []).length - 1, 0),
              })}
        </p>
        <div className="mt-4 text-sm text-white/80 bg-white/6 border border-white/12 rounded-2xl p-3">
          {isDirect
            ? directPeer?.bio || t("rightSidebar.noBioAvailable")
            : selectedConversation.name || t("rightSidebar.noGroupDescription")}
        </div>
      </div>

      {isGroup && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-sm font-medium tracking-wide">{t("rightSidebar.members")}</p>
            {selectedConversation.isAdmin && (
              <button
                type="button"
                onClick={handleOpenAddMembers}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-white/18 bg-white/8 hover:bg-white/12"
              >
                {t("rightSidebar.addMembers")}
              </button>
            )}
          </div>

          <div className="space-y-1">
            {(selectedConversation.participants || []).map((participant) => {
              const participantId = toNormalizedId(participant._id);
              const isCurrentUser = participantId === toNormalizedId(authUser?._id);
              const canRemove =
                selectedConversation.isAdmin &&
                !isCurrentUser &&
                participant.role !== "admin";

              return (
                <div
                  key={participantId}
                  className="rounded-xl border border-white/14 bg-white/6 px-2.5 py-2 flex items-center gap-2"
                >
                  <img
                    src={participant.profilePic || assets.avatar_icon}
                    alt={`${participant.fullName} profile`}
                    className="h-8 w-8 rounded-full object-cover border border-white/15"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">
                      {participant.fullName}
                      {isCurrentUser ? t("rightSidebar.youSuffix") : ""}
                    </p>
                    <p className="text-[11px] text-white/55 uppercase">
                      {participant.role || t("common.member")}
                    </p>
                  </div>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(participantId)}
                      disabled={isUpdatingMembers}
                      className="text-[11px] px-2 py-1 rounded-lg border border-rose-300/30 text-rose-200 hover:text-rose-100 disabled:opacity-45"
                    >
                      {t("messageMenu.delete")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6">
        <div className="mb-6">
          <p className="text-sm font-medium tracking-wide mb-3">{t("rightSidebar.organization")}</p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() =>
                handleUpdateConversationPreference({ isPinned: !isConversationPinned })
              }
              disabled={isUpdatingPreferences}
              className="w-full rounded-xl border border-white/15 bg-white/6 px-3 py-2 text-sm text-start hover:bg-white/10 disabled:opacity-45"
            >
              {isConversationPinned
                ? t("rightSidebar.unpinConversation")
                : t("rightSidebar.pinConversation")}
            </button>
            <button
              type="button"
              onClick={() =>
                handleUpdateConversationPreference({ isArchived: !isConversationArchived })
              }
              disabled={isUpdatingPreferences}
              className="w-full rounded-xl border border-white/15 bg-white/6 px-3 py-2 text-sm text-start hover:bg-white/10 disabled:opacity-45"
            >
              {isConversationArchived
                ? t("rightSidebar.unarchiveConversation")
                : t("rightSidebar.archiveConversation")}
            </button>
            <button
              type="button"
              onClick={() =>
                handleUpdateConversationPreference({
                  mutedUntil: isConversationMutedState
                    ? null
                    : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
                })
              }
              disabled={isUpdatingPreferences}
              className="w-full rounded-xl border border-white/15 bg-white/6 px-3 py-2 text-sm text-start hover:bg-white/10 disabled:opacity-45"
            >
              {isConversationMutedState
                ? t("rightSidebar.unmuteConversation")
                : t("rightSidebar.muteEightHours")}
            </button>
            {isConversationMutedState && mutedUntilLabel && (
              <p className="text-[11px] text-white/55 px-1">
                {t("rightSidebar.mutedUntil", { time: mutedUntilLabel })}
              </p>
            )}
          </div>
        </div>

        {isDirect && (
          <div className="mb-6">
            <p className="text-sm font-medium tracking-wide mb-3">{t("rightSidebar.safety")}</p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleToggleDirectBlock}
                disabled={isUpdatingSafetyState}
                className={`w-full rounded-xl border px-3 py-2 text-sm text-start disabled:opacity-45 ${
                  isDirectBlockedByMe
                    ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15"
                    : "border-rose-300/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15"
                }`}
              >
                {isDirectBlockedByMe
                  ? t("rightSidebar.unblockUser")
                  : t("rightSidebar.blockUser")}
              </button>
              <button
                type="button"
                onClick={() => setIsReportModalOpen(true)}
                className="w-full rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-start text-amber-100 hover:bg-amber-500/15"
              >
                {t("rightSidebar.reportUser")}
              </button>
              {isDirectBlocked && (
                <p className="text-[11px] px-1 text-white/60">
                  {isDirectBlockedByMe
                    ? t("rightSidebar.blockedByMeHint")
                    : t("rightSidebar.blockedByOtherHint")}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium tracking-wide">{t("rightSidebar.sharedMedia")}</p>
          <span className="text-xs text-white/55">
            {t("rightSidebar.itemsCount", {
              count: formatLocalizedNumber(sharedImages.length),
            })}
          </span>
        </div>

        {sharedImages.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {sharedImages.map((item, index) => (
              <button
                type="button"
                key={item.messageId}
                onClick={() => onOpenLightbox(sharedImages, index)}
                className="group aspect-square rounded-2xl overflow-hidden border border-white/14 bg-white/6"
                aria-label={t("rightSidebar.openSharedImageAria", {
                  index: formatLocalizedNumber(index + 1),
                })}
              >
                <img
                  src={item.url}
                  alt={item.alt}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-center text-sm text-white/65">
            {t("rightSidebar.noSharedMedia")}
          </div>
        )}
      </div>

      {isGroup && (
        <div className="sticky bottom-0 pt-6 pb-2 bg-gradient-to-t from-surface-900/85 to-transparent">
          <button
            type="button"
            onClick={handleLeaveConversation}
            className="w-full rounded-2xl border border-rose-300/30 text-rose-200 text-sm font-medium py-3 hover:bg-rose-500/12"
          >
            {t("rightSidebar.leaveGroup")}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div
        className={`hidden md:block w-full h-full text-white border-white/10 ${
          isRtl ? "border-r" : "border-l"
        } bg-[linear-gradient(180deg,rgba(129,133,178,0.12),rgba(15,13,24,0.8))] overflow-y-auto`}
      >
        {panelBody}
      </div>

      {mobileSheetOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden bg-black/55 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label={t("rightSidebar.conversationDetails")}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              onCloseMobileSheet();
            }
          }}
        >
          <div className="absolute inset-x-3 top-14 bottom-[max(0.75rem,env(safe-area-inset-bottom))] rounded-3xl border border-white/15 bg-[linear-gradient(180deg,rgba(26,22,41,0.97),rgba(15,13,24,0.98))] overflow-y-auto">
            <div className="sticky top-0 z-10 px-4 py-3 border-b border-white/10 bg-surface-900/80 backdrop-blur-sm flex items-center justify-between">
              <p className="text-sm font-medium text-white">
                {t("rightSidebar.conversationDetails")}
              </p>
              <button
                type="button"
                onClick={onCloseMobileSheet}
                className="h-9 w-9 rounded-xl bg-white/8 border border-white/12 text-white/80"
                aria-label={t("rightSidebar.closeConversationDetails")}
              >
                ×
              </button>
            </div>
            {panelBody}
          </div>
        </div>
      )}

      <CreateGroupModal
        isOpen={isManageMembersOpen}
        onClose={() => setIsManageMembersOpen(false)}
        contacts={contacts}
        onSubmit={handleAddMembers}
        title={t("rightSidebar.addMembers")}
        submitLabel={t("rightSidebar.addMembers")}
        showGroupName={false}
        isSubmitting={isUpdatingMembers}
        excludedUserIds={Array.from(memberIds)}
      />
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        title={t("rightSidebar.reportUser")}
        description={t("rightSidebar.reportUserDescription")}
        targetLabel={directPeer?.fullName || t("rightSidebar.directUserFallback")}
        onSubmit={handleSubmitUserReport}
      />
    </>
  );
};

export default React.memo(RightSidebar);
