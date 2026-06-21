import React, { useContext, useState } from "react";
import assets from "../assets/assets";
import { AuthContext } from "../../context/AuthContext";

const LoginPage = () => {
  const [currState, setCurrState] = useState("Sign Up");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassWord] = useState("");
  const [bio, setBio] = useState("");
  const [isDataSubmitted, setIsDataSubmitted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useContext(AuthContext);

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    if (currState === "Sign Up" && !isDataSubmitted) {
      setIsDataSubmitted(true);
      return;
    }

    setIsSubmitting(true);
    await login(currState === "Sign Up" ? "signup" : "login", {
      fullName,
      email,
      password,
      bio,
    });
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-10 flex items-center justify-center">
      <div className="w-full max-w-5xl grid lg:grid-cols-[1.1fr_1fr] gap-5 lg:gap-6 animate-fade-in">
        <div className="hidden lg:flex glass-panel rounded-3xl p-8 flex-col justify-between min-h-[620px]">
          <div>
            <img src={assets.logo_big} alt="" className="w-52" />
            <h1 className="mt-10 text-4xl font-semibold leading-tight text-white">
              Premium
              <span className="block text-brand-200">messaging experience</span>
            </h1>
            <p className="mt-4 text-white/70 max-w-md">
              quickCHAT keeps every conversation instant, elegant and easy to
              manage with your team and friends.
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/70">
            Secure login, real-time conversations, and a refined interface from
            first click.
          </div>
        </div>

        <form
          onSubmit={onSubmitHandler}
          className="glass-panel rounded-3xl p-6 sm:p-7 lg:p-8 flex flex-col gap-5 min-h-[620px] animate-slide-up"
        >
          <div className="lg:hidden flex items-center gap-3">
            <img src={assets.logo} alt="quickchat logo" className="h-9" />
            <div>
              <p className="text-white text-sm font-medium">quickCHAT</p>
              <p className="text-white/60 text-xs">Premium messaging</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-2xl text-white">{currState}</h2>
              {isDataSubmitted && (
                <button
                  type="button"
                  onClick={() => setIsDataSubmitted(false)}
                  className="h-9 w-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center"
                >
                  <img src={assets.arrow_icon} alt="" className="w-5" />
                </button>
              )}
            </div>
            <p className="text-white/65 text-sm mt-2">
              {currState === "Sign Up"
                ? "Create your premium quickCHAT account."
                : "Welcome back, sign in to continue chatting."}
            </p>
          </div>

          <div className="space-y-3.5">
            {currState === "Sign Up" && !isDataSubmitted && (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 12c2.761 0 5-2.462 5-5.5S14.761 1 12 1 7 3.462 7 6.5 9.239 12 12 12zm0 2c-4.418 0-8 2.91-8 6.5V23h16v-2.5c0-3.59-3.582-6.5-8-6.5z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                <input
                  onChange={(e) => setFullName(e.target.value)}
                  value={fullName}
                  placeholder="Full Name"
                  type="text"
                  className="w-full pl-10 pr-3 py-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45"
                  required
                />
              </div>
            )}

            {!isDataSubmitted && (
              <>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13zm2.75.5 6.25 4.688L18.25 6h-12.5zm12.75 1.25-6.05 4.537a.75.75 0 0 1-.9 0L5.5 7.25V18.5c0 .276.224.5.5.5h12a.5.5 0 0 0 .5-.5V7.25z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <input
                    onChange={(e) => setEmail(e.target.value)}
                    value={email}
                    type="email"
                    placeholder="Email Address"
                    required
                    className="w-full pl-10 pr-3 py-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45"
                  />
                </div>

                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M17 9h-1V7a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7-2a2 2 0 1 1 4 0v2h-4V7zm7 12H7v-8h10v8z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <input
                    onChange={(e) => setPassWord(e.target.value)}
                    value={password}
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    required
                    className="w-full pl-10 pr-16 py-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/60 hover:text-white"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </>
            )}

            {currState === "Sign Up" && isDataSubmitted && (
              <textarea
                onChange={(e) => setBio(e.target.value)}
                value={bio}
                rows={5}
                className="w-full p-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45"
                placeholder="Tell us about yourself..."
              />
            )}
          </div>

          {currState === "Sign Up" && (
            <label className="flex items-center gap-2 text-sm text-white/65">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-white/10 accent-brand-400"
                required
              />
              Agree to the terms of use and privacy policy
            </label>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-gradient rounded-xl py-3.5 text-sm font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? "Please wait..."
              : currState === "Sign Up"
                ? isDataSubmitted
                  ? "Complete Signup"
                  : "Continue"
                : "Login Now"}
          </button>

          <div className="mt-auto pt-2 text-sm text-white/65">
            {currState === "Sign Up" ? (
              <p>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setCurrState("Login");
                    setIsDataSubmitted(false);
                  }}
                  className="font-medium text-brand-200 hover:text-brand-100 cursor-pointer"
                >
                  Login here
                </button>
              </p>
            ) : (
              <p>
                New to quickCHAT?{" "}
                <button
                  type="button"
                  onClick={() => setCurrState("Sign Up")}
                  className="font-medium text-brand-200 hover:text-brand-100 cursor-pointer"
                >
                  Create account
                </button>
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
