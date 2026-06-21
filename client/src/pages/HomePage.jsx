import React, { useContext } from "react";
import Sidebar from "../components/Sidebar";
import ChatContainer from "../components/ChatContainer";
import RightSidebar from "../components/RightSidebar";
import { ChatContext } from "../../context/ChatContext";

const HomePage = () => {
  const { selectedUser } = useContext(ChatContext);

  return (
    <div className="w-full min-h-screen p-3 sm:p-6 lg:p-8 animate-fade-in">
      <div
        className={`glass-panel mx-auto h-[calc(100vh-1.5rem)] sm:h-[calc(100vh-3rem)] lg:h-[calc(100vh-4rem)] max-w-[1500px] rounded-[28px] overflow-hidden grid grid-cols-1 relative transition-all duration-300 ${
          selectedUser
            ? "md:grid-cols-[300px_minmax(0,1fr)_320px] 2xl:grid-cols-[340px_minmax(0,1fr)_360px]"
            : "md:grid-cols-[360px_minmax(0,1fr)]"
        }`}
      >
        <Sidebar />
        <ChatContainer />
        <RightSidebar />
      </div>
    </div>
  );
};

export default HomePage;
