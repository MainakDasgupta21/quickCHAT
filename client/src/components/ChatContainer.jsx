import React, {
  Suspense,
  lazy,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import assets from "../assets/assets";
import {
  formatDateDividerLabel,
  formatFileSize,
  formatMessageTime,
} from "../lib/utils";
import { ChatContext } from "../../context/ChatContext";
import { AuthContext } from "../../context/AuthContext";
import toast from "react-hot-toast";
import ReactionBar from "./ReactionBar";
import MessageMenu from "./MessageMenu";
import AudioMessage from "./AudioMessage";
import RightSidebar from "./RightSidebar";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

const ChatContainer = ({
  sendShortcutSignal = 0,
  escapeSignal = 0,
  onOverlayOpenChange = () => {},
}) => {
  const {
    messages,
    selectedUser,
    setSelectedUser,
    sendMessage,
    getMessages,
    messagesLoading = false,
    typingUsers = {},
    emitTyping = () => {},
    emitStopTyping = () => {},
    editMessage = async () => false,
    deleteMessage = async () => false,
    reactToMessage = async () => false,
    replyTo,
    setReplyTo,
    searchMessages,
  } = useContext(ChatContext);
  const { authUser, onlineUsers } = useContext(AuthContext);
  const scrollContainerRef = useRef(null);
  const scrollEnd = useRef();
  const typingTimeoutRef = useRef(null);
  const typingRef = useRef(false);
  const previousMessageCountRef = useRef(0);
  const messageElementRefs = useRef({});
  const mediaRecorderRef = useRef(null);
  const audioStreamRef = useRef(null);
  const recordingIntervalRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const composerEmojiRef = useRef(null);
  const composerEmojiTriggerRef = useRef(null);

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
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState(false);

  const highlightText = (text) => {
    if (!searchQuery.trim()) return text;
    const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const splitMatcher = new RegExp(`(${escapedQuery})`, "gi");
    const exactMatcher = new RegExp(`^${escapedQuery}$`, "i");
    return String(text)
      .split(splitMatcher)
      .map((chunk, index) =>
        exactMatcher.test(chunk) ? (
          <mark
            key={`${chunk}-${index}`}
            className="bg-brand-200/35 text-white px-0.5 rounded-[4px]"
          >
            {chunk}
          </mark>
        ) : (
          <React.Fragment key={`${chunk}-${index}`}>{chunk}</React.Fragment>
        )
      );
  };

  const processFileInput = async (file, mode = "auto") => {
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      if (mode === "image" || file.type.startsWith("image/")) {
        setSelectedImage(dataUrl);
        return;
      }

      setSelectedFile({
        data: dataUrl,
        name: file.name,
        type: file.type,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  };

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
        toast.error("Voice recording is not supported in this browser.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];
      setRecordingSeconds(0);
      setIsRecording(true);
      audioStreamRef.current = stream;
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(chunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          setSelectedAudio({
            data: reader.result,
            duration: recordingSeconds,
            previewUrl: URL.createObjectURL(audioBlob),
          });
          setRecordingSeconds(0);
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      recordingIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      toast.error("Unable to access microphone.");
    }
  };

  const scrollToBottom = (behavior = "smooth") => {
    if (scrollEnd.current) {
      scrollEnd.current.scrollIntoView({ behavior, block: "end" });
    }
  };

  const handleSendMessage = async (event) => {
    event?.preventDefault?.();

    const trimmedInput = input.trim();
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
      await sendMessage({
        text: trimmedInput || undefined,
        image: selectedImage || undefined,
        file: selectedFile || undefined,
        audio: selectedAudio
          ? { data: selectedAudio.data, duration: selectedAudio.duration }
          : undefined,
        replyTo: replyTo?._id,
      });
      setInput("");
      setSelectedImage(null);
      setSelectedFile(null);
      if (selectedAudio?.previewUrl) {
        URL.revokeObjectURL(selectedAudio.previewUrl);
      }
      setSelectedAudio(null);
    }

    setReplyTo(null);
    setPendingBelowCount(0);
    setIsNearBottom(true);
    scrollToBottom();

    if (typingRef.current && selectedUser) {
      emitStopTyping(selectedUser._id);
      typingRef.current = false;
    }
  };

  const handleSelectImage = (e) => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) {
      toast.error("Select an image file");
      return;
    }

    processFileInput(file, "image");
    e.target.value = "";
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);

    if (!selectedUser) return;
    if (!value.trim()) {
      if (typingRef.current) {
        emitStopTyping(selectedUser._id);
        typingRef.current = false;
      }
      clearTimeout(typingTimeoutRef.current);
      return;
    }

    if (!typingRef.current) {
      emitTyping(selectedUser._id);
      typingRef.current = true;
    }

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      emitStopTyping(selectedUser._id);
      typingRef.current = false;
    }, 1200);
  };

  const isSelectedUserTyping = selectedUser
    ? Boolean(typingUsers[selectedUser._id])
    : false;

  const firstUnreadIndex = useMemo(
    () =>
      messages.findIndex(
        (message) =>
          message.senderId === selectedUser?._id && !message.seen && !message.isDeleted
      ),
    [messages, selectedUser?._id]
  );

  const searchMatchIds = useMemo(
    () => searchMatches.map((message) => message._id),
    [searchMatches]
  );

  useEffect(() => {
    if (selectedUser) {
      getMessages(selectedUser._id);
      setShowSearch(false);
      setSearchQuery("");
      setSearchMatches([]);
      setActiveSearchMatchIndex(0);
      setPendingBelowCount(0);
      setIsNearBottom(true);
      setOpenMessageMenuId(null);
      setOpenReactionPickerId(null);
      setShowComposerEmoji(false);
      setIsMobileDetailsOpen(false);
    }
  }, [selectedUser, getMessages]);

  useEffect(() => {
    if (!selectedUser) return;

    if (isNearBottom) {
      scrollToBottom();
    }
  }, [messages, isSelectedUserTyping, isNearBottom, selectedUser]);

  useEffect(() => {
    if (!messages.length) {
      previousMessageCountRef.current = 0;
      return;
    }

    const previousCount = previousMessageCountRef.current;
    if (messages.length > previousCount && !isNearBottom) {
      const newlyArrived = messages.slice(previousCount);
      const incomingCount = newlyArrived.filter(
        (message) => message.senderId === selectedUser?._id
      ).length;
      if (incomingCount > 0) {
        setPendingBelowCount((prev) => prev + incomingCount);
      }
    }
    previousMessageCountRef.current = messages.length;
  }, [messages, isNearBottom, selectedUser?._id]);

  useEffect(
    () => () => {
      clearTimeout(typingTimeoutRef.current);
      clearInterval(recordingIntervalRef.current);
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (selectedAudio?.previewUrl) {
        URL.revokeObjectURL(selectedAudio.previewUrl);
      }
      clearTimeout(searchTimeoutRef.current);
    },
    [selectedAudio?.previewUrl]
  );

  useEffect(() => {
    if (!sendShortcutSignal) return;
    handleSendMessage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendShortcutSignal]);

  useEffect(() => {
    if (!escapeSignal) return;
    setShowComposerEmoji(false);
    setShowSearch(false);
    setOpenMessageMenuId(null);
    setOpenReactionPickerId(null);
    setIsMobileDetailsOpen(false);
  }, [escapeSignal]);

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
    if (!selectedUser?._id || !searchQuery.trim()) {
      setSearchMatches([]);
      setActiveSearchMatchIndex(0);
      return;
    }

    clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(async () => {
      const matches = await searchMessages(selectedUser._id, searchQuery);
      setSearchMatches(matches);
      setActiveSearchMatchIndex(0);
    }, 260);

    return () => clearTimeout(searchTimeoutRef.current);
  }, [searchMessages, searchQuery, selectedUser?._id]);

  useEffect(() => {
    if (!searchMatchIds.length) return;
    const activeId = searchMatchIds[activeSearchMatchIndex];
    const activeElement = messageElementRefs.current[activeId];
    activeElement?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSearchMatchIndex, searchMatchIds]);

  const groupedReactionsForMessage = (message) => {
    const grouped = new Map();
    (message.reactions || []).forEach((reaction) => {
      if (!grouped.has(reaction.emoji)) {
        grouped.set(reaction.emoji, { emoji: reaction.emoji, count: 0, mine: false });
      }
      const entry = grouped.get(reaction.emoji);
      entry.count += 1;
      if (reaction.userId?.toString() === authUser?._id?.toString()) {
        entry.mine = true;
      }
    });
    return Array.from(grouped.values());
  };

  const getReplySnippet = (message) => {
    if (!message.replyTo) return null;
    const replyMessage = message.replyTo;

    if (replyMessage.isDeleted) {
      return "Deleted message";
    }
    if (replyMessage.text) return replyMessage.text;
    if (replyMessage.image) return "Photo";
    if (replyMessage.audio?.url) return "Voice note";
    if (replyMessage.file?.name) return `File: ${replyMessage.file.name}`;
    return "Attachment";
  };

  const activeSearchMatchId = searchMatchIds[activeSearchMatchIndex];
  const hasInteractiveOverlayOpen =
    showComposerEmoji ||
    showSearch ||
    Boolean(openMessageMenuId) ||
    Boolean(openReactionPickerId) ||
    isMobileDetailsOpen;

  useEffect(() => {
    onOverlayOpenChange(hasInteractiveOverlayOpen);
    return () => onOverlayOpenChange(false);
  }, [hasInteractiveOverlayOpen, onOverlayOpenChange]);

  return selectedUser ? (
    <div className="h-full min-h-0 flex flex-col bg-[linear-gradient(180deg,rgba(20,17,32,0.32),rgba(15,13,24,0.82))] relative">
      <div className="shrink-0 z-30 px-4 py-3 border-b border-white/10 glass-subtle">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={selectedUser.profilePic || assets.avatar_icon}
              alt={`${selectedUser.fullName} profile`}
              className="w-10 h-10 rounded-full object-cover border border-white/20"
            />
            {onlineUsers.includes(selectedUser._id) && (
              <>
                <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-900" />
                <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-success/80 animate-pulse-ring" />
              </>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-medium text-white truncate">
              {selectedUser.fullName}
            </p>
            <p className="text-xs text-white/60 mt-0.5">
              {onlineUsers.includes(selectedUser._id)
                ? "Active now"
                : "Currently offline"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedUser(null)}
            className="md:hidden icon-btn h-9 w-9"
            aria-label="Back to conversation list"
          >
            <img src={assets.arrow_icon} alt="Back" className="w-6" />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowSearch((prev) => !prev);
              setOpenMessageMenuId(null);
              setOpenReactionPickerId(null);
            }}
            className="icon-btn h-9 w-9"
            aria-label="Toggle in-conversation search"
            aria-pressed={showSearch}
          >
            <img src={assets.search_icon} alt="" className="w-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsMobileDetailsOpen(true)}
            className="md:hidden icon-btn h-9 w-9"
            aria-label="Open contact details"
          >
            <img src={assets.help_icon} alt="" className="w-4" />
          </button>
        </div>
        {showSearch && (
          <div className="mt-3 flex items-center gap-2 animate-fade-in">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search in conversation..."
              className="flex-1 rounded-xl bg-white/8 border border-white/15 px-3 py-2 text-sm text-white placeholder:text-white/45"
              aria-label="Search messages in conversation"
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
              aria-label="Previous search result"
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
              aria-label="Next search result"
            >
              ↓
            </button>
            <span className="text-xs text-white/55 min-w-16 text-right">
              {searchMatchIds.length
                ? `${activeSearchMatchIndex + 1}/${searchMatchIds.length}`
                : "0/0"}
            </span>
            <button
              type="button"
              onClick={() => {
                setShowSearch(false);
                setSearchQuery("");
              }}
              className="h-9 w-9 rounded-lg border border-white/15 bg-white/8"
              aria-label="Close search"
            >
              ×
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={(event) => {
          const target = event.currentTarget;
          const distanceFromBottom =
            target.scrollHeight - (target.scrollTop + target.clientHeight);
          const nearBottom = distanceFromBottom < 100;
          setIsNearBottom(nearBottom);
          if (nearBottom) {
            setPendingBelowCount(0);
          }
        }}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label={`Messages with ${selectedUser.fullName}`}
      >
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

        {!messagesLoading &&
          messages.map((msg, index) => {
            const isOwnMessage = msg.senderId === authUser._id;
            const previousMessage = messages[index - 1];
            const showDayDivider =
              !previousMessage ||
              new Date(previousMessage.createdAt).toDateString() !==
                new Date(msg.createdAt).toDateString();
            const isSearchMatch = searchMatchIds.includes(msg._id);
            const reactionGroups = groupedReactionsForMessage(msg);
            const replySnippet = getReplySnippet(msg);

            return (
              <React.Fragment key={msg._id || index}>
                {showDayDivider && (
                  <div className="flex items-center gap-2 my-4">
                    <div className="h-px flex-1 bg-white/12" />
                    <span className="text-[11px] text-white/50 uppercase tracking-wider">
                      {formatDateDividerLabel(msg.createdAt)}
                    </span>
                    <div className="h-px flex-1 bg-white/12" />
                  </div>
                )}

                {firstUnreadIndex === index && (
                  <div className="flex items-center gap-2 my-3">
                    <div className="h-px flex-1 bg-brand-300/35" />
                    <span className="text-[11px] text-brand-200">Unread messages</span>
                    <div className="h-px flex-1 bg-brand-300/35" />
                  </div>
                )}

                <div
                  ref={(element) => {
                    if (!msg._id) return;
                    if (element) {
                      messageElementRefs.current[msg._id] = element;
                    } else {
                      delete messageElementRefs.current[msg._id];
                    }
                  }}
                  className={`group flex mb-4 animate-message-in ${
                    isOwnMessage ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[78%] flex flex-col ${
                      isOwnMessage ? "items-end" : "items-start"
                    }`}
                  >
                    {!msg.isDeleted && replySnippet && (
                      <button
                        type="button"
                        onClick={() => {
                          if (msg.replyTo?._id) {
                            messageElementRefs.current[msg.replyTo._id]?.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            });
                          }
                        }}
                        className={`mb-1 text-left text-xs px-3 py-2 rounded-xl border ${
                          isOwnMessage
                            ? "bg-brand-700/40 border-brand-200/25 text-white/80"
                            : "bg-white/8 border-white/16 text-white/75"
                        }`}
                      >
                        <span className="block text-[10px] uppercase tracking-wide text-white/50">
                          Reply
                        </span>
                        <span className="line-clamp-1">{replySnippet}</span>
                      </button>
                    )}

                  {msg.image && (
                    <button
                      type="button"
                      onClick={() => window.open(msg.image, "_blank")}
                      className={`rounded-2xl overflow-hidden border ${
                        isOwnMessage
                          ? "border-brand-300/55"
                          : "border-white/20 bg-white/4"
                      }`}
                    >
                      <img
                        src={msg.image}
                        alt="message media"
                        className="max-h-64 sm:max-h-72 object-cover"
                      />
                    </button>
                  )}

                  {msg.file?.url && !msg.isDeleted && (
                    <a
                      href={msg.file.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`mb-1 rounded-2xl border px-3 py-2.5 text-sm ${
                        isOwnMessage
                          ? "bg-brand-700/40 border-brand-200/25 text-white/90"
                          : "bg-white/8 border-white/16 text-white/85"
                      }`}
                    >
                      <p className="font-medium truncate max-w-56">
                        {msg.file.name || "Attachment"}
                      </p>
                      <p className="text-xs text-white/60 mt-0.5">
                        {formatFileSize(msg.file.size)} · Download
                      </p>
                    </a>
                  )}

                  {msg.audio?.url && !msg.isDeleted && (
                    <div className="mb-1">
                      <AudioMessage src={msg.audio.url} duration={msg.audio.duration} />
                    </div>
                  )}

                  {msg.isDeleted ? (
                    <div
                      className={`relative px-4 py-2.5 text-sm italic ${
                        isOwnMessage
                          ? "text-white/70 rounded-[18px] rounded-br-sm bg-brand-700/35 border border-brand-200/20"
                          : "text-white/65 rounded-[18px] rounded-bl-sm bg-white/6 border border-white/14"
                      }`}
                    >
                      This message was deleted
                    </div>
                  ) : (
                    msg.text && (
                    <div
                      className={`relative px-4 py-2.5 text-sm break-words leading-relaxed ${
                        isOwnMessage
                          ? "text-white rounded-[18px] rounded-br-sm bg-[var(--gradient-brand)] shadow-[0_10px_24px_rgba(86,61,218,0.34)]"
                          : "text-white/92 rounded-[18px] rounded-bl-sm bg-white/8 border border-white/16 backdrop-blur-sm"
                      } ${
                        activeSearchMatchId === msg._id ? "ring-2 ring-brand-200/80 ring-offset-2 ring-offset-transparent" : ""
                      }`}
                    >
                      {isSearchMatch ? highlightText(msg.text) : msg.text}
                    </div>
                    )
                  )}

                    {!msg.isDeleted && (
                      <div className="mt-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                        <div className="flex items-center gap-1.5">
                          <ReactionBar
                            onSelectEmoji={(emoji) => reactToMessage(msg._id, emoji)}
                            isPickerOpen={openReactionPickerId === msg._id}
                            onPickerOpenChange={(open) => {
                              setOpenReactionPickerId(open ? msg._id : null);
                              if (open) {
                                setOpenMessageMenuId(null);
                              }
                            }}
                            closeSignal={escapeSignal}
                          />
                          <MessageMenu
                            canEdit={isOwnMessage}
                            isOpen={openMessageMenuId === msg._id}
                            onOpenChange={(open) => {
                              setOpenMessageMenuId(open ? msg._id : null);
                              if (open) {
                                setOpenReactionPickerId(null);
                              }
                            }}
                            closeSignal={escapeSignal}
                            onReply={() => {
                              setReplyTo(msg);
                              setEditingMessageId(null);
                            }}
                            onEdit={() => {
                              setEditingMessageId(msg._id);
                              setInput(msg.text || "");
                              setReplyTo(null);
                            }}
                            onDelete={() => {
                              deleteMessage(msg._id);
                            }}
                          />
                        </div>
                      </div>
                    )}

                  {!!reactionGroups.length && (
                    <div
                      className={`mt-1 flex flex-wrap gap-1 ${
                        isOwnMessage ? "justify-end" : "justify-start"
                      }`}
                    >
                      {reactionGroups.map((reaction) => (
                        <button
                          type="button"
                          key={`${msg._id}-${reaction.emoji}`}
                          onClick={() => reactToMessage(msg._id, reaction.emoji)}
                          className={`px-2 py-1 rounded-full text-xs border ${
                            reaction.mine
                              ? "bg-brand-500/35 border-brand-200/45 text-white"
                              : "bg-white/8 border-white/20 text-white/80"
                          }`}
                        >
                          {reaction.emoji} {reaction.count}
                        </button>
                      ))}
                    </div>
                  )}

                  <div
                    className={`mt-1.5 px-1 flex items-center gap-1 text-[11px] text-white/55 ${
                      isOwnMessage ? "justify-end" : "justify-start"
                    }`}
                  >
                    <span className="text-white/45">
                      {formatMessageTime(msg.createdAt)}
                    </span>
                    {isOwnMessage && (
                      <span
                        className={`font-semibold tracking-tight ${
                          msg.seen ? "text-brand-200" : "text-white/55"
                        }`}
                        title={msg.seen ? "Seen" : "Delivered"}
                      >
                        {msg.seen ? "✓✓" : "✓"}
                      </span>
                    )}
                    {msg.editedAt && !msg.isDeleted && (
                      <span className="text-white/40">(edited)</span>
                    )}
                  </div>
                </div>
                </div>
              </React.Fragment>
            );
          })}

        {!messagesLoading && isSelectedUserTyping && (
          <div className="flex justify-start mb-4 animate-fade-in">
            <div className="px-3 py-2.5 rounded-2xl rounded-bl-sm bg-white/8 border border-white/16 backdrop-blur-sm flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-typing-bounce" />
              <span
                className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-typing-bounce"
                style={{ animationDelay: "120ms" }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-typing-bounce"
                style={{ animationDelay: "240ms" }}
              />
            </div>
          </div>
        )}

        {!messagesLoading && messages.length === 0 && (
          <div className="h-full min-h-60 flex flex-col items-center justify-center text-center text-white/55">
            <img src={assets.logo_icon} alt="" className="w-12 opacity-80 mb-3" />
            <p className="text-white/85 font-medium">No messages yet</p>
            <p className="text-sm mt-1">
              Start the conversation with your first message.
            </p>
          </div>
        )}

        <div ref={scrollEnd} />
      </div>

      {!isNearBottom && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom();
            setPendingBelowCount(0);
          }}
          className="absolute bottom-[calc(7rem+env(safe-area-inset-bottom))] right-4 sm:right-6 z-30 px-3 py-2 rounded-full btn-gradient text-xs font-medium shadow-soft"
        >
          {pendingBelowCount > 0 ? `${pendingBelowCount} new · ` : ""}
          Scroll to latest
        </button>
      )}

      <div className="shrink-0 z-40 px-4 pb-4 pt-3 border-t border-white/10 bg-[linear-gradient(180deg,rgba(13,12,20,0.1),rgba(12,10,18,0.92))] backdrop-blur-xl">
        {(replyTo || editingMessageId) && (
          <div className="mb-2.5 rounded-xl px-3 py-2 bg-white/8 border border-white/14 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-white/55">
                {editingMessageId ? "Editing message" : "Replying to"}
              </p>
              <p className="text-xs text-white/80 truncate">
                {editingMessageId
                  ? "Update and send to apply changes"
                  : replyTo?.text ||
                    (replyTo?.image
                      ? "Photo"
                      : replyTo?.audio?.url
                        ? "Voice note"
                        : replyTo?.file?.name || "Message")}
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
              Cancel
            </button>
          </div>
        )}

        {selectedImage && (
          <div className="mb-2.5 inline-flex items-center gap-2 rounded-xl px-2.5 py-2 bg-white/8 border border-white/14">
            <img
              src={selectedImage}
              alt="preview"
              className="h-12 w-12 rounded-lg object-cover"
            />
            <p className="text-xs text-white/70">Image ready to send</p>
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="text-xs text-white/60 hover:text-white"
            >
              Remove
            </button>
          </div>
        )}

        {selectedFile && (
          <div className="mb-2.5 inline-flex items-center gap-2 rounded-xl px-2.5 py-2 bg-white/8 border border-white/14">
            <div>
              <p className="text-xs text-white/80 max-w-56 truncate">
                {selectedFile.name}
              </p>
              <p className="text-[11px] text-white/55">{formatFileSize(selectedFile.size)}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="text-xs text-white/60 hover:text-white"
            >
              Remove
            </button>
          </div>
        )}

        {selectedAudio && (
          <div className="mb-2.5 inline-flex items-center gap-2 rounded-xl px-2.5 py-2 bg-white/8 border border-white/14">
            <audio src={selectedAudio.previewUrl} controls className="h-8" />
            <button
              type="button"
              onClick={() => {
                if (selectedAudio.previewUrl) {
                  URL.revokeObjectURL(selectedAudio.previewUrl);
                }
                setSelectedAudio(null);
              }}
              className="text-xs text-white/60 hover:text-white"
            >
              Remove
            </button>
          </div>
        )}

        {isRecording && (
          <div className="mb-2.5 inline-flex items-center gap-2 rounded-xl px-2.5 py-2 bg-rose-500/15 border border-rose-300/20">
            <span className="h-2 w-2 rounded-full bg-rose-300 animate-pulse" />
            <p className="text-xs text-rose-100">Recording... {recordingSeconds}s</p>
            <button
              type="button"
              onClick={stopRecording}
              className="text-xs text-rose-100/80 hover:text-rose-100"
            >
              Stop
            </button>
          </div>
        )}

        <div className="flex items-center gap-2.5">
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
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
              className="shrink-0 cursor-pointer"
              aria-label="Attach an image"
            >
              <img
                src={assets.gallery_icon}
                alt="Attach image"
                className="w-5 cursor-pointer opacity-80 hover:opacity-100"
              />
            </label>
            <input
              onChange={handleSelectImage}
              type="file"
              id="image"
              accept="image/png, image/jpeg"
              hidden
            />
            <label
              htmlFor="file-attachment"
              className="shrink-0 ml-2 text-white/70 text-sm cursor-pointer"
              aria-label="Attach a file"
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
              className="shrink-0 ml-2 text-white/75 hover:text-white"
              aria-label="Open emoji picker"
              aria-expanded={showComposerEmoji}
            >
              🙂
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
              className={`shrink-0 ml-2 text-sm ${isRecording ? "text-rose-300" : "text-white/75 hover:text-white"}`}
              aria-label={isRecording ? "Stop recording" : "Start recording"}
            >
              🎤
            </button>
            <input
              onChange={handleInputChange}
              value={input}
              onPaste={(event) => {
                const pastedFile = event.clipboardData.files?.[0];
                if (pastedFile) {
                  processFileInput(pastedFile);
                }
              }}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.shiftKey ? handleSendMessage(e) : null
              }
              type="text"
              placeholder="Type a message..."
              className="flex-1 text-sm p-3.5 rounded-lg field-input"
              aria-label="Type a message"
            />
          </div>
          {showComposerEmoji && (
            <div
              ref={composerEmojiRef}
              className="fixed right-4 sm:right-8 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-50"
            >
              <Suspense
                fallback={
                  <div className="h-80 w-[280px] rounded-xl glass-panel border border-white/15 flex items-center justify-center text-xs text-white/70">
                    Loading emoji picker...
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
            className="h-12 w-12 rounded-2xl btn-gradient flex items-center justify-center"
            aria-label="Send message"
          >
            <img src={assets.send_button} alt="" className="w-5" />
          </button>
        </div>
      </div>

      {isMobileDetailsOpen && (
        <RightSidebar
          mobileSheetOpen
          onCloseMobileSheet={() => setIsMobileDetailsOpen(false)}
        />
      )}
    </div>
  ) : (
    <div className="max-md:hidden flex flex-col items-center justify-center text-center p-6 bg-[linear-gradient(180deg,rgba(17,14,28,0.42),rgba(10,9,17,0.75))]">
      <div className="glass-panel rounded-3xl p-8 max-w-md animate-slide-up">
        <img src={assets.logo_icon} alt="" className="w-16 mx-auto opacity-90" />
        <p className="mt-4 text-xl font-medium text-white">
          Select a conversation
        </p>
        <p className="mt-2 text-sm text-white/65">
          Stay connected with your people through premium real-time messaging.
        </p>
      </div>
    </div>
  );
};

export default ChatContainer;
