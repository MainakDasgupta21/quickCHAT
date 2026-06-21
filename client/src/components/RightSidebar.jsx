import React, { useContext, useEffect, useState } from "react";
import assets from "../assets/assets";
import { ChatContext } from "../../context/ChatContext";
import { AuthContext } from "../../context/AuthContext";

const RightSidebar = () => {
  const { selectedUser, messages } = useContext(ChatContext);
  const { logout, onlineUsers } = useContext(AuthContext);
  const [msgImages, setMsgImages] = useState([]);

  useEffect(() => {
    setMsgImages(messages.filter((msg) => msg.image).map((msg) => msg.image));
  }, [messages]);

  return (
    selectedUser && (
      <div
        className={`w-full h-full text-white border-l border-white/10 bg-[linear-gradient(180deg,rgba(129,133,178,0.12),rgba(15,13,24,0.8))] overflow-y-auto ${
          selectedUser ? "max-md:hidden" : ""
        }`}
      >
        <div className="p-5 lg:p-6 pb-6">
          <div className="glass-panel rounded-3xl p-5 text-center animate-slide-up">
            <div className="relative w-fit mx-auto">
              <div className="h-24 w-24 rounded-full p-[2px] bg-[linear-gradient(135deg,#a786ff,#5f47e6)]">
                <img
                  src={selectedUser?.profilePic || assets.avatar_icon}
                  alt=""
                  className="h-full w-full rounded-full object-cover border border-white/15"
                />
              </div>
              {onlineUsers.includes(selectedUser._id) && (
                <>
                  <span className="absolute right-1 bottom-1 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-900" />
                  <span className="absolute right-1 bottom-1 h-3.5 w-3.5 rounded-full bg-success/80 animate-pulse-ring" />
                </>
              )}
            </div>

            <h1 className="mt-4 text-xl font-semibold tracking-wide">
              {selectedUser.fullName}
            </h1>
            <p className="text-xs text-white/60 mt-1">
              {onlineUsers.includes(selectedUser._id)
                ? "Online and available"
                : "Offline right now"}
            </p>
            <div className="mt-4 text-sm text-white/80 bg-white/6 border border-white/12 rounded-2xl p-3">
              {selectedUser.bio || "No bio available yet."}
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium tracking-wide">Shared Media</p>
              <span className="text-xs text-white/55">{msgImages.length} items</span>
            </div>

            {msgImages.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {msgImages.map((url, index) => (
                  <button
                    type="button"
                    key={index}
                    onClick={() => window.open(url, "_blank")}
                    className="group aspect-square rounded-2xl overflow-hidden border border-white/14 bg-white/6"
                  >
                    <img
                      src={url}
                      alt=""
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

          <div className="sticky bottom-0 pt-6 pb-2 bg-gradient-to-t from-surface-900/85 to-transparent">
            <button
              onClick={() => logout()}
              className="w-full btn-gradient text-sm font-medium py-3 rounded-2xl cursor-pointer"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    )
  );
};

export default RightSidebar;
