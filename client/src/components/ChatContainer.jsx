import React, {
  Suspense,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import assets from "../assets/assets";
import {
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  formatFileSize,
  formatLastSeen,
  formatMessageTime,
  getErrorMessage,
} from "../lib/utils";
import MessageText from "../lib/messageText";
import { stripMarkdownForPreview } from "../lib/messageTextPreview";
import {
  getConversationBlockState,
  getConversationAvatar,
  getConversationPeerId,
  getConversationTitle,
  isDirectConversation,
  isMessagePendingRelease,
  toNormalizedId,
} from "../lib/conversations";
import { uploadFileToCloudinary } from "../lib/mediaUpload";
import { ChatContext } from "../../context/ChatContext";
import { AuthContext } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import toast from "react-hot-toast";
import MessageList from "./MessageList";
import RightSidebar from "./RightSidebar";
import ForwardMessageModal from "./ForwardMessageModal";
import ReportModal from "./ReportModal";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

const MENTION_TRIGGER_REGEX = /(?:^|\s)@([a-zA-Z0-9_]*)$/;
const MENTION_TOKEN_REGEX = /@([a-zA-Z0-9_]+)/g;
const SCHEDULE_IMMEDIATE_THRESHOLD_MS = 1000;
const DISAPPEAR_PRESET_OPTIONS = [
  { label: "Off", value: "" },
  { label: "30s", value: String(30 * 1000) },
  { label: "5m", value: String(5 * 60 * 1000) },
  { label: "1h", value: String(60 * 60 * 1000) },
  { label: "1d", value: String(24 * 60 * 60 * 1000) },
];

const toLocalDateTimeInputValue = (value) => {
  if (!value) return "";
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "";
  const timezoneOffsetMs = parsedDate.getTimezoneOffset() * 60 * 1000;
  return new Date(parsedDate.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
};

const toIsoFromLocalDateTimeValue = (value) => {
  if (!value) return "";
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "";
  return parsedDate.toISOString();
};

const normalizeMentionHandleBase = (fullName = "", fallback = "") => {
  const normalized = String(fullName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback || "member";
};

const toMentionIds = (mentionsValue) =>
  Array.isArray(mentionsValue)
    ? mentionsValue
        .map((mention) => toNormalizedId(mention?._id || mention?.userId || mention))
        .filter(Boolean)
    : [];

const toReportMessageLabel = (message, t) => {
  if (!message) return t("conversations.conversation");
  if (message.isDeleted) return t("common.attachment.deletedMessage");
  if (isMessagePendingRelease(message)) return t("common.attachment.scheduledMessage");
  if (String(message.text || "").trim()) {
    return stripMarkdownForPreview(message.text, 200);
  }
  if (message.image) return t("common.attachment.photo");
  if (message.audio?.url) return t("common.attachment.voiceNote");
  if (String(message.file?.type || "").startsWith("video/")) return t("common.attachment.video");
  if (message.file?.name) return t("common.attachment.fileNamed", { name: message.file.name });
  return t("common.attachment.attachment");
};

const ChatContainer = ({
  onOpenLightbox = () => {},
}) => {
  const {
    messages,
    conversations,
    selectedConversation,
    selectedConversationBlockState,
    setSelectedConversation,
    sendMessage,
    getMessages,
    loadOlderMessages = async () => false,
    messagesLoading = false,
    loadingOlderMessages = false,
    hasMoreMessages = false,
    typingUsers = {},
    emitTyping = () => {},
    emitStopTyping = () => {},
    editMessage = async () => false,
    deleteMessage = async () => false,
    reactToMessage = async () => false,
    toggleStarMessage = async () => ({ success: false }),
    forwardMessage = async () => ({ success: false, forwarded: [], failed: [] }),
    reportMessage = async () => false,
    retryMessage = () => {},
    discardFailedMessage = () => {},
    replyTo,
    setReplyTo,
    searchMessages,
    getThreadMessages = async () => ({ success: false, messages: [] }),
    pendingConversationJumpTarget = null,
    clearPendingConversationJumpTarget = () => {},
  } = useContext(ChatContext);
  const { authUser, onlineUsers, axios } = useContext(AuthContext);
  const { isRtl, t } = useLocale();
  const virtuosoRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const typingRef = useRef(false);
  const previousMessageCountRef = useRef(0);
  const previousTailMessageIdRef = useRef(null);
  const lastAutoFollowKeyRef = useRef("");
  const skipNextAutoFollowRef = useRef(false);
  const messageElementRefs = useRef({});
  const messageIndexByIdRef = useRef(new Map());
  const hasMoreMessagesRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const audioStreamRef = useRef(null);
  const recordingIntervalRef = useRef(null);
  const recordingSecondsRef = useRef(0);
  const searchTimeoutRef = useRef(null);
  const composerEmojiRef = useRef(null);
  const composerEmojiTriggerRef = useRef(null);
  const composerInputRef = useRef(null);

  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [pendingBelowCount, setPendingBelowCount] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState([]);
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0);
  const [openMessageMenuId, setOpenMessageMenuId] = useState(null);
  const [openReactionPickerId, setOpenReactionPickerId] = useState(null);
  const [openTouchActionsMessageId, setOpenTouchActionsMessageId] = useState("");
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionRange, setMentionRange] = useState(null);
  const [activeMentionSuggestionIndex, setActiveMentionSuggestionIndex] = useState(0);
  const [isThreadPanelOpen, setIsThreadPanelOpen] = useState(false);
  const [threadPanelLoading, setThreadPanelLoading] = useState(false);
  const [activeThreadRootMessageId, setActiveThreadRootMessageId] = useState("");
  const [threadMessages, setThreadMessages] = useState([]);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
  const [forwardSourceMessage, setForwardSourceMessage] = useState(null);
  const [isForwardingMessage, setIsForwardingMessage] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportSourceMessage, setReportSourceMessage] = useState(null);
  const [pendingGlobalJumpMessageId, setPendingGlobalJumpMessageId] = useState("");
  const [isGlobalJumpFetchInProgress, setIsGlobalJumpFetchInProgress] = useState(false);
  const [mediaUploadState, setMediaUploadState] = useState({
    active: false,
    label: "",
    percent: 0,
  });
  const [isSchedulePanelOpen, setIsSchedulePanelOpen] = useState(false);
  const [scheduledSendAtInput, setScheduledSendAtInput] = useState("");
  const [disappearAfterMsInput, setDisappearAfterMsInput] = useState("");

  const handleCloseTouchActions = useCallback(() => {
    setOpenTouchActionsMessageId("");
  }, []);

  const handleToggleTouchActions = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || "");
    if (!normalizedMessageId) return;
    setOpenTouchActionsMessageId((previousMessageId) =>
      previousMessageId === normalizedMessageId ? "" : normalizedMessageId
    );
  }, []);

  const selectedConversationId = toNormalizedId(selectedConversation?._id);
  const selectedConversationPeerId = getConversationPeerId(selectedConversation);
  const selectedConversationTitle = getConversationTitle(selectedConversation);
  const selectedConversationAvatar = getConversationAvatar(selectedConversation);
  const isDirectSelectedConversation = isDirectConversation(selectedConversation);
  const fallbackDirectConversationBlockState = useMemo(
    () => getConversationBlockState(selectedConversation),
    [selectedConversation]
  );
  const resolvedDirectConversationBlockState = isDirectSelectedConversation
    ? selectedConversationBlockState || fallbackDirectConversationBlockState
    : fallbackDirectConversationBlockState;
  const isDirectConversationBlocked = Boolean(
    isDirectSelectedConversation && resolvedDirectConversationBlockState?.isBlocked
  );
  const isDirectConversationBlockedByMe = Boolean(
    isDirectSelectedConversation && resolvedDirectConversationBlockState?.blockedByMe
  );
  const isDirectConversationBlockedByOther = Boolean(
    isDirectSelectedConversation && resolvedDirectConversationBlockState?.blockedByOther
  );
  const canInteractInSelectedConversation = !isDirectConversationBlocked;
  const isDirectPeerOnline = Boolean(
    selectedConversationPeerId && onlineUsers.includes(selectedConversationPeerId)
  );
  const participantNameById = useMemo(
    () =>
      new Map(
        (selectedConversation?.participants || []).map((participant) => [
          toNormalizedId(participant._id),
          participant.fullName || t("common.member"),
        ])
      ),
    [selectedConversation?.participants, t]
  );
  const mentionDirectory = useMemo(() => {
    const normalizedAuthUserId = toNormalizedId(authUser?._id);
    const handlesInUse = new Set();
    const entries = [];

    (selectedConversation?.participants || []).forEach((participant, index) => {
      const participantId = toNormalizedId(participant?._id);
      if (!participantId || participantId === normalizedAuthUserId) return;

      const fallbackHandle = `member_${String(index + 1)}`;
      const baseHandle = normalizeMentionHandleBase(
        participant.fullName,
        fallbackHandle
      );
      let candidateHandle = baseHandle;
      let suffix = 2;
      while (handlesInUse.has(candidateHandle)) {
        candidateHandle = `${baseHandle}_${suffix}`;
        suffix += 1;
      }
      handlesInUse.add(candidateHandle);

      entries.push({
        id: participantId,
        fullName: participant.fullName || t("common.member"),
        profilePic: participant.profilePic || "",
        handle: candidateHandle,
        searchText: `${participant.fullName || ""} ${candidateHandle}`.toLowerCase(),
      });
    });

    const byHandle = new Map(entries.map((entry) => [entry.handle, entry]));
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return { list: entries, byHandle, byId };
  }, [authUser?._id, selectedConversation?.participants, t]);
  const selectedMentionIds = useMemo(() => {
    const mentionIds = [];
    const seenMentionIds = new Set();
    for (const mentionMatch of String(input || "").matchAll(MENTION_TOKEN_REGEX)) {
      const mentionHandle = String(mentionMatch[1] || "").toLowerCase();
      if (!mentionHandle) continue;
      const matchedMention = mentionDirectory.byHandle.get(mentionHandle);
      if (!matchedMention?.id) continue;
      if (seenMentionIds.has(matchedMention.id)) continue;
      seenMentionIds.add(matchedMention.id);
      mentionIds.push(matchedMention.id);
    }
    return mentionIds;
  }, [input, mentionDirectory.byHandle]);
  const mentionSuggestions = useMemo(() => {
    if (!mentionRange) return [];
    const normalizedMentionQuery = String(mentionQuery || "").trim().toLowerCase();
    return mentionDirectory.list
      .filter((entry) =>
        normalizedMentionQuery
          ? entry.searchText.includes(normalizedMentionQuery)
          : true
      )
      .slice(0, 6);
  }, [mentionDirectory.list, mentionQuery, mentionRange]);
  const threadRootMessage = useMemo(
    () =>
      threadMessages.find(
        (message) => toNormalizedId(message._id) === toNormalizedId(activeThreadRootMessageId)
      ) ||
      messages.find(
        (message) => toNormalizedId(message._id) === toNormalizedId(activeThreadRootMessageId)
      ) ||
      null,
    [activeThreadRootMessageId, messages, threadMessages]
  );
  const forwardSourceMessageId = toNormalizedId(forwardSourceMessage?._id);
  const reportSourceMessageId = toNormalizedId(reportSourceMessage?._id);
  const reportSourceMessageLabel = useMemo(
    () => toReportMessageLabel(reportSourceMessage, t),
    [reportSourceMessage, t]
  );

  const clearSelectedImage = useCallback(() => {
    setSelectedImage((previousImage) => {
      if (previousImage?.previewUrl) {
        URL.revokeObjectURL(previousImage.previewUrl);
      }
      return null;
    });
  }, []);

  const clearSelectedFile = useCallback(() => {
    setSelectedFile((previousFile) => {
      if (previousFile?.previewUrl) {
        URL.revokeObjectURL(previousFile.previewUrl);
      }
      return null;
    });
  }, []);

  const clearSelectedAudio = useCallback(() => {
    setSelectedAudio((previousAudio) => {
      if (previousAudio?.previewUrl) {
        URL.revokeObjectURL(previousAudio.previewUrl);
      }
      return null;
    });
  }, []);

  const clearAllComposerMedia = useCallback(() => {
    clearSelectedImage();
    clearSelectedFile();
    clearSelectedAudio();
  }, [clearSelectedAudio, clearSelectedFile, clearSelectedImage]);

  const processFileInput = useCallback(
    (file, mode = "auto") => {
      if (!file) return;

      const isImageAttachment = mode === "image" || file.type.startsWith("image/");
      const maxUploadBytes = isImageAttachment
        ? MAX_IMAGE_UPLOAD_BYTES
        : MAX_ATTACHMENT_UPLOAD_BYTES;
      if (file.size > maxUploadBytes) {
        const sizeLabel = formatFileSize(maxUploadBytes);
        toast.error(t("chatContainer.attachmentTooLarge", { size: sizeLabel }));
        return;
      }

      if (isImageAttachment) {
        if (mode === "image" && !file.type.startsWith("image/")) {
          toast.error(t("chatContainer.selectImageFile"));
          return;
        }
        clearSelectedImage();
        setSelectedImage({
          file,
          name: file.name || t("common.attachment.photo"),
          type: file.type || "image/*",
          size: Number(file.size || 0),
          previewUrl: URL.createObjectURL(file),
        });
        return;
      }

      const isVideoFile = String(file.type || "").startsWith("video/");
      clearSelectedFile();
      setSelectedFile({
        file,
        name: file.name || t("common.attachment.attachment"),
        type: file.type || "application/octet-stream",
        size: Number(file.size || 0),
        previewUrl: isVideoFile ? URL.createObjectURL(file) : "",
      });
    },
    [clearSelectedFile, clearSelectedImage, t]
  );

  const clearMentionSuggestions = useCallback(() => {
    setMentionRange(null);
    setMentionQuery("");
    setActiveMentionSuggestionIndex(0);
  }, []);

  const applyMentionSuggestion = useCallback(
    (suggestion) => {
      if (!suggestion || !mentionRange) return;

      const currentInputValue = String(input || "");
      const mentionStart = Number(mentionRange.start || 0);
      const mentionEnd = Number(mentionRange.end || 0);
      const replacement = `@${suggestion.handle} `;
      const nextInputValue = `${currentInputValue.slice(0, mentionStart)}${replacement}${currentInputValue.slice(
        mentionEnd
      )}`;
      const nextCursorPosition = mentionStart + replacement.length;

      setInput(nextInputValue);
      clearMentionSuggestions();
      requestAnimationFrame(() => {
        const composerInput = composerInputRef.current;
        if (!composerInput) return;
        composerInput.focus();
        composerInput.setSelectionRange(nextCursorPosition, nextCursorPosition);
      });
    },
    [clearMentionSuggestions, input, mentionRange]
  );

  const openThreadPanelForMessage = useCallback(
    async (message) => {
      const threadRootId = toNormalizedId(message?.threadRoot || message?._id);
      if (!threadRootId) return;

      setIsThreadPanelOpen(true);
      setThreadPanelLoading(true);
      setActiveThreadRootMessageId(threadRootId);
      const threadResult = await getThreadMessages(threadRootId);
      if (threadResult.success) {
        setThreadMessages(threadResult.messages || []);
      } else {
        setThreadMessages([]);
      }
      setThreadPanelLoading(false);
    },
    [getThreadMessages]
  );

  const closeThreadPanel = useCallback(() => {
    setIsThreadPanelOpen(false);
    setThreadPanelLoading(false);
    setActiveThreadRootMessageId("");
    setThreadMessages([]);
  }, []);

  const closeForwardModal = useCallback(() => {
    setIsForwardModalOpen(false);
    setForwardSourceMessage(null);
    setIsForwardingMessage(false);
  }, []);

  const closeReportModal = useCallback(() => {
    setIsReportModalOpen(false);
    setReportSourceMessage(null);
  }, []);

  const handleReplyInThread = useCallback(
    (threadMessage) => {
      if (!canInteractInSelectedConversation) return;
      const replyTargetMessage = threadMessage || threadRootMessage;
      if (!replyTargetMessage) return;

      setReplyTo(replyTargetMessage);
      setEditingMessageId(null);
      setIsThreadPanelOpen(false);
      requestAnimationFrame(() => {
        composerInputRef.current?.focus();
      });
    },
    [canInteractInSelectedConversation, setReplyTo, threadRootMessage]
  );

  const stopRecording = () => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current?.stop();
    }
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    setIsRecording(false);
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error(t("chatContainer.recordingUnsupported"));
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];
      setRecordingSeconds(0);
      recordingSecondsRef.current = 0;
      setIsRecording(true);
      audioStreamRef.current = stream;
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const capturedDuration = recordingSecondsRef.current;
        const audioBlob = new Blob(chunks, { type: "audio/webm" });
        clearSelectedAudio();
        setSelectedAudio({
          blob: audioBlob,
          fileName: `voice-note-${Date.now()}.webm`,
          type: "audio/webm",
          size: Number(audioBlob.size || 0),
          duration: Number(capturedDuration || 0),
          previewUrl: URL.createObjectURL(audioBlob),
        });
        setRecordingSeconds(0);
        recordingSecondsRef.current = 0;
      };

      mediaRecorder.start();
      recordingIntervalRef.current = setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds(recordingSecondsRef.current);
      }, 1000);
    } catch {
      toast.error(t("chatContainer.microphoneAccessError"));
    }
  };

  const scrollToBottom = useCallback(
    (behavior = "auto") => {
      if (!messages.length) return;
      virtuosoRef.current?.scrollToIndex({
        index: messages.length - 1,
        align: "end",
        behavior,
      });
    },
    [messages.length]
  );

  const uploadSelectedComposerMedia = useCallback(async () => {
    if (!selectedImage && !selectedFile && !selectedAudio) {
      return {};
    }

    const uploadedPayload = {};

    const updateProgress = (label, percent) => {
      setMediaUploadState({
        active: true,
        label,
        percent: Number.isFinite(percent) ? percent : 0,
      });
    };

    if (selectedImage?.file) {
      const progressLabel = t("chatContainer.uploadingImage");
      updateProgress(progressLabel, 0);
      const uploadedImage = await uploadFileToCloudinary({
        axiosInstance: axios,
        file: selectedImage.file,
        fileName: selectedImage.name,
        folder: "quickchat/images",
        resourceType: "image",
        onProgress: ({ percent }) => updateProgress(progressLabel, percent),
      });
      uploadedPayload.image = {
        url: uploadedImage.url,
        publicId: uploadedImage.publicId,
        resourceType: uploadedImage.resourceType || "image",
      };
    }

    if (selectedFile?.file) {
      const progressLabel = String(selectedFile.type || "").startsWith("video/")
        ? t("chatContainer.uploadingVideo")
        : t("chatContainer.uploadingFile");
      updateProgress(progressLabel, 0);
      const uploadedFile = await uploadFileToCloudinary({
        axiosInstance: axios,
        file: selectedFile.file,
        fileName: selectedFile.name,
        folder: "quickchat/files",
        resourceType: String(selectedFile.type || "").startsWith("video/")
          ? "video"
          : "auto",
        onProgress: ({ percent }) => updateProgress(progressLabel, percent),
      });
      uploadedPayload.file = {
        url: uploadedFile.url,
        name: selectedFile.name,
        type: selectedFile.type,
        size: selectedFile.size,
        publicId: uploadedFile.publicId,
        resourceType: uploadedFile.resourceType || "auto",
      };
    }

    if (selectedAudio?.blob) {
      const progressLabel = t("chatContainer.uploadingVoiceNote");
      updateProgress(progressLabel, 0);
      const uploadedAudio = await uploadFileToCloudinary({
        axiosInstance: axios,
        file: selectedAudio.blob,
        fileName: selectedAudio.fileName || `voice-note-${Date.now()}.webm`,
        folder: "quickchat/audio",
        resourceType: "auto",
        onProgress: ({ percent }) => updateProgress(progressLabel, percent),
      });
      uploadedPayload.audio = {
        url: uploadedAudio.url,
        duration: Number(selectedAudio.duration || 0),
        publicId: uploadedAudio.publicId,
        resourceType: uploadedAudio.resourceType || "auto",
      };
    }

    setMediaUploadState({ active: false, label: "", percent: 0 });
    return uploadedPayload;
  }, [axios, selectedAudio, selectedFile, selectedImage, t]);

  const handleSendMessage = async (event) => {
    event?.preventDefault?.();

    const trimmedInput = input.trim();
    if (isDirectConversationBlocked) {
      toast.error(
        isDirectConversationBlockedByMe
          ? t("chatContainer.blockedByMeSendError")
          : t("chatContainer.blockedByOtherSendError")
      );
      return;
    }
    if (
      !trimmedInput &&
      !selectedImage &&
      !selectedFile &&
      !selectedAudio &&
      !editingMessageId
    ) {
      return;
    }

    if (editingMessageId) {
      if (!trimmedInput) return;
      const didEdit = await editMessage(editingMessageId, trimmedInput);
      if (didEdit) {
        setEditingMessageId(null);
        setInput("");
      }
    } else {
      const normalizedSendAtIso = toIsoFromLocalDateTimeValue(scheduledSendAtInput);
      if (scheduledSendAtInput && !normalizedSendAtIso) {
        toast.error(t("chatContainer.scheduledInvalidTime"));
        return;
      }
      if (normalizedSendAtIso) {
        const scheduledTimestampMs = new Date(normalizedSendAtIso).getTime();
        if (
          !Number.isFinite(scheduledTimestampMs) ||
          scheduledTimestampMs - Date.now() <= SCHEDULE_IMMEDIATE_THRESHOLD_MS
        ) {
          toast.error(t("chatContainer.scheduledFutureOnly"));
          return;
        }
      }
      const parsedDisappearAfterMs = Number.parseInt(disappearAfterMsInput, 10);
      const normalizedDisappearAfterMs =
        Number.isFinite(parsedDisappearAfterMs) && parsedDisappearAfterMs > 0
          ? parsedDisappearAfterMs
          : null;

      let uploadedComposerMedia = {};
      try {
        uploadedComposerMedia = await uploadSelectedComposerMedia();
      } catch (error) {
        setMediaUploadState({ active: false, label: "", percent: 0 });
        toast.error(getErrorMessage(error, t("chatContainer.mediaUploadFailure")));
        return;
      }

      const didQueueMessage = await sendMessage({
        text: trimmedInput || undefined,
        image: uploadedComposerMedia.image || undefined,
        file: uploadedComposerMedia.file || undefined,
        audio: uploadedComposerMedia.audio || undefined,
        replyTo: replyTo?._id,
        threadRoot: toNormalizedId(replyTo?.threadRoot || replyTo?._id) || undefined,
        mentions: selectedMentionIds,
        sendAt: normalizedSendAtIso || undefined,
        disappearAfterMs: normalizedDisappearAfterMs ?? undefined,
      });
      if (!didQueueMessage) return;

      setInput("");
      clearAllComposerMedia();
      clearMentionSuggestions();
      setScheduledSendAtInput("");
      setDisappearAfterMsInput("");
      setIsSchedulePanelOpen(false);

      if (isThreadPanelOpen && activeThreadRootMessageId) {
        const threadResult = await getThreadMessages(activeThreadRootMessageId);
        if (threadResult.success) {
          setThreadMessages(threadResult.messages || []);
        }
      }
    }

    setReplyTo(null);
    setOpenTouchActionsMessageId("");
    setPendingBelowCount(0);
    skipNextAutoFollowRef.current = true;
    setIsNearBottom(true);
    scrollToBottom("smooth");

    if (typingRef.current && selectedConversation) {
      emitStopTyping(selectedConversation);
      typingRef.current = false;
    }
  };

  const handleSelectImage = (e) => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) {
      toast.error(t("chatContainer.selectImageFile"));
      return;
    }

    processFileInput(file, "image");
    e.target.value = "";
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);

    const cursorPosition = Number(e.target.selectionStart ?? value.length);
    const textBeforeCursor = value.slice(0, cursorPosition);
    const mentionMatch = textBeforeCursor.match(MENTION_TRIGGER_REGEX);
    if (mentionMatch) {
      const mentionQueryValue = String(mentionMatch[1] || "");
      const mentionStart = cursorPosition - mentionQueryValue.length - 1;
      setMentionRange({ start: mentionStart, end: cursorPosition });
      setMentionQuery(mentionQueryValue);
      setActiveMentionSuggestionIndex(0);
    } else {
      clearMentionSuggestions();
    }

    if (!selectedConversation) return;
    if (!value.trim()) {
      if (typingRef.current) {
        emitStopTyping(selectedConversation);
        typingRef.current = false;
      }
      clearTimeout(typingTimeoutRef.current);
      return;
    }

    if (!typingRef.current) {
      emitTyping(selectedConversation);
      typingRef.current = true;
    }

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      emitStopTyping(selectedConversation);
      typingRef.current = false;
    }, 1200);
  };

  const activeTypingParticipantNames = useMemo(() => {
    if (!selectedConversationId) return [];
    const typingInConversation = typingUsers[selectedConversationId] || {};
    const typingIds = Object.keys(typingInConversation).filter(
      (participantId) => participantId !== toNormalizedId(authUser?._id)
    );
    if (!typingIds.length) return [];

    const participantNameMap = new Map(
      (selectedConversation?.participants || []).map((participant) => [
        toNormalizedId(participant._id),
        participant.fullName || t("chat.someoneFallback"),
      ])
    );
    return typingIds.map(
      (participantId) => participantNameMap.get(participantId) || t("chat.someoneFallback")
    );
  }, [authUser?._id, selectedConversation?.participants, selectedConversationId, t, typingUsers]);

  const isSelectedConversationTyping = activeTypingParticipantNames.length > 0;

  const isMessageReadByCurrentUser = useCallback(
    (message) => {
      if (message?.seen) return true;
      return Array.isArray(message?.readBy)
        ? message.readBy.some(
            (readReceipt) =>
              toNormalizedId(readReceipt?.userId) === toNormalizedId(authUser?._id)
          )
        : false;
    },
    [authUser?._id]
  );

  const firstUnreadIndex = useMemo(
    () =>
      messages.findIndex((message) => {
        const senderId = toNormalizedId(message.senderId);
        return (
          senderId !== toNormalizedId(authUser?._id) &&
          !isMessageReadByCurrentUser(message) &&
          !message.isDeleted
        );
      }),
    [authUser?._id, isMessageReadByCurrentUser, messages]
  );

  const searchMatchIds = useMemo(
    () => searchMatches.map((message) => message._id),
    [searchMatches]
  );
  const messageIndexById = useMemo(() => {
    const indexById = new Map();
    messages.forEach((message, index) => {
      indexById.set(String(message._id), index);
    });
    return indexById;
  }, [messages]);
  const tailMessageKey = useMemo(() => {
    if (!messages.length) return "";
    const tailMessage = messages[messages.length - 1];
    return String(tailMessage?.clientId || tailMessage?._id || "");
  }, [messages]);

  useEffect(() => {
    messageIndexByIdRef.current = messageIndexById;
  }, [messageIndexById]);

  useEffect(() => {
    hasMoreMessagesRef.current = hasMoreMessages;
  }, [hasMoreMessages]);

  useEffect(() => {
    if (!selectedConversationId) return;

    const normalizedPendingConversationId = toNormalizedId(
      pendingConversationJumpTarget?.conversationId
    );
    const normalizedPendingMessageId = toNormalizedId(
      pendingConversationJumpTarget?.messageId
    );
    const hasPendingGlobalJump =
      normalizedPendingConversationId === selectedConversationId &&
      normalizedPendingMessageId;

    const loadSelectedConversationMessages = async () => {
      if (hasPendingGlobalJump) {
        setIsGlobalJumpFetchInProgress(true);
        setPendingGlobalJumpMessageId(normalizedPendingMessageId);
        clearPendingConversationJumpTarget(
          selectedConversationId,
          normalizedPendingMessageId
        );
        try {
          await getMessages(selectedConversationId, {
            aroundMessageId: normalizedPendingMessageId,
            force: true,
          });
        } finally {
          setIsGlobalJumpFetchInProgress(false);
        }
        return;
      }

      setIsGlobalJumpFetchInProgress(false);
      setPendingGlobalJumpMessageId("");
      await getMessages(selectedConversationId);
    };

    void loadSelectedConversationMessages();
    setShowSearch(false);
    setSearchQuery("");
    setSearchMatches([]);
    setActiveSearchMatchIndex(0);
    setPendingBelowCount(0);
    setIsNearBottom(true);
    previousMessageCountRef.current = 0;
    previousTailMessageIdRef.current = null;
    lastAutoFollowKeyRef.current = "";
    skipNextAutoFollowRef.current = false;
    setOpenMessageMenuId(null);
    setOpenReactionPickerId(null);
    setOpenTouchActionsMessageId("");
    setShowComposerEmoji(false);
    setIsSchedulePanelOpen(false);
    setScheduledSendAtInput("");
    setDisappearAfterMsInput("");
    setIsMobileDetailsOpen(false);
    closeThreadPanel();
    closeForwardModal();
    closeReportModal();
    clearMentionSuggestions();
  }, [
    clearPendingConversationJumpTarget,
    clearMentionSuggestions,
    closeForwardModal,
    closeReportModal,
    closeThreadPanel,
    getMessages,
    pendingConversationJumpTarget?.conversationId,
    pendingConversationJumpTarget?.messageId,
    selectedConversationId,
  ]);

  useEffect(() => {
    if (!selectedConversationId || !isNearBottom || !tailMessageKey) return;
    const autoFollowKey = `${selectedConversationId}:${tailMessageKey}`;
    if (skipNextAutoFollowRef.current) {
      skipNextAutoFollowRef.current = false;
      lastAutoFollowKeyRef.current = autoFollowKey;
      return;
    }
    if (lastAutoFollowKeyRef.current === autoFollowKey) return;
    lastAutoFollowKeyRef.current = autoFollowKey;
    // Keep the viewport pinned without animation to avoid near-bottom bounce loops.
    scrollToBottom("auto");
  }, [
    isNearBottom,
    selectedConversationId,
    tailMessageKey,
    scrollToBottom,
  ]);

  useEffect(() => {
    if (!selectedConversation || !isDirectConversationBlocked) return;
    if (typingRef.current) {
      emitStopTyping(selectedConversation);
      typingRef.current = false;
    }
  }, [emitStopTyping, isDirectConversationBlocked, selectedConversation]);

  useEffect(() => {
    if (!messages.length) {
      previousMessageCountRef.current = 0;
      previousTailMessageIdRef.current = null;
      return;
    }

    const previousCount = previousMessageCountRef.current;
    const previousTailMessageId = previousTailMessageIdRef.current;
    const currentTailMessage = messages[messages.length - 1];
    const currentTailMessageId = String(
      currentTailMessage?._id || currentTailMessage?.clientId || ""
    );
    const appendedCount =
      messages.length > previousCount && currentTailMessageId !== previousTailMessageId
        ? messages.length - previousCount
        : 0;

    if (appendedCount > 0 && !isNearBottom) {
      const newlyArrived = messages.slice(-appendedCount);
      const incomingCount = newlyArrived.filter(
        (message) =>
          String(message.senderId?._id || message.senderId || "") !==
          String(authUser?._id || "")
      ).length;
      if (incomingCount > 0) {
        setPendingBelowCount((prev) => prev + incomingCount);
      }
    }

    previousMessageCountRef.current = messages.length;
    previousTailMessageIdRef.current = currentTailMessageId;
  }, [authUser?._id, messages, isNearBottom]);

  useEffect(
    () => () => {
      clearTimeout(typingTimeoutRef.current);
      clearInterval(recordingIntervalRef.current);
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      clearTimeout(searchTimeoutRef.current);
    },
    []
  );

  useEffect(() => {
    const selectedImagePreviewUrl = selectedImage?.previewUrl;
    const selectedFilePreviewUrl = selectedFile?.previewUrl;
    const selectedAudioPreviewUrl = selectedAudio?.previewUrl;
    return () => {
      if (selectedImagePreviewUrl) {
        URL.revokeObjectURL(selectedImagePreviewUrl);
      }
      if (selectedFilePreviewUrl) {
        URL.revokeObjectURL(selectedFilePreviewUrl);
      }
      if (selectedAudioPreviewUrl) {
        URL.revokeObjectURL(selectedAudioPreviewUrl);
      }
    };
  }, [selectedAudio?.previewUrl, selectedFile?.previewUrl, selectedImage?.previewUrl]);

  useEffect(() => {
    if (!showComposerEmoji) return;

    const handleOutsideClick = (event) => {
      if (
        composerEmojiRef.current &&
        !composerEmojiRef.current.contains(event.target) &&
        !composerEmojiTriggerRef.current?.contains(event.target)
      ) {
        setShowComposerEmoji(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setShowComposerEmoji(false);
        composerEmojiTriggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showComposerEmoji]);

  useEffect(() => {
    if (!openTouchActionsMessageId) return;

    const handleOutsideTouchActions = (event) => {
      if (
        typeof window === "undefined" ||
        !window.matchMedia("(hover: none), (pointer: coarse)").matches
      ) {
        return;
      }
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".message-content")) return;
      handleCloseTouchActions();
    };

    document.addEventListener("pointerdown", handleOutsideTouchActions);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideTouchActions);
    };
  }, [handleCloseTouchActions, openTouchActionsMessageId]);

  useEffect(() => {
    if (!selectedConversation?._id || !searchQuery.trim()) {
      setSearchMatches([]);
      setActiveSearchMatchIndex(0);
      return;
    }

    clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(async () => {
      const matches = await searchMessages(selectedConversation._id, searchQuery);
      setSearchMatches(matches);
      setActiveSearchMatchIndex(0);
    }, 260);

    return () => clearTimeout(searchTimeoutRef.current);
  }, [searchMessages, searchQuery, selectedConversation?._id]);

  const ensureMessageLoaded = useCallback(
    async (messageId) => {
      const normalizedMessageId = String(messageId || "");
      if (!normalizedMessageId) return -1;

      const existingIndex = messageIndexByIdRef.current.get(normalizedMessageId);
      if (typeof existingIndex === "number") {
        return existingIndex;
      }

      let attempts = 0;
      while (hasMoreMessagesRef.current && attempts < 50) {
        const didLoadOlder = await loadOlderMessages();
        attempts += 1;

        const loadedIndex = messageIndexByIdRef.current.get(normalizedMessageId);
        if (typeof loadedIndex === "number") {
          return loadedIndex;
        }
        if (!didLoadOlder) break;
      }

      return -1;
    },
    [loadOlderMessages]
  );

  useEffect(() => {
    if (!searchMatchIds.length) return;
    let isCancelled = false;

    const scrollToActiveSearchMatch = async () => {
      const activeId = searchMatchIds[activeSearchMatchIndex];
      const targetIndex = await ensureMessageLoaded(activeId);
      if (isCancelled || targetIndex < 0) return;

      virtuosoRef.current?.scrollToIndex({
        index: targetIndex,
        align: "center",
        behavior: "smooth",
      });
    };

    void scrollToActiveSearchMatch();
    return () => {
      isCancelled = true;
    };
  }, [activeSearchMatchIndex, ensureMessageLoaded, searchMatchIds]);

  // Stable handlers passed to the memoized MessageList. Keeping their identity
  // constant lets MessageRow's React.memo skip re-rendering untouched messages.
  const handleReact = useCallback(
    (messageId, emoji) => {
      if (!canInteractInSelectedConversation) return;
      reactToMessage(messageId, emoji);
      setOpenReactionPickerId(null);
      setOpenMessageMenuId(null);
    },
    [canInteractInSelectedConversation, reactToMessage]
  );

  const handleReply = useCallback(
    (message) => {
      if (!canInteractInSelectedConversation) return;
      setReplyTo(message);
      setEditingMessageId(null);
    },
    [canInteractInSelectedConversation, setReplyTo]
  );

  const handleStartEdit = useCallback(
    (message) => {
      if (!canInteractInSelectedConversation) return;
      setEditingMessageId(message._id);
      setInput(message.text || "");
      setReplyTo(null);
      setIsSchedulePanelOpen(false);
    },
    [canInteractInSelectedConversation, setReplyTo]
  );

  const handleDelete = useCallback(
    (messageId) => {
      if (!canInteractInSelectedConversation) return;
      deleteMessage(messageId);
    },
    [canInteractInSelectedConversation, deleteMessage]
  );

  const handleToggleStar = useCallback(
    (message) => {
      if (!canInteractInSelectedConversation) return;
      const messageId = toNormalizedId(message?._id);
      if (!messageId) return;
      void toggleStarMessage(messageId);
      setOpenMessageMenuId(null);
      setOpenReactionPickerId(null);
    },
    [canInteractInSelectedConversation, toggleStarMessage]
  );

  const handleOpenForward = useCallback((message) => {
    if (!canInteractInSelectedConversation) return;
    if (!toNormalizedId(message?._id)) return;
    setForwardSourceMessage(message);
    setIsForwardModalOpen(true);
    setOpenMessageMenuId(null);
    setOpenReactionPickerId(null);
  }, [canInteractInSelectedConversation]);

  const handleOpenReport = useCallback((message) => {
    if (!toNormalizedId(message?._id)) return;
    setReportSourceMessage(message);
    setIsReportModalOpen(true);
    setOpenMessageMenuId(null);
    setOpenReactionPickerId(null);
  }, []);

  const handleForwardSubmit = useCallback(
    async ({ targetIds }) => {
      if (!forwardSourceMessageId || !Array.isArray(targetIds) || !targetIds.length) {
        return false;
      }

      setIsForwardingMessage(true);
      const forwardResult = await forwardMessage(forwardSourceMessageId, targetIds);
      setIsForwardingMessage(false);
      if (forwardResult.success) {
        closeForwardModal();
      }
      return Boolean(forwardResult.success);
    },
    [closeForwardModal, forwardMessage, forwardSourceMessageId]
  );

  const handleReportSubmit = useCallback(
    async ({ reason, details }) => {
      if (!reportSourceMessageId) return false;
      return reportMessage(reportSourceMessageId, { reason, details });
    },
    [reportMessage, reportSourceMessageId]
  );

  const handleRetry = useCallback(
    (clientId) => {
      if (!clientId) return;
      retryMessage(clientId);
      setOpenMessageMenuId(null);
      setOpenReactionPickerId(null);
    },
    [retryMessage]
  );

  const handleDiscard = useCallback(
    (clientId) => {
      if (!clientId) return;
      discardFailedMessage(clientId);
      setOpenMessageMenuId(null);
      setOpenReactionPickerId(null);
    },
    [discardFailedMessage]
  );

  const handleOpenMenuChange = useCallback((messageId, open) => {
    setOpenMessageMenuId(open ? messageId : null);
    if (open) setOpenReactionPickerId(null);
  }, []);

  const handleOpenReactionChange = useCallback((messageId, open) => {
    setOpenReactionPickerId(open ? messageId : null);
    if (open) setOpenMessageMenuId(null);
  }, []);

  const handleStartReached = useCallback(() => {
    if (messagesLoading || loadingOlderMessages || !hasMoreMessages) return;
    void loadOlderMessages();
  }, [hasMoreMessages, loadOlderMessages, loadingOlderMessages, messagesLoading]);

  const handleAtBottomStateChange = useCallback((atBottom) => {
    const nearBottom = Boolean(atBottom);
    setIsNearBottom((previousNearBottom) =>
      previousNearBottom === nearBottom ? previousNearBottom : nearBottom
    );
    if (nearBottom) {
      setPendingBelowCount((previousCount) => (previousCount === 0 ? previousCount : 0));
    }
  }, []);

  const handleJumpToMessage = useCallback(
    async (messageId) => {
      const targetIndex = await ensureMessageLoaded(messageId);
      if (targetIndex < 0) return;

      virtuosoRef.current?.scrollToIndex({
        index: targetIndex,
        align: "center",
        behavior: "smooth",
      });
    },
    [ensureMessageLoaded]
  );

  useEffect(() => {
    const normalizedPendingMessageId = String(pendingGlobalJumpMessageId || "");
    if (!normalizedPendingMessageId) return;
    if (isGlobalJumpFetchInProgress || messagesLoading) return;

    let isCancelled = false;
    const jumpToPendingMessage = async () => {
      await handleJumpToMessage(normalizedPendingMessageId);
      if (!isCancelled) {
        setPendingGlobalJumpMessageId("");
      }
    };

    void jumpToPendingMessage();
    return () => {
      isCancelled = true;
    };
  }, [
    handleJumpToMessage,
    isGlobalJumpFetchInProgress,
    messagesLoading,
    pendingGlobalJumpMessageId,
  ]);

  const activeSearchMatchId = searchMatchIds[activeSearchMatchIndex];
  const typingIndicator = !messagesLoading && isSelectedConversationTyping && (
    <div className={`flex mb-4 animate-fade-in px-1 ${isRtl ? "justify-end" : "justify-start"}`}>
      <div
        className={`px-3 py-2.5 rounded-2xl bg-white/8 border border-white/16 backdrop-blur-sm flex items-center gap-1.5 ${
          isRtl ? "rounded-br-sm" : "rounded-bl-sm"
        }`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-typing-bounce" />
        <span
          className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-typing-bounce"
          style={{ animationDelay: "120ms" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-typing-bounce"
          style={{ animationDelay: "240ms" }}
        />
        {activeTypingParticipantNames.length > 0 && (
          <span className={`${isRtl ? "mr-1.5" : "ml-1.5"} text-[11px] text-white/65`}>
            {activeTypingParticipantNames.length === 1
              ? t("chatContainer.typingSingle", {
                  name: activeTypingParticipantNames[0],
                })
              : t("chatContainer.typingMultiple", {
                  count: activeTypingParticipantNames.length,
                })}
          </span>
        )}
      </div>
    </div>
  );
  const threadMessagesForRender = useMemo(
    () =>
      [...threadMessages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    [threadMessages]
  );

  return selectedConversation ? (
    <div className="h-full min-h-0 flex flex-col bg-[linear-gradient(180deg,rgba(20,17,32,0.32),rgba(15,13,24,0.82))] relative">
      <div className="shrink-0 z-30 px-4 py-3 border-b border-white/10 glass-subtle">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={selectedConversationAvatar || assets.avatar_icon}
              alt={`${selectedConversationTitle} profile`}
              decoding="async"
              width="40"
              height="40"
              className="w-10 h-10 rounded-full object-cover border border-white/20"
            />
            {isDirectSelectedConversation && isDirectPeerOnline && (
              <>
                <span
                  className={`absolute -bottom-0.5 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-900 ${
                    isRtl ? "-left-0.5" : "-right-0.5"
                  }`}
                />
                <span
                  className={`absolute -bottom-0.5 h-3.5 w-3.5 rounded-full bg-success/80 animate-pulse-ring ${
                    isRtl ? "-left-0.5" : "-right-0.5"
                  }`}
                />
              </>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-medium text-white truncate">
              {selectedConversationTitle}
            </p>
            <p className="text-xs text-white/60 mt-0.5">
              {isDirectSelectedConversation
                ? isDirectPeerOnline
                  ? t("chatContainer.activeNow")
                  : formatLastSeen(selectedConversation?.peer?.lastSeen)
                : t("chatContainer.membersCount", {
                    count: Math.max((selectedConversation?.participants || []).length - 1, 0),
                  })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedConversation(null)}
            className="md:hidden icon-btn h-9 w-9"
            aria-label={t("chatContainer.backToConversationListAria")}
          >
            <img
              src={assets.arrow_icon}
              alt={t("chatContainer.backToConversationListAria")}
              className={`w-6 ${isRtl ? "rotate-180" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowSearch((prev) => !prev);
              setOpenMessageMenuId(null);
              setOpenReactionPickerId(null);
            }}
            className="icon-btn h-9 w-9"
            aria-label={t("chatContainer.toggleSearchAria")}
            aria-pressed={showSearch}
          >
            <img src={assets.search_icon} alt="" className="w-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsMobileDetailsOpen(true)}
            className="md:hidden icon-btn h-9 w-9"
            aria-label={t("chatContainer.openConversationDetailsAria")}
          >
            <img src={assets.help_icon} alt="" className="w-4" />
          </button>
        </div>
        {showSearch && (
          <div className="mt-3 flex items-center gap-2 animate-fade-in">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("chatContainer.searchPlaceholder")}
              className="flex-1 rounded-xl bg-white/8 border border-white/15 px-3 py-2 text-sm text-white placeholder:text-white/45"
              aria-label={t("chatContainer.searchPlaceholder")}
            />
            <button
              type="button"
              disabled={!searchMatchIds.length}
              onClick={() =>
                setActiveSearchMatchIndex((prev) =>
                  searchMatchIds.length
                    ? (prev - 1 + searchMatchIds.length) % searchMatchIds.length
                    : 0
                )
              }
              className="h-9 w-9 rounded-lg border border-white/15 bg-white/8 disabled:opacity-40"
              aria-label={t("chatContainer.previousSearchResultAria")}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={!searchMatchIds.length}
              onClick={() =>
                setActiveSearchMatchIndex((prev) =>
                  searchMatchIds.length ? (prev + 1) % searchMatchIds.length : 0
                )
              }
              className="h-9 w-9 rounded-lg border border-white/15 bg-white/8 disabled:opacity-40"
              aria-label={t("chatContainer.nextSearchResultAria")}
            >
              ↓
            </button>
            <span
              className={`text-xs text-white/55 min-w-16 ${
                isRtl ? "text-left" : "text-right"
              }`}
            >
              {searchMatchIds.length
                ? `${activeSearchMatchIndex + 1}/${searchMatchIds.length}`
                : t("chatContainer.searchResultsFallback")}
            </span>
            <button
              type="button"
              onClick={() => {
                setShowSearch(false);
                setSearchQuery("");
              }}
              className="h-9 w-9 rounded-lg border border-white/15 bg-white/8"
              aria-label={t("chatContainer.closeSearchAria")}
            >
              ×
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 px-4 py-4">
        {messagesLoading && (
          <div className="space-y-3 pt-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <div
                key={index}
                className={`flex ${index % 2 === 0 ? "justify-end" : "justify-start"}`}
              >
                <div className="h-12 w-[60%] max-w-[280px] skeleton rounded-2xl" />
              </div>
            ))}
          </div>
        )}

        {!messagesLoading && messages.length > 0 && (
          <MessageList
            virtuosoRef={virtuosoRef}
            messages={messages}
            authUserId={authUser._id}
            conversationType={selectedConversation?.type}
            isDirectBlocked={isDirectConversationBlocked}
            participants={selectedConversation?.participants || []}
            firstUnreadIndex={firstUnreadIndex}
            searchMatchIds={searchMatchIds}
            activeSearchMatchId={activeSearchMatchId}
            searchQuery={searchQuery}
            openMessageMenuId={openMessageMenuId}
            openReactionPickerId={openReactionPickerId}
            openTouchActionsMessageId={openTouchActionsMessageId}
            messageElementRefs={messageElementRefs}
            onReact={handleReact}
            onReply={handleReply}
            onStartEdit={handleStartEdit}
            onDelete={handleDelete}
            onToggleStar={handleToggleStar}
            onForward={handleOpenForward}
            onReport={handleOpenReport}
            onRetry={handleRetry}
            onDiscard={handleDiscard}
            onJumpToMessage={handleJumpToMessage}
            onOpenThread={openThreadPanelForMessage}
            onOpenMenuChange={handleOpenMenuChange}
            onOpenReactionChange={handleOpenReactionChange}
            onToggleTouchActions={handleToggleTouchActions}
            onOpenLightbox={onOpenLightbox}
            onStartReached={handleStartReached}
            onAtBottomStateChange={handleAtBottomStateChange}
            footer={typingIndicator}
            ariaLabel={t("chatContainer.messagesAria", { title: selectedConversationTitle })}
          />
        )}

        {!messagesLoading && messages.length === 0 && !isSelectedConversationTyping && (
          <div className="h-full min-h-60 flex flex-col items-center justify-center text-center text-white/55 overflow-y-auto">
            <img src={assets.logo_icon} alt="" className="w-12 opacity-80 mb-3" />
            <p className="text-white/85 font-medium">{t("chatContainer.overlayNoMessagesTitle")}</p>
            <p className="text-sm mt-1">
              {t("chatContainer.overlayNoMessagesSubtitle")}
            </p>
          </div>
        )}

        {!messagesLoading && messages.length === 0 && isSelectedConversationTyping && (
          <div className="h-full overflow-y-auto flex items-end">{typingIndicator}</div>
        )}
      </div>

      {!isNearBottom && (
        <button
          type="button"
          onClick={() => {
            skipNextAutoFollowRef.current = true;
            setIsNearBottom(true);
            setPendingBelowCount(0);
            scrollToBottom("smooth");
          }}
          className={`absolute bottom-[calc(7rem+env(safe-area-inset-bottom))] z-30 px-3 py-2 rounded-full btn-gradient text-xs font-medium shadow-soft ${
            isRtl ? "left-4 sm:left-6" : "right-4 sm:right-6"
          }`}
        >
          {pendingBelowCount > 0
            ? t("chatContainer.newMessagesPrefix", { count: pendingBelowCount })
            : ""}
          {t("chatContainer.scrollToLatest")}
        </button>
      )}

      <div className="shrink-0 z-40 px-4 pb-4 pt-3 border-t border-white/10 bg-[linear-gradient(180deg,rgba(13,12,20,0.1),rgba(12,10,18,0.92))] backdrop-blur-xl">
        {(replyTo || editingMessageId) && (
          <div className="mb-2.5 rounded-xl px-3 py-2 bg-white/8 border border-white/14 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-white/55">
                {editingMessageId
                  ? t("chatContainer.editingMessage")
                  : t("chatContainer.replyingTo")}
              </p>
              <p className="text-xs text-white/80 truncate">
                {editingMessageId
                  ? t("chatContainer.editingMessageHint")
                  : isMessagePendingRelease(replyTo)
                    ? t("common.attachment.scheduledMessage")
                    : stripMarkdownForPreview(replyTo?.text, 180) ||
                    (replyTo?.image
                      ? t("common.attachment.photo")
                      : replyTo?.audio?.url
                        ? t("common.attachment.voiceNote")
                        : replyTo?.file?.type?.startsWith("video/")
                          ? t("common.attachment.video")
                        : replyTo?.file?.name || t("conversations.conversation"))}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setReplyTo(null);
                setEditingMessageId(null);
              }}
              className="text-xs text-white/60 hover:text-white"
            >
              {t("chatContainer.cancelReplyOrEdit")}
            </button>
          </div>
        )}

        {isDirectConversationBlocked && (
          <div className="mb-2.5 rounded-xl border border-amber-300/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100">
            {isDirectConversationBlockedByMe
              ? t("chatContainer.blockedByMeComposerHint")
              : isDirectConversationBlockedByOther
                ? t("chatContainer.blockedByOtherComposerHint")
                : t("chatContainer.blockedGenericComposerHint")}
          </div>
        )}

        {selectedImage && (
          <div className="mb-2.5 inline-flex items-center gap-2 rounded-xl px-2.5 py-2 bg-white/8 border border-white/14">
            <img
              src={selectedImage.previewUrl}
              alt="preview"
              className="h-12 w-12 rounded-lg object-cover"
            />
            <p className="text-xs text-white/70">{t("chatContainer.imageReady")}</p>
            <button
              type="button"
              onClick={clearSelectedImage}
              className="text-xs text-white/60 hover:text-white"
            >
              {t("chatContainer.remove")}
            </button>
          </div>
        )}

        {selectedFile && (
          <div className="mb-2.5 inline-flex items-center gap-2 rounded-xl px-2.5 py-2 bg-white/8 border border-white/14">
            {selectedFile.previewUrl ? (
              <video
                src={selectedFile.previewUrl}
                className="h-12 w-12 rounded-lg object-cover bg-black/40"
                muted
                playsInline
              />
            ) : null}
            <div>
              <p className="text-xs text-white/80 max-w-56 truncate">
                {selectedFile.name}
              </p>
              <p className="text-[11px] text-white/55">{formatFileSize(selectedFile.size)}</p>
            </div>
            <button
              type="button"
              onClick={clearSelectedFile}
              className="text-xs text-white/60 hover:text-white"
            >
              {t("chatContainer.remove")}
            </button>
          </div>
        )}

        {selectedAudio && (
          <div className="mb-2.5 inline-flex items-center gap-2 rounded-xl px-2.5 py-2 bg-white/8 border border-white/14">
            <audio src={selectedAudio.previewUrl} controls className="h-8" />
            <button
              type="button"
              onClick={clearSelectedAudio}
              className="text-xs text-white/60 hover:text-white"
            >
              {t("chatContainer.remove")}
            </button>
          </div>
        )}

        {mediaUploadState.active && (
          <div className="mb-2.5 rounded-xl px-3 py-2 bg-brand-400/10 border border-brand-300/20">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-brand-100">
                {mediaUploadState.label || t("chatContainer.uploadingFallback")}
              </p>
              <p className="text-xs text-brand-100/80">{mediaUploadState.percent}%</p>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-300 to-brand-500 transition-[width] duration-150"
                style={{ width: `${mediaUploadState.percent}%` }}
              />
            </div>
          </div>
        )}

        {isRecording && (
          <div className="mb-2.5 inline-flex items-center gap-2 rounded-xl px-2.5 py-2 bg-rose-500/15 border border-rose-300/20">
            <span className="h-2 w-2 rounded-full bg-rose-300 animate-pulse" />
            <p className="text-xs text-rose-100">
              {t("chatContainer.recordingLabel", { seconds: recordingSeconds })}
            </p>
            <button
              type="button"
              onClick={stopRecording}
              className="text-xs text-rose-100/80 hover:text-rose-100"
            >
              {t("chatContainer.recordingStop")}
            </button>
          </div>
        )}

        {(scheduledSendAtInput || disappearAfterMsInput) && !isSchedulePanelOpen && (
          <div className="mb-2.5 flex flex-wrap items-center gap-2 text-[11px] text-white/70">
            {scheduledSendAtInput && (
              <span className="rounded-full border border-amber-200/35 bg-amber-500/20 px-2 py-1 text-amber-100">
                {t("chatContainer.scheduleBadge")}
              </span>
            )}
            {disappearAfterMsInput && (
              <span className="rounded-full border border-sky-200/35 bg-sky-500/20 px-2 py-1 text-sky-100">
                {t("chatContainer.disappearingBadge")}
              </span>
            )}
          </div>
        )}

        {isSchedulePanelOpen && (
          <div
            className="mb-2.5 rounded-xl border border-white/14 bg-white/6 px-3 py-2.5"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setIsSchedulePanelOpen(false);
                composerInputRef.current?.focus();
                return;
              }
              if (event.key === "Enter") {
                event.stopPropagation();
              }
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="text-xs text-white/70">
                <span className="block mb-1">{t("chatContainer.scheduleSendAtLabel")}</span>
                <input
                  type="datetime-local"
                  min={toLocalDateTimeInputValue(Date.now() + 60 * 1000)}
                  value={scheduledSendAtInput}
                  onChange={(event) => setScheduledSendAtInput(event.target.value)}
                  className="w-full rounded-lg bg-white/8 border border-white/14 px-2.5 py-2 text-xs text-white"
                  aria-label={t("chatContainer.scheduleSendAtLabel")}
                />
              </label>

              <label className="text-xs text-white/70">
                <span className="block mb-1">{t("chatContainer.scheduleDisappearAfterLabel")}</span>
                <select
                  value={disappearAfterMsInput}
                  onChange={(event) => setDisappearAfterMsInput(event.target.value)}
                  className="w-full rounded-lg bg-white/8 border border-white/14 px-2.5 py-2 text-xs text-white"
                  aria-label={t("chatContainer.scheduleDisappearAfterLabel")}
                >
                  {DISAPPEAR_PRESET_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value} className="bg-surface-900">
                      {option.value ? option.label : t("common.off")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-white/60">
              <span>{t("chatContainer.schedulePanelHint")}</span>
              <button
                type="button"
                onClick={() => {
                  setScheduledSendAtInput("");
                  setDisappearAfterMsInput("");
                }}
                className="rounded-md border border-white/18 px-2 py-1 text-white/70 hover:text-white"
              >
                {t("chatContainer.scheduleClear")}
              </button>
            </div>
          </div>
        )}

        <div className="relative flex items-center gap-2.5">
          <div
            onDragOver={(event) => {
              if (isDirectConversationBlocked) return;
              event.preventDefault();
            }}
            onDrop={(event) => {
              if (isDirectConversationBlocked) return;
              event.preventDefault();
              const droppedFile = event.dataTransfer.files?.[0];
              if (droppedFile) {
                processFileInput(droppedFile);
              }
            }}
            className="field-shell flex-1 flex items-center px-3.5"
          >
            <label
              htmlFor="image"
              className={`shrink-0 ${
                isDirectConversationBlocked ? "cursor-not-allowed opacity-40" : "cursor-pointer"
              }`}
              aria-label={t("chatContainer.uploadImageLabel")}
            >
              <img
                src={assets.gallery_icon}
                alt={t("chatContainer.uploadImageLabel")}
                className="w-5 cursor-pointer opacity-80 hover:opacity-100"
              />
            </label>
            <input
              onChange={handleSelectImage}
              type="file"
              id="image"
              accept="image/png, image/jpeg"
              disabled={isDirectConversationBlocked}
              hidden
            />
            <label
              htmlFor="file-attachment"
              className={`shrink-0 text-white/70 text-sm ${
                isDirectConversationBlocked ? "cursor-not-allowed opacity-40" : "cursor-pointer"
              } ${isRtl ? "mr-2" : "ml-2"}`}
              aria-label={t("chatContainer.uploadFileLabel")}
            >
              📎
            </label>
            <input
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                processFileInput(file, "file");
                event.target.value = "";
              }}
              type="file"
              id="file-attachment"
              disabled={isDirectConversationBlocked}
              hidden
            />
            <button
              type="button"
              ref={composerEmojiTriggerRef}
              onClick={() =>
                setShowComposerEmoji((prev) => {
                  const nextValue = !prev;
                  if (nextValue) {
                    setOpenMessageMenuId(null);
                    setOpenReactionPickerId(null);
                  }
                  return nextValue;
                })
              }
              disabled={isDirectConversationBlocked}
              className={`shrink-0 text-white/75 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed ${
                isRtl ? "mr-2" : "ml-2"
              }`}
              aria-label={t("chatContainer.openEmojiPickerAria")}
              aria-expanded={showComposerEmoji}
            >
              🙂
            </button>
            <button
              type="button"
              onClick={() => {
                if (editingMessageId) return;
                setIsSchedulePanelOpen((previousOpen) => !previousOpen);
                setShowComposerEmoji(false);
                setOpenMessageMenuId(null);
                setOpenReactionPickerId(null);
              }}
              disabled={Boolean(editingMessageId) || isDirectConversationBlocked}
              className={`shrink-0 text-sm ${
                isSchedulePanelOpen || scheduledSendAtInput || disappearAfterMsInput
                  ? "text-amber-100"
                  : "text-white/75 hover:text-white"
              } ${isRtl ? "mr-2" : "ml-2"} disabled:opacity-40 disabled:cursor-not-allowed`}
              aria-label={t("chatContainer.scheduleOptionsAria")}
              aria-expanded={isSchedulePanelOpen}
            >
              ⏱
            </button>
            <button
              type="button"
              onClick={() => {
                if (isRecording) {
                  stopRecording();
                } else {
                  startRecording();
                }
              }}
              disabled={isDirectConversationBlocked && !isRecording}
              className={`shrink-0 text-sm ${
                isRecording ? "text-rose-300" : "text-white/75 hover:text-white"
              } ${isRtl ? "mr-2" : "ml-2"} disabled:opacity-40 disabled:cursor-not-allowed`}
              aria-label={
                isRecording
                  ? t("chatContainer.stopRecordingAria")
                  : t("chatContainer.startRecordingAria")
              }
            >
              🎤
            </button>
            <input
              ref={composerInputRef}
              onChange={handleInputChange}
              value={input}
              onPaste={(event) => {
                if (isDirectConversationBlocked) return;
                const pastedFile = event.clipboardData.files?.[0];
                if (pastedFile) {
                  processFileInput(pastedFile);
                }
              }}
              onKeyDown={(event) => {
                if (mentionSuggestions.length > 0 && mentionRange) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveMentionSuggestionIndex((previousIndex) =>
                      previousIndex >= mentionSuggestions.length - 1
                        ? 0
                        : previousIndex + 1
                    );
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveMentionSuggestionIndex((previousIndex) =>
                      previousIndex <= 0
                        ? mentionSuggestions.length - 1
                        : previousIndex - 1
                    );
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    const selectedSuggestion =
                      mentionSuggestions[activeMentionSuggestionIndex] ||
                      mentionSuggestions[0];
                    applyMentionSuggestion(selectedSuggestion);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    clearMentionSuggestions();
                    return;
                  }
                }

                if (event.key === "Escape" && isSchedulePanelOpen) {
                  event.preventDefault();
                  setIsSchedulePanelOpen(false);
                  return;
                }

                const isSendShortcut =
                  event.key === "Enter" &&
                  ((event.metaKey || event.ctrlKey) || !event.shiftKey);
                if (isSendShortcut) {
                  if (isDirectConversationBlocked) return;
                  handleSendMessage(event);
                }
              }}
              type="text"
              placeholder={
                isDirectConversationBlocked
                  ? t("chatContainer.composerBlockedPlaceholder")
                  : t("chatContainer.composerPlaceholder")
              }
              disabled={isDirectConversationBlocked}
              className="flex-1 text-sm p-3.5 rounded-lg field-input"
              aria-label={t("chatContainer.composerAria")}
            />
          </div>
          {mentionRange && mentionSuggestions.length > 0 && (
            <div
              className={`absolute bottom-[calc(100%+0.6rem)] left-4 right-4 z-50 rounded-2xl border border-white/16 bg-[linear-gradient(180deg,rgba(28,24,44,0.98),rgba(17,14,28,0.98))] shadow-soft overflow-hidden ${
                isRtl ? "sm:left-[5.4rem] sm:right-4" : "sm:right-[5.4rem]"
              }`}
            >
              <div className="max-h-64 overflow-y-auto p-1.5 space-y-1">
                {mentionSuggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onClick={() => applyMentionSuggestion(suggestion)}
                    className={`w-full text-start rounded-xl px-2.5 py-2 flex items-center gap-2.5 border transition ${
                      index === activeMentionSuggestionIndex
                        ? "border-brand-200/45 bg-brand-500/20"
                        : "border-transparent hover:border-white/15 hover:bg-white/8"
                    }`}
                  >
                    <img
                      src={suggestion.profilePic || assets.avatar_icon}
                      alt={`${suggestion.fullName} profile`}
                      className="h-8 w-8 rounded-full object-cover border border-white/16"
                    />
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{suggestion.fullName}</p>
                      <p className="text-xs text-brand-100/80 truncate">@{suggestion.handle}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {showComposerEmoji && (
            <div
              ref={composerEmojiRef}
              className={`fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-50 ${
                isRtl ? "left-4 sm:left-8" : "right-4 sm:right-8"
              }`}
            >
              <Suspense
                fallback={
                  <div className="h-80 w-[280px] rounded-xl glass-panel border border-white/15 flex items-center justify-center text-xs text-white/70">
                    {t("chatContainer.emojiPickerLoading")}
                  </div>
                }
              >
                <EmojiPicker
                  lazyLoadEmojis
                  width={280}
                  height={340}
                  searchDisabled={false}
                  onEmojiClick={(emojiData) => {
                    setInput((prev) => `${prev}${emojiData.emoji}`);
                  }}
                />
              </Suspense>
            </div>
          )}
          <button
            type="button"
            onClick={handleSendMessage}
            disabled={mediaUploadState.active || isDirectConversationBlocked}
            className="h-12 w-12 rounded-2xl btn-gradient flex items-center justify-center disabled:opacity-55 disabled:cursor-not-allowed"
            aria-label={t("chatContainer.sendMessageAria")}
          >
            <img src={assets.send_button} alt="" className="w-5" />
          </button>
        </div>
      </div>

      <ForwardMessageModal
        isOpen={isForwardModalOpen}
        onClose={closeForwardModal}
        isSubmitting={isForwardingMessage}
        sourceMessage={forwardSourceMessage}
        selectedConversationId={selectedConversationId}
        conversations={conversations}
        onSubmit={handleForwardSubmit}
      />
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={closeReportModal}
        title={t("chatContainer.reportMessageTitle")}
        description={t("chatContainer.reportMessageDescription")}
        targetLabel={reportSourceMessageLabel}
        onSubmit={handleReportSubmit}
      />

      {isThreadPanelOpen && (
        <div
          className={`absolute inset-0 z-[55] bg-black/45 backdrop-blur-[1px] flex ${
            isRtl ? "justify-start" : "justify-end"
          }`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeThreadPanel();
            }
          }}
        >
          <div
            className={`h-full w-full sm:w-[420px] border-white/12 bg-[linear-gradient(180deg,rgba(25,22,39,0.98),rgba(14,12,22,0.98))] flex flex-col ${
              isRtl ? "border-r" : "border-l"
            }`}
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-white font-medium">{t("chatContainer.threadTitle")}</p>
                <p className="text-xs text-white/55">{t("chatContainer.threadSubtitle")}</p>
              </div>
              <button
                type="button"
                onClick={closeThreadPanel}
                className="icon-btn h-9 w-9 rounded-xl"
                aria-label={t("chatContainer.threadCloseAria")}
              >
                ×
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
              {threadPanelLoading && (
                <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-5 text-center text-sm text-white/70">
                  {t("chatContainer.threadLoading")}
                </div>
              )}

              {!threadPanelLoading && threadMessagesForRender.length === 0 && (
                <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-5 text-center text-sm text-white/70">
                  {t("chatContainer.threadEmpty")}
                </div>
              )}

              {!threadPanelLoading &&
                threadMessagesForRender.map((threadMessage) => {
                  const mentionNames = toMentionIds(threadMessage.mentions)
                    .map((mentionId) => participantNameById.get(mentionId) || t("common.member"))
                    .filter(Boolean);
                  const threadSenderId = toNormalizedId(threadMessage.senderId);
                  const threadSenderName =
                    participantNameById.get(threadSenderId) ||
                    (threadSenderId === toNormalizedId(authUser?._id)
                      ? t("common.you")
                      : t("common.member"));
                  const isRootMessage =
                    toNormalizedId(threadMessage._id) ===
                    toNormalizedId(activeThreadRootMessageId);

                  return (
                    <div
                      key={toNormalizedId(threadMessage._id) || threadMessage.clientId}
                      className={`rounded-2xl border px-3 py-2.5 ${
                        isRootMessage
                          ? "border-brand-300/40 bg-brand-500/18"
                          : "border-white/12 bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-white/65 truncate">{threadSenderName}</p>
                        <p className="text-[11px] text-white/45">
                          {formatMessageTime(threadMessage.createdAt)}
                        </p>
                      </div>
                      {threadMessage.isDeleted ? (
                        <p className="mt-1 text-sm text-white/90 break-words">
                          {t("common.attachment.messageDeleted")}
                        </p>
                      ) : isMessagePendingRelease(threadMessage) ? (
                        <p className="mt-1 text-sm text-white/90 break-words">
                          {t("common.attachment.scheduledMessage")}
                        </p>
                      ) : threadMessage.text ? (
                        <div className="mt-1 text-sm text-white/90 break-words">
                          <MessageText text={threadMessage.text} />
                        </div>
                      ) : (
                        <p className="mt-1 text-sm text-white/90 break-words">
                          {threadMessage.image
                            ? t("common.attachment.photo")
                            : threadMessage.audio?.url
                              ? t("common.attachment.voiceNote")
                              : threadMessage.file?.type?.startsWith("video/")
                                ? t("common.attachment.video")
                                : threadMessage.file?.name || t("common.attachment.attachment")}
                        </p>
                      )}
                      {!!mentionNames.length && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {mentionNames.map((mentionName, mentionIndex) => (
                            <span
                              key={`${threadMessage._id}-thread-mention-${mentionIndex}`}
                              className="px-2 py-0.5 rounded-full text-[11px] border border-brand-200/40 bg-brand-500/20 text-brand-100"
                            >
                              @{mentionName}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => handleReplyInThread(threadMessage)}
                          disabled={!canInteractInSelectedConversation}
                          className="text-xs px-2.5 py-1 rounded-full border border-white/20 text-white/75 hover:bg-white/8 disabled:opacity-45 disabled:cursor-not-allowed"
                        >
                          {t("messageList.reply")}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="px-4 py-3 border-t border-white/10">
              <button
                type="button"
                onClick={() => handleReplyInThread(threadRootMessage)}
                disabled={!threadRootMessage || !canInteractInSelectedConversation}
                className="w-full rounded-2xl btn-gradient text-sm font-medium py-2.5 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {t("chatContainer.threadReplyButton")}
              </button>
            </div>
          </div>
        </div>
      )}

      {isMobileDetailsOpen && (
        <RightSidebar
          mobileSheetOpen
          onCloseMobileSheet={() => setIsMobileDetailsOpen(false)}
          onOpenLightbox={onOpenLightbox}
        />
      )}
    </div>
  ) : (
    <div className="max-md:hidden flex flex-col items-center justify-center text-center p-6 bg-[linear-gradient(180deg,rgba(17,14,28,0.42),rgba(10,9,17,0.75))]">
      <div className="glass-panel rounded-3xl p-8 max-w-md animate-slide-up">
        <img src={assets.logo_icon} alt="" className="w-16 mx-auto opacity-90" />
        <p className="mt-4 text-xl font-medium text-white">
          {t("chatContainer.selectConversationTitle")}
        </p>
        <p className="mt-2 text-sm text-white/65">
          {t("chatContainer.selectConversationSubtitle")}
        </p>
      </div>
    </div>
  );
};

export default ChatContainer;
