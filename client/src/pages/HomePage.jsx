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
            ? "md:grid-cols-[clamp(240px,30vw,300px)_minmax(0,1fr)] lg:grid-cols-[clamp(280px,26vw,320px)_minmax(0,1fr)] xl:grid-cols-[clamp(280px,22vw,320px)_minmax(0,1fr)_clamp(300px,24vw,340px)] 2xl:grid-cols-[360px_minmax(0,1fr)_380px]"
            : "md:grid-cols-[clamp(280px,34vw,340px)_minmax(0,1fr)] lg:grid-cols-[clamp(320px,30vw,380px)_minmax(0,1fr)]"
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
