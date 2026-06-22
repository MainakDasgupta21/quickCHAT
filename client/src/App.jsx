import React, { Suspense, lazy, useContext } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthContext } from "../context/AuthContext";
import AppSplash from "./components/AppSplash";

// Route-level code splitting keeps the initial bundle small: a logged-out user
// only downloads the login screen, not the full chat workspace + emoji picker.
const HomePage = lazy(() => import("./pages/HomePage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));

export const App = () => {
  const { authUser, connectionStatus, isAuthLoading } = useContext(AuthContext);

  if (isAuthLoading) {
    return <AppSplash label="Restoring your session..." />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_12%_8%,rgba(138,101,255,0.34),transparent_30%),radial-gradient(circle_at_84%_14%,rgba(86,146,250,0.24),transparent_30%),radial-gradient(circle_at_54%_92%,rgba(126,76,244,0.22),transparent_35%)]" />
      <div className="absolute inset-0 -z-10 bg-[url('/bgImage.svg')] bg-cover bg-center opacity-20" />
      {authUser && connectionStatus !== "connected" && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="absolute top-0 left-0 right-0 z-50 px-4 py-2 text-center text-xs font-medium border-b border-amber-300/20 bg-amber-300/14 text-amber-100 backdrop-blur-md"
        >
          {connectionStatus === "connecting"
            ? "Connecting to quickCHAT real-time services..."
            : "Reconnecting... messages will sync once connected."}
        </div>
      )}
      <Toaster
        position="top-right"
        gutter={12}
        toastOptions={{
          duration: 2800,
          style: {
            background:
              "linear-gradient(160deg, rgba(36,30,59,0.9), rgba(20,17,34,0.88))",
            color: "#efecff",
            border: "1px solid rgba(207,212,255,0.24)",
            borderRadius: "14px",
            boxShadow: "0 16px 48px rgba(9, 8, 20, 0.48)",
            backdropFilter: "blur(10px)",
          },
          success: {
            iconTheme: { primary: "#20c983", secondary: "#0f0d18" },
          },
          error: {
            iconTheme: { primary: "#ef4f6e", secondary: "#0f0d18" },
          },
        }}
      />
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
  );
};

export default App;
