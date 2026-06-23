import React, { Suspense, lazy, useContext } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthContext } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import AppSplash from "./components/AppSplash";

// Route-level code splitting keeps the initial bundle small: a logged-out user
// only downloads the login screen, not the full chat workspace + emoji picker.
const HomePage = lazy(() => import("./pages/HomePage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));

export const App = () => {
  const { authUser, connectionStatus, isAuthLoading, theme = "dark" } =
    useContext(AuthContext);
  const { isRtl, t } = useLocale();
  const isLightTheme = theme === "light";

  if (isAuthLoading) {
    return <AppSplash label={t("app.splashRestoringSession")} />;
  }

  return (
    <div className="app-shell relative h-dvh overflow-hidden flex flex-col">
      <div className="app-ambient absolute inset-0 -z-20" />
      <div className="app-texture absolute inset-0 -z-10 bg-[url('/bgImage.svg')] bg-cover bg-center" />
      {authUser && connectionStatus !== "connected" && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="relative z-50 shrink-0 px-4 py-2 text-center text-xs font-medium border-b border-amber-300/20 bg-amber-300/14 text-amber-100 backdrop-blur-md"
        >
          {connectionStatus === "connecting"
            ? t("app.connectingRealtime")
            : t("app.reconnectingRealtime")}
        </div>
      )}
      <Toaster
        position={isRtl ? "top-left" : "top-right"}
        gutter={12}
        toastOptions={{
          duration: 2800,
          style: {
            background: isLightTheme
              ? "linear-gradient(160deg, rgba(255,255,255,0.96), rgba(243,247,255,0.96))"
              : "linear-gradient(160deg, rgba(36,30,59,0.9), rgba(20,17,34,0.88))",
            color: isLightTheme ? "#1c2444" : "#efecff",
            border: isLightTheme
              ? "1px solid rgba(101,116,179,0.26)"
              : "1px solid rgba(207,212,255,0.24)",
            borderRadius: "14px",
            boxShadow: isLightTheme
              ? "0 16px 42px rgba(106, 119, 180, 0.28)"
              : "0 16px 48px rgba(9, 8, 20, 0.48)",
            backdropFilter: "blur(10px)",
          },
          success: {
            iconTheme: {
              primary: "#20c983",
              secondary: isLightTheme ? "#f4f7ff" : "#0f0d18",
            },
          },
          error: {
            iconTheme: {
              primary: "#ef4f6e",
              secondary: isLightTheme ? "#f4f7ff" : "#0f0d18",
            },
          },
        }}
      />
      <div className="relative flex-1 min-h-0">
        <Suspense fallback={<AppSplash />}>
          <Routes>
            <Route
              path="/"
              element={authUser ? <HomePage /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/login"
              element={!authUser ? <LoginPage /> : <Navigate to="/" replace />}
            />
            <Route
              path="/profile"
              element={authUser ? <ProfilePage /> : <Navigate to="/login" replace />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
};

export default App;
