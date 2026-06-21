import React, { useContext, useEffect, useState } from "react";
import assets from "../assets/assets";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../../context/AuthContext";
import { ChatContext } from "../../context/ChatContext";

const Sidebar = () => {
  const {
    getUsers,
    users,
    usersLoading = false,
    selectedUser,
    setSelectedUser,
    unseenMessages,
    setUnseenMessages,
  } = useContext(ChatContext);

  const { logout, onlineUsers } = useContext(AuthContext);
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const filteredUsers = input
    ? users.filter((user) =>
        user.fullName.toLowerCase().includes(input.toLowerCase())
      )
    : users;

  useEffect(() => {
    getUsers();
  }, [onlineUsers]);

  return (
    <div
      className={`h-full px-4 py-5 lg:px-5 lg:py-6 border-r border-white/10 bg-[linear-gradient(180deg,rgba(132,123,194,0.1),rgba(20,18,33,0.65))] text-white overflow-y-auto ${
        selectedUser ? "max-md:hidden" : ""
      }`}
    >
      <div className="pb-5 border-b border-white/10">
        <div className="flex justify-between items-center gap-3">
          <div>
            <img src={assets.logo} alt="logo" className="max-w-36 sm:max-w-40" />
            <p className="text-[11px] sm:text-xs text-white/60 mt-2">
              Instant conversations, elevated.
            </p>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="h-10 w-10 rounded-xl glass-subtle border border-white/15 flex items-center justify-center hover:border-white/30"
            >
              <img
                src={assets.menu_icon}
                alt="menu-icon"
                className="h-4 w-4 cursor-pointer"
              />
            </button>
            {menuOpen && (
              <div className="absolute top-12 right-0 z-20 w-40 p-2 rounded-xl glass-panel animate-slide-up">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate("/profile");
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-brand-300" />
                  Edit Profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white/10 text-rose-200 flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="glass-subtle rounded-2xl flex items-center gap-2 py-3 px-4 mt-5 border border-white/10 focus-within:border-brand-300/55 focus-within:shadow-[0_0_0_3px_rgba(154,125,255,0.15)]">
          <img
            src={assets.search_icon}
            alt="search-icon"
            className="w-3 opacity-75"
          />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            type="text"
            className="bg-transparent border-none outline-none text-white text-sm placeholder:text-white/45 flex-1"
            placeholder="Search users..."
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput("")}
              className="text-white/50 text-sm hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-1">
        {usersLoading &&
          Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-2 py-3">
              <div className="h-11 w-11 rounded-full skeleton" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-2/3 skeleton" />
                <div className="h-3 w-1/3 skeleton" />
              </div>
            </div>
          ))}

        {!usersLoading && filteredUsers.length === 0 && (
          <div className="glass-subtle border border-white/10 rounded-2xl p-5 text-center text-sm text-white/70">
            <p className="font-medium text-white/85">No conversations found</p>
            <p className="mt-1 text-xs text-white/55">
              Try a different name or start a new chat.
            </p>
          </div>
        )}

        {!usersLoading &&
          filteredUsers.map((user) => {
            const isOnline = onlineUsers.includes(user._id);
            const isActive = selectedUser?._id === user._id;

            return (
              <button
                type="button"
                key={user._id}
                onClick={() => {
                  setSelectedUser(user);
                  setUnseenMessages((prev) => ({ ...prev, [user._id]: 0 }));
                }}
                className={`w-full relative flex items-center gap-3 p-2.5 pr-3 rounded-2xl cursor-pointer text-left transition-all duration-200 border ${
                  isActive
                    ? "bg-white/10 border-brand-300/40 shadow-soft"
                    : "border-transparent hover:bg-white/7 hover:border-white/10"
                }`}
              >
                <div className="relative">
                  <img
                    src={user?.profilePic || assets.avatar_icon}
                    alt="avatar-icon"
                    className="w-11 h-11 rounded-full object-cover border border-white/20"
                  />
                  {isOnline && (
                    <>
                      <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface-900" />
                      <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-success/80 animate-pulse-ring" />
                    </>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium tracking-wide">
                    {user.fullName}
                  </p>
                  <p className="text-xs text-white/55 truncate mt-0.5">
                    {isOnline ? "Online now" : "Last seen recently"}
                  </p>
                </div>
                {unseenMessages[user._id] > 0 && (
                  <span className="text-[11px] min-w-5 h-5 px-1.5 flex justify-center items-center rounded-full btn-gradient">
                    {unseenMessages[user._id]}
                  </span>
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
};

export default Sidebar;

