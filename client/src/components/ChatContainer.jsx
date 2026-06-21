import React, { useContext, useEffect, useRef, useState } from "react";
import assets from "../assets/assets";
import { formatMessageTime } from "../lib/utils";
import { ChatContext } from "../../context/ChatContext";
import { AuthContext } from "../../context/AuthContext";
import toast from "react-hot-toast";

const ChatContainer = () => {
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
  } = useContext(ChatContext);
  const { authUser, onlineUsers } = useContext(AuthContext);
  const scrollEnd = useRef();
  const typingTimeoutRef = useRef(null);
  const typingRef = useRef(false);

  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (input.trim() === "" && !selectedImage) return;
    await sendMessage({
      text: input.trim() || undefined,
      image: selectedImage || undefined,
    });
    if (typingRef.current && selectedUser) {
      emitStopTyping(selectedUser._id);
      typingRef.current = false;
    }
    setInput("");
    setSelectedImage(null);
  };

  const handleSelectImage = (e) => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) {
      toast.error("Select an image file");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setSelectedImage(reader.result);
      e.target.value = "";
    };
    reader.readAsDataURL(file);
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

  useEffect(() => {
    if (selectedUser) {
      getMessages(selectedUser._id);
    }
  }, [selectedUser]);

  useEffect(() => {
    if (scrollEnd.current && messages) {
      scrollEnd.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(
    () => () => {
      clearTimeout(typingTimeoutRef.current);
    },
    []
  );

  const isSelectedUserTyping = selectedUser
    ? Boolean(typingUsers[selectedUser._id])
    : false;

  return selectedUser ? (
    <div className="h-full relative bg-[linear-gradient(180deg,rgba(20,17,32,0.32),rgba(15,13,24,0.82))]">
      <div className="sticky top-0 z-30 px-4 py-3 border-b border-white/10 glass-subtle">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={selectedUser.profilePic || assets.avatar_icon}
              alt=""
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
            className="md:hidden h-9 w-9 rounded-xl bg-white/8 border border-white/12 flex items-center justify-center"
          >
            <img src={assets.arrow_icon} alt="" className="w-6" />
          </button>
          <button
            type="button"
            className="max-md:hidden h-9 w-9 rounded-xl bg-white/8 border border-white/12 flex items-center justify-center hover:bg-white/12"
            aria-label="Help"
          >
            <img src={assets.help_icon} alt="" className="w-4" />
          </button>
        </div>
      </div>

      <div className="h-[calc(100%-164px)] overflow-y-auto px-4 py-4 pb-[8.5rem]">
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

            return (
              <div
                key={msg._id || index}
                className={`group flex mb-4 animate-message-in ${
                  isOwnMessage ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[78%] flex flex-col ${
                    isOwnMessage ? "items-end" : "items-start"
                  }`}
                >
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

                  {msg.text && (
                    <div
                      className={`relative px-4 py-2.5 text-sm break-words leading-relaxed ${
                        isOwnMessage
                          ? "text-white rounded-[18px] rounded-br-sm bg-[linear-gradient(135deg,#8b67ff_0%,#6d50f1_52%,#5539dd_100%)] shadow-[0_10px_24px_rgba(86,61,218,0.34)]"
                          : "text-white/92 rounded-[18px] rounded-bl-sm bg-white/8 border border-white/16 backdrop-blur-sm"
                      }`}
                    >
                      {msg.text}
                    </div>
                  )}

                  <div
                    className={`mt-1.5 px-1 flex items-center gap-1 text-[11px] text-white/55 ${
                      isOwnMessage ? "justify-end" : "justify-start"
                    }`}
                  >
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">
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
                  </div>
                </div>
              </div>
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

      <div className="absolute bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-3 border-t border-white/10 bg-[linear-gradient(180deg,rgba(13,12,20,0.1),rgba(12,10,18,0.92))] backdrop-blur-xl">
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

        <div className="flex items-center gap-2.5">
          <div className="flex-1 flex items-center px-3.5 rounded-2xl glass-subtle border border-white/14 focus-within:border-brand-300/55 focus-within:shadow-[0_0_0_3px_rgba(154,125,255,0.15)]">
            <label htmlFor="image" className="shrink-0">
              <img
                src={assets.gallery_icon}
                alt="gallery-icon"
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
            <input
              onChange={handleInputChange}
              value={input}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.shiftKey ? handleSendMessage(e) : null
              }
              type="text"
              placeholder="Type a message..."
              className="flex-1 text-sm p-3.5 border-none rounded-lg outline-none text-white placeholder:text-white/45 bg-transparent"
            />
          </div>
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
