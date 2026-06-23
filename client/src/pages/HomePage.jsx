import React, {
  useCallback,
  useContext,
  useState,
} from "react";
import Sidebar from "../components/Sidebar";
import ChatContainer from "../components/ChatContainer";
import RightSidebar from "../components/RightSidebar";
import Lightbox from "../components/Lightbox";
import GlobalSearchModal from "../components/GlobalSearchModal";
import StarredMessagesModal from "../components/StarredMessagesModal";
import { ChatContext } from "../../context/ChatContext";

const HomePage = () => {
  const { selectedConversation } = useContext(ChatContext);
  const [lightboxItems, setLightboxItems] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [isStarredMessagesOpen, setIsStarredMessagesOpen] = useState(false);

  const handleOpenLightbox = useCallback((items, startIndex = 0) => {
    if (!Array.isArray(items) || !items.length) return;
    const normalizedItems = items.filter((item) => item?.url);
    if (!normalizedItems.length) return;

    const requestedIndex = Number(startIndex) || 0;
    const safeIndex = Math.min(
      normalizedItems.length - 1,
      Math.max(0, requestedIndex)
    );

    setLightboxItems(normalizedItems);
    setLightboxIndex(safeIndex);
  }, []);

  const handleCloseLightbox = useCallback(() => {
    setLightboxItems([]);
    setLightboxIndex(0);
  }, []);

  return (
    <div className="w-full h-full min-h-0 animate-fade-in">
      <div
        className={`w-full h-full overflow-hidden grid grid-cols-1 relative transition-all duration-300 ${
          selectedConversation
            ? "md:grid-cols-[300px_minmax(0,1fr)_320px] 2xl:grid-cols-[340px_minmax(0,1fr)_360px]"
            : "md:grid-cols-[360px_minmax(0,1fr)]"
        }`}
      >
        <Sidebar
          onOpenStarredMessages={() => setIsStarredMessagesOpen(true)}
        />
        <ChatContainer
          onOpenLightbox={handleOpenLightbox}
        />
        <RightSidebar onOpenLightbox={handleOpenLightbox} />
      </div>

      <Lightbox
        items={lightboxItems}
        activeIndex={lightboxIndex}
        onChangeIndex={setLightboxIndex}
        onClose={handleCloseLightbox}
      />
      <GlobalSearchModal
        isOpen={isGlobalSearchOpen}
        onClose={() => setIsGlobalSearchOpen(false)}
      />
      <StarredMessagesModal
        isOpen={isStarredMessagesOpen}
        onClose={() => setIsStarredMessagesOpen(false)}
      />
    </div>
  );
};

export default HomePage;
