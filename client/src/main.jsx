import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext.jsx";
import { ChatProvider } from "../context/ChatContext.jsx";
import { CallProvider } from "../context/CallContext.jsx";
import { LocaleProvider } from "../context/LocaleContext.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { registerServiceWorker } from "./lib/pushNotifications";

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <LocaleProvider>
      <BrowserRouter>
        <AuthProvider>
          <ChatProvider>
            <CallProvider>
              <App />
            </CallProvider>
          </ChatProvider>
        </AuthProvider>
      </BrowserRouter>
    </LocaleProvider>
  </ErrorBoundary>
);

void registerServiceWorker();
