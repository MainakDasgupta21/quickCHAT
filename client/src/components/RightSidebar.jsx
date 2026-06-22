import React, { useContext, useMemo, useState } from "react";
import toast from "react-hot-toast";
import assets from "../assets/assets";
import { ChatContext } from "../../context/ChatContext";
import { AuthContext } from "../../context/AuthContext";
import CreateGroupModal from "./CreateGroupModal";
import {
  getConversationAvatar,
  getConversationPeerId,
  getConversationTitle,
  isDirectConversation,
  isGroupConversation,
  toNormalizedId,
} from "../lib/conversations";
import { formatLastSeen } from "../lib/utils";

const RightSidebar = ({
  mobileSheetOpen = false,
  onCloseMobileSheet = () => {},
}) => {
  const {
    selectedConversation,
    messages,
    contacts,
    getContacts,
    addGroupMembers,
    removeGroupMember,
    leaveConversation,
  } = useContext(ChatContext);
  const { authUser, onlineUsers } = useContext(AuthContext);

  const [isManageMembersOpen, setIsManageMembersOpen] = useState(false);
  const [isUpdatingMembers, setIsUpdatingMembers] = useState(false);

  const isDirect = isDirectConversation(selectedConversation);
  const isGroup = isGroupConversation(selectedConversation);
  const directPeer = isDirect ? selectedConversation?.peer : null;
  const directPeerId = getConversationPeerId(selectedConversation);
  const isDirectPeerOnline = Boolean(
    directPeerId && onlineUsers.includes(directPeerId)
  );

  const sharedImages = useMemo(
    () =>
      messages
        .filter((message) => message.image && !message.isDeleted)
        .map((message) => message.image),
    [messages]
  );

  const selectedConversationId = toNormalizedId(selectedConversation?._id);
  const memberIds = useMemo(
    () =>
      new Set(
        (selectedConversation?.participants || []).map((participant) =>
          toNormalizedId(participant._id)
        )
      ),
    [selectedConversation?.participants]
  );

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
      toast.success("Members updated");
      setIsManageMembersOpen(false);
    }
    setIsUpdatingMembers(false);
  };

  const handleRemoveMember = async (memberId) => {
    if (!selectedConversationId || !memberId) return;
    setIsUpdatingMembers(true);
    const didRemoveMember = await removeGroupMember(selectedConversationId, memberId);
    if (didRemoveMember) {
      toast.success("Member removed");
    }
    setIsUpdatingMembers(false);
  };

  const handleLeaveConversation = async () => {
    if (!selectedConversationId) return;
    const didLeave = await leaveConversation(selectedConversationId);
    if (didLeave) {
      toast.success("Left conversation");
      onCloseMobileSheet?.();
    }
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
              <span className="absolute right-1 bottom-1 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-900" />
              <span className="absolute right-1 bottom-1 h-3.5 w-3.5 rounded-full bg-success/80 animate-pulse-ring" />
            </>
          )}
        </div>

        <h1 className="mt-4 text-xl font-semibold tracking-wide">
          {getConversationTitle(selectedConversation)}
        </h1>
        <p className="text-xs text-white/60 mt-1">
          {isDirect
            ? isDirectPeerOnline
              ? "Online and available"
              : formatLastSeen(directPeer?.lastSeen)
            : `${Math.max((selectedConversation.participants || []).length - 1, 0)} members`}
        </p>
        <div className="mt-4 text-sm text-white/80 bg-white/6 border border-white/12 rounded-2xl p-3">
          {isDirect
            ? directPeer?.bio || "No bio available yet."
            : selectedConversation.name || "No group description yet."}
        </div>
      </div>

      {isGroup && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-sm font-medium tracking-wide">Members</p>
            {selectedConversation.isAdmin && (
              <button
                type="button"
                onClick={handleOpenAddMembers}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-white/18 bg-white/8 hover:bg-white/12"
              >
                Add members
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
                      {isCurrentUser ? " (You)" : ""}
                    </p>
                    <p className="text-[11px] text-white/55 uppercase">
                      {participant.role || "member"}
                    </p>
                  </div>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(participantId)}
                      disabled={isUpdatingMembers}
                      className="text-[11px] px-2 py-1 rounded-lg border border-rose-300/30 text-rose-200 hover:text-rose-100 disabled:opacity-45"
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium tracking-wide">Shared media</p>
          <span className="text-xs text-white/55">{sharedImages.length} items</span>
        </div>

        {sharedImages.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {sharedImages.map((url, index) => (
              <button
                type="button"
                key={`${url}-${index}`}
                onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                className="group aspect-square rounded-2xl overflow-hidden border border-white/14 bg-white/6"
                aria-label={`Open shared image ${index + 1}`}
              >
                <img
                  src={url}
                  alt={`Shared media ${index + 1}`}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-center text-sm text-white/65">
            Media from this conversation will appear here.
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
            Leave group
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="hidden md:block w-full h-full text-white border-l border-white/10 bg-[linear-gradient(180deg,rgba(129,133,178,0.12),rgba(15,13,24,0.8))] overflow-y-auto">
        {panelBody}
      </div>

      {mobileSheetOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden bg-black/55 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Conversation details"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              onCloseMobileSheet();
            }
          }}
        >
          <div className="absolute inset-x-3 top-14 bottom-[max(0.75rem,env(safe-area-inset-bottom))] rounded-3xl border border-white/15 bg-[linear-gradient(180deg,rgba(26,22,41,0.97),rgba(15,13,24,0.98))] overflow-y-auto">
            <div className="sticky top-0 z-10 px-4 py-3 border-b border-white/10 bg-surface-900/80 backdrop-blur-sm flex items-center justify-between">
              <p className="text-sm font-medium text-white">Conversation details</p>
              <button
                type="button"
                onClick={onCloseMobileSheet}
                className="h-9 w-9 rounded-xl bg-white/8 border border-white/12 text-white/80"
                aria-label="Close conversation details"
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
        title="Add members"
        submitLabel="Add"
        showGroupName={false}
        isSubmitting={isUpdatingMembers}
        excludedUserIds={Array.from(memberIds)}
      />
    </>
  );
};

export default React.memo(RightSidebar);
