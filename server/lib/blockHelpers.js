import mongoose from "mongoose";
import User from "../models/User.js";
import {
  getConversationParticipantIds,
  getOtherParticipantIdForDirect,
} from "./conversationHelpers.js";

export const toNormalizedId = (value) => String(value?._id || value || "").trim();

export const toNormalizedIdSet = (values = []) =>
  new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => toNormalizedId(value))
      .filter(Boolean)
  );

export const isValidUserId = (value) =>
  mongoose.Types.ObjectId.isValid(toNormalizedId(value));

export const toBlockedUserSet = (userLike) =>
  toNormalizedIdSet(userLike?.blockedUsers || []);

export const getUserBlockedSet = async (userId) => {
  const normalizedUserId = toNormalizedId(userId);
  if (!normalizedUserId || !isValidUserId(normalizedUserId)) {
    return new Set();
  }

  const user = await User.findById(normalizedUserId).select("blockedUsers").lean();
  return toBlockedUserSet(user);
};

export const getBlockedSetMap = async (userIds = []) => {
  const normalizedUserIds = Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [])
        .map((userId) => toNormalizedId(userId))
        .filter((userId) => userId && isValidUserId(userId))
    )
  );
  if (!normalizedUserIds.length) return new Map();

  const users = await User.find({ _id: { $in: normalizedUserIds } })
    .select("_id blockedUsers")
    .lean();
  const blockedSetMap = new Map();
  users.forEach((user) => {
    blockedSetMap.set(toNormalizedId(user._id), toBlockedUserSet(user));
  });
  normalizedUserIds.forEach((userId) => {
    if (!blockedSetMap.has(userId)) {
      blockedSetMap.set(userId, new Set());
    }
  });
  return blockedSetMap;
};

const toResolvedBlockedSet = async (userId, blockedSetOverride = null) => {
  if (blockedSetOverride instanceof Set) return blockedSetOverride;
  if (Array.isArray(blockedSetOverride)) return toNormalizedIdSet(blockedSetOverride);
  return getUserBlockedSet(userId);
};

const toStateWithPeer = (state, peerId = "") => ({
  ...state,
  peerId: toNormalizedId(peerId),
});

export const createBlockState = ({
  viewerId,
  peerId,
  viewerBlockedSet = new Set(),
  peerBlockedSet = new Set(),
}) => {
  const normalizedViewerId = toNormalizedId(viewerId);
  const normalizedPeerId = toNormalizedId(peerId);
  if (!normalizedViewerId || !normalizedPeerId) {
    return toStateWithPeer(
      {
        blocked: false,
        blockedByMe: false,
        blockedByOther: false,
      },
      normalizedPeerId
    );
  }

  const blockedByMe = viewerBlockedSet.has(normalizedPeerId);
  const blockedByOther = peerBlockedSet.has(normalizedViewerId);
  return toStateWithPeer(
    {
      blocked: blockedByMe || blockedByOther,
      blockedByMe,
      blockedByOther,
    },
    normalizedPeerId
  );
};

export const isBlockedByEitherSide = async ({
  viewerId,
  peerId,
  viewerBlockedSet = null,
  peerBlockedSet = null,
}) => {
  const normalizedViewerId = toNormalizedId(viewerId);
  const normalizedPeerId = toNormalizedId(peerId);
  if (!normalizedViewerId || !normalizedPeerId) {
    return toStateWithPeer(
      {
        blocked: false,
        blockedByMe: false,
        blockedByOther: false,
      },
      normalizedPeerId
    );
  }

  const resolvedViewerBlockedSet = await toResolvedBlockedSet(
    normalizedViewerId,
    viewerBlockedSet
  );
  const resolvedPeerBlockedSet = await toResolvedBlockedSet(
    normalizedPeerId,
    peerBlockedSet
  );
  return createBlockState({
    viewerId: normalizedViewerId,
    peerId: normalizedPeerId,
    viewerBlockedSet: resolvedViewerBlockedSet,
    peerBlockedSet: resolvedPeerBlockedSet,
  });
};

export const isMessagingBlocked = async ({
  senderId,
  receiverId,
  senderBlockedSet = null,
  receiverBlockedSet = null,
}) =>
  isBlockedByEitherSide({
    viewerId: senderId,
    peerId: receiverId,
    viewerBlockedSet: senderBlockedSet,
    peerBlockedSet: receiverBlockedSet,
  });

export const resolveDirectPeerId = (conversation, viewerId) => {
  if (!conversation || conversation.type !== "direct") return "";
  const directPeerId =
    getOtherParticipantIdForDirect(conversation, viewerId) ||
    getConversationParticipantIds(conversation).find(
      (participantId) => participantId !== toNormalizedId(viewerId)
    ) ||
    "";
  return toNormalizedId(directPeerId);
};

export const getConversationBlockState = async ({
  conversation,
  viewerId,
  blockedSetMap = null,
  viewerBlockedSet = null,
}) => {
  if (!conversation || conversation.type !== "direct") {
    return {
      blocked: false,
      blockedByMe: false,
      blockedByOther: false,
      peerId: "",
    };
  }

  const normalizedViewerId = toNormalizedId(viewerId);
  const peerId = resolveDirectPeerId(conversation, viewerId);
  if (!normalizedViewerId || !peerId) {
    return {
      blocked: false,
      blockedByMe: false,
      blockedByOther: false,
      peerId,
    };
  }

  const mapLookup = blockedSetMap instanceof Map ? blockedSetMap : null;
  const resolvedViewerBlockedSet =
    viewerBlockedSet instanceof Set
      ? viewerBlockedSet
      : mapLookup?.get(normalizedViewerId) || (await getUserBlockedSet(normalizedViewerId));
  const resolvedPeerBlockedSet =
    mapLookup?.get(peerId) || (await getUserBlockedSet(peerId));

  return createBlockState({
    viewerId: normalizedViewerId,
    peerId,
    viewerBlockedSet: resolvedViewerBlockedSet,
    peerBlockedSet: resolvedPeerBlockedSet,
  });
};

export const toBlockMessageForSender = (blockState = {}) => {
  if (blockState?.blockedByMe) {
    return "You blocked this user. Unblock to continue messaging.";
  }
  if (blockState?.blockedByOther) {
    return "You cannot message this user right now.";
  }
  return "Messaging is blocked for this direct conversation.";
};
