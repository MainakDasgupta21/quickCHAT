import avatar_icon from "./avatar_icon.png";
import gallery_icon from "./gallery_icon.svg";
import help_icon from "./help_icon.png";
import logo_icon from "./logo_icon.svg";
import logo_big from "./logo_big.svg";
import logo from "./logo.png";
import search_icon from "./search_icon.png";
import send_button from "./send_button.svg";
import menu_icon from "./menu_icon.png";
import arrow_icon from "./arrow_icon.png";

// Only ship icons that are actually referenced by the UI. The previous version
// statically imported ~1.6MB of demo avatars/photos via `userDummyData`,
// `imagesDummyData` and `messagesDummyData` that were never used at runtime but
// were still emitted into the production bundle.
const assets = {
  avatar_icon,
  gallery_icon,
  help_icon,
  logo_big,
  logo_icon,
  logo,
  search_icon,
  send_button,
  menu_icon,
  arrow_icon,
};

export default assets;
