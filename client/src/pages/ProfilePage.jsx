import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import assets from "../assets/assets";
import { AuthContext } from "../../context/AuthContext";
import { MAX_IMAGE_UPLOAD_BYTES } from "../lib/utils";

const ProfilePage = () => {
  const {
    authUser,
    updateProfile,
    beginTwoFactorSetup,
    enableTwoFactor,
    disableTwoFactor,
  } = useContext(AuthContext);

  const [selectedImg, setSelectedImg] = useState(null);
  const [name, setName] = useState(authUser?.fullName ?? "");
  const [bio, setBio] = useState(authUser?.bio ?? "");
  const [previewUrl, setPreviewUrl] = useState(
    authUser?.profilePic || assets.avatar_icon
  );
  const [isSaving, setIsSaving] = useState(false);
  const [twoFactorSetup, setTwoFactorSetup] = useState(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [isPreparingTwoFactor, setIsPreparingTwoFactor] = useState(false);
  const [isUpdatingTwoFactor, setIsUpdatingTwoFactor] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setName(authUser?.fullName ?? "");
    setBio(authUser?.bio ?? "");
  }, [authUser?.fullName, authUser?.bio]);

  useEffect(() => {
    if (!selectedImg) {
      setPreviewUrl(authUser?.profilePic || assets.avatar_icon);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedImg);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedImg, authUser?.profilePic]);

  useEffect(() => {
    if (authUser?.twoFactorEnabled) {
      setTwoFactorSetup(null);
    }
  }, [authUser?.twoFactorEnabled]);

  const handleSelectImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please choose a PNG or JPG image.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      toast.error("Image is too large. Please pick one under 5MB.");
      event.target.value = "";
      return;
    }

    setSelectedImg(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    if (!selectedImg) {
      const ok = await updateProfile({ fullName: name, bio });
      setIsSaving(false);
      if (ok) navigate("/");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Image = reader.result;
      const ok = await updateProfile({ profilePic: base64Image, fullName: name, bio });
      setIsSaving(false);
      if (ok) navigate("/");
    };
    reader.onerror = () => {
      setIsSaving(false);
      toast.error("Could not read that image. Please try another file.");
    };
    reader.readAsDataURL(selectedImg);
  };

  const handleStartTwoFactorSetup = async () => {
    setIsPreparingTwoFactor(true);
    const setupPayload = await beginTwoFactorSetup();
    setIsPreparingTwoFactor(false);
    if (setupPayload) {
      setTwoFactorSetup(setupPayload);
      setTwoFactorCode("");
    }
  };

  const handleEnableTwoFactor = async () => {
    if (!twoFactorCode.trim()) {
      toast.error("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setIsUpdatingTwoFactor(true);
    const didEnable = await enableTwoFactor({ code: twoFactorCode });
    setIsUpdatingTwoFactor(false);
    if (didEnable) {
      setTwoFactorCode("");
      setTwoFactorSetup(null);
    }
  };

  const handleDisableTwoFactor = async () => {
    if (!twoFactorCode.trim()) {
      toast.error("Enter your current 6-digit authenticator code.");
      return;
    }
    setIsUpdatingTwoFactor(true);
    const didDisable = await disableTwoFactor({ code: twoFactorCode });
    setIsUpdatingTwoFactor(false);
    if (didDisable) {
      setTwoFactorCode("");
      setTwoFactorSetup(null);
    }
  };

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-10 flex items-center justify-center animate-fade-in">
      <div className="w-full max-w-4xl glass-panel rounded-3xl p-5 sm:p-7 lg:p-8 text-gray-200 animate-slide-up">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div>
            <h2 className="text-2xl font-semibold text-white">Profile details</h2>
            <p className="text-sm text-white/65 mt-1">
              Keep your profile up to date for better conversations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="h-10 w-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center"
            aria-label="Go back"
          >
            <img src={assets.arrow_icon} alt="" className="w-6" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="grid lg:grid-cols-[1fr_320px] gap-8 items-start"
        >
          <div className="space-y-4">
            <label
              htmlFor="avatar"
              className="glass-subtle rounded-2xl border border-white/12 px-4 py-3 flex items-center gap-3 cursor-pointer"
              aria-label="Upload profile image"
            >
              <div className="relative h-11 w-11 rounded-full overflow-hidden border border-white/20">
                <img src={previewUrl} alt="" className="h-full w-full object-cover" />
              </div>
              <div>
                <p className="text-sm text-white">Upload profile image</p>
                <p className="text-xs text-white/60">PNG or JPG up to 5MB</p>
              </div>
              <div className="ml-auto text-white/65 text-xs border border-white/15 rounded-lg px-2 py-1">
                Change
              </div>
              <input
                onChange={handleSelectImage}
                type="file"
                id="avatar"
                accept=".png,.jpg,.jpeg"
                hidden
              />
            </label>

            <div className="space-y-1.5">
              <label htmlFor="profile-display-name" className="text-sm text-white/75">
                Display name
              </label>
              <input
                id="profile-display-name"
                onChange={(e) => setName(e.target.value)}
                value={name}
                type="text"
                placeholder="Your name"
                className="w-full p-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="profile-bio" className="text-sm text-white/75">
                Bio
              </label>
              <textarea
                id="profile-bio"
                onChange={(e) => setBio(e.target.value)}
                value={bio}
                placeholder="Write profile bio"
                className="w-full p-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45"
                rows={5}
                required
              ></textarea>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="btn-gradient w-full sm:w-auto min-w-36 py-3 px-6 rounded-xl text-sm font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>

          <div className="glass-subtle rounded-3xl border border-white/14 p-6 text-center">
            <div className="relative w-fit mx-auto">
              <div className="h-40 w-40 rounded-full p-[3px] bg-[linear-gradient(140deg,#a280ff,#6548e7)]">
                <img
                  className="h-full w-full rounded-full object-cover border border-white/15"
                  src={previewUrl}
                  alt=""
                />
              </div>
              <label
                htmlFor="avatar"
                className="absolute right-2 bottom-2 h-10 w-10 rounded-full btn-gradient border border-white/20 flex items-center justify-center cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3 3 8.5-8.5a2.12 2.12 0 1 1 3 3L13 14H10v-3zM4 6h2.17a4 4 0 0 0 6.66 0H15a2 2 0 0 1 2 2v2.17a4 4 0 0 0 0 6.66V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
                    fill="currentColor"
                  />
                </svg>
              </label>
            </div>
            <p className="mt-4 text-sm text-white/70">
              This image is shown in chats and your profile.
            </p>

            <div className="mt-5 rounded-2xl border border-white/14 bg-white/6 p-4 text-left space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Two-factor authentication (TOTP)
                </h3>
                <p className="mt-1 text-xs text-white/65">
                  Protect this account with a one-time code from Google
                  Authenticator, Authy, or any TOTP app.
                </p>
              </div>

              <button
                type="button"
                onClick={handleStartTwoFactorSetup}
                disabled={isPreparingTwoFactor}
                className="w-full rounded-xl border border-white/18 bg-white/8 px-3 py-2 text-xs text-white hover:bg-white/12 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isPreparingTwoFactor
                  ? "Preparing setup..."
                  : authUser?.twoFactorEnabled
                    ? "Rotate authenticator setup"
                    : "Start 2FA setup"}
              </button>

              {twoFactorSetup && (
                <div className="rounded-xl border border-white/14 bg-[#0c0f1f]/55 p-3 space-y-3">
                  {twoFactorSetup.qrCodeDataUrl ? (
                    <img
                      src={twoFactorSetup.qrCodeDataUrl}
                      alt="2FA setup QR code"
                      className="mx-auto h-40 w-40 rounded-lg bg-white p-1"
                    />
                  ) : (
                    <p className="text-xs text-white/70">
                      QR preview unavailable. Use the manual key below.
                    </p>
                  )}
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.12em] text-white/55">
                      Manual setup key
                    </p>
                    <code className="mt-1 block rounded-lg bg-white/10 px-2 py-1 text-[11px] text-white break-all">
                      {twoFactorSetup.manualEntryKey}
                    </code>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={twoFactorCode}
                      onChange={(event) =>
                        setTwoFactorCode(
                          event.target.value.replace(/[^\d\s-]/g, "")
                        )
                      }
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={8}
                      className="w-full rounded-lg border border-white/15 bg-white/8 px-3 py-2 text-xs text-white placeholder:text-white/45 tracking-[0.22em]"
                      placeholder="Enter 6-digit code"
                    />
                    <button
                      type="button"
                      onClick={handleEnableTwoFactor}
                      disabled={isUpdatingTwoFactor}
                      className="w-full rounded-lg btn-gradient py-2 text-xs font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isUpdatingTwoFactor
                        ? "Verifying..."
                        : authUser?.twoFactorEnabled
                          ? "Confirm key rotation"
                          : "Enable 2FA"}
                    </button>
                  </div>
                </div>
              )}

              {authUser?.twoFactorEnabled && !twoFactorSetup && (
                <div className="space-y-2">
                  <p className="text-xs text-emerald-300">
                    Two-factor authentication is currently enabled.
                  </p>
                  <input
                    type="text"
                    value={twoFactorCode}
                    onChange={(event) =>
                      setTwoFactorCode(event.target.value.replace(/[^\d\s-]/g, ""))
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    className="w-full rounded-lg border border-white/15 bg-white/8 px-3 py-2 text-xs text-white placeholder:text-white/45 tracking-[0.22em]"
                    placeholder="Enter code to disable"
                  />
                  <button
                    type="button"
                    onClick={handleDisableTwoFactor}
                    disabled={isUpdatingTwoFactor}
                    className="w-full rounded-lg border border-rose-300/35 bg-rose-500/10 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isUpdatingTwoFactor ? "Disabling..." : "Disable 2FA"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProfilePage;
