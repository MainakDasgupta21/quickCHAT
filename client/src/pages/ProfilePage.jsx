import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import assets from "../assets/assets";
import { AuthContext } from "../../context/AuthContext";

const ProfilePage = () => {
  const { authUser, updateProfile } = useContext(AuthContext);

  const [selectedImg, setSelectedImg] = useState(null);
  const [name, setName] = useState(authUser?.fullName ?? "");
  const [bio, setBio] = useState(authUser?.bio ?? "");
  const [previewUrl, setPreviewUrl] = useState(
    authUser?.profilePic || assets.avatar_icon
  );
  const [isSaving, setIsSaving] = useState(false);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    if (!selectedImg) {
      await updateProfile({ fullName: name, bio });
      setIsSaving(false);
      navigate("/");
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(selectedImg);
    reader.onload = async () => {
      const base64Image = reader.result;
      await updateProfile({ profilePic: base64Image, fullName: name, bio });
      setIsSaving(false);
      navigate("/");
    };
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
            >
              <div className="relative h-11 w-11 rounded-full overflow-hidden border border-white/20">
                <img src={previewUrl} alt="" className="h-full w-full object-cover" />
              </div>
              <div>
                <p className="text-sm text-white">Upload profile image</p>
                <p className="text-xs text-white/55">PNG or JPG up to 4MB</p>
              </div>
              <div className="ml-auto text-white/65 text-xs border border-white/15 rounded-lg px-2 py-1">
                Change
              </div>
              <input
                onChange={(e) => setSelectedImg(e.target.files[0])}
                type="file"
                id="avatar"
                accept=".png,.jpg,.jpeg"
                hidden
              />
            </label>

            <div className="space-y-1.5">
              <p className="text-sm text-white/75">Display Name</p>
              <input
                onChange={(e) => setName(e.target.value)}
                value={name}
                type="text"
                placeholder="Your name"
                className="w-full p-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45"
                required
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm text-white/75">Bio</p>
              <textarea
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
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProfilePage;
