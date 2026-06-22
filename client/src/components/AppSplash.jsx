import React from "react";
import assets from "../assets/assets";
import { translate } from "../i18n/runtime";

// Branded full-screen loading state used while the persisted session is being
// validated and while lazily-loaded routes resolve. Prevents a flash of the
// login screen for users who are already authenticated.
const AppSplash = ({ label = translate("app.splashLoading") }) => (
  <div
    role="status"
    aria-live="polite"
    className="min-h-screen flex flex-col items-center justify-center gap-5"
  >
    <img
      src={assets.logo_icon}
      alt=""
      className="w-14 h-14 animate-pulse"
    />
    <div className="flex items-center gap-1.5" aria-hidden="true">
      <span className="h-2 w-2 rounded-full bg-brand-300 animate-typing-bounce" />
      <span
        className="h-2 w-2 rounded-full bg-brand-300 animate-typing-bounce"
        style={{ animationDelay: "120ms" }}
      />
      <span
        className="h-2 w-2 rounded-full bg-brand-300 animate-typing-bounce"
        style={{ animationDelay: "240ms" }}
      />
    </div>
    <p className="text-sm text-white/60">{label}</p>
  </div>
);

export default AppSplash;
