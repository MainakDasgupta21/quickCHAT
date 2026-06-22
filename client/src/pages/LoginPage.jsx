import React, { useContext, useState } from "react";
import assets from "../assets/assets";
import { AuthContext } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";

const SIGNUP_MODE = "signup";
const LOGIN_MODE = "login";

const LoginPage = () => {
  const [currState, setCurrState] = useState(SIGNUP_MODE);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassWord] = useState("");
  const [bio, setBio] = useState("");
  const [isDataSubmitted, setIsDataSubmitted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorToken, setTwoFactorToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, verifyTwoFactorLogin } = useContext(AuthContext);
  const { isRtl, locale, setLocale, t } = useLocale();

  const resetTwoFactorStep = () => {
    setRequiresTwoFactor(false);
    setTwoFactorCode("");
    setTwoFactorToken("");
  };

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    if (currState === LOGIN_MODE && requiresTwoFactor) {
      setIsSubmitting(true);
      const verified = await verifyTwoFactorLogin({
        twoFactorToken,
        code: twoFactorCode,
      });
      setIsSubmitting(false);
      if (verified) {
        resetTwoFactorStep();
      }
      return;
    }

    if (currState === SIGNUP_MODE && !isDataSubmitted) {
      setIsDataSubmitted(true);
      return;
    }

    setIsSubmitting(true);
    const result = await login(
      currState === SIGNUP_MODE ? SIGNUP_MODE : LOGIN_MODE,
      { fullName, email, password, bio }
    );
    setIsSubmitting(false);

    if (result?.requiresTwoFactor && result?.twoFactorToken) {
      setRequiresTwoFactor(true);
      setTwoFactorToken(result.twoFactorToken);
      setTwoFactorCode("");
      return;
    }

    // If signup failed (e.g. email already in use), return to the first step so
    // the user can correct their email/password instead of being stuck on bio.
    if (!result?.ok && currState === SIGNUP_MODE) {
      setIsDataSubmitted(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-10 flex items-center justify-center">
      <div className="relative w-full max-w-5xl grid lg:grid-cols-[1.1fr_1fr] gap-5 lg:gap-6 animate-fade-in">
        <div className="absolute top-2 end-2 z-20">
          <button
            type="button"
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            className="rounded-xl border border-white/18 bg-white/8 px-3 py-2 text-xs text-white/80 hover:bg-white/12"
          >
            {locale === "ar" ? t("language.arabic") : t("language.english")}
          </button>
        </div>
        <div className="hidden lg:flex glass-panel rounded-3xl p-8 flex-col justify-between min-h-[620px]">
          <div>
            <img src={assets.logo_big} alt="" className="w-52" />
            <h1 className="mt-10 text-4xl font-semibold leading-tight text-white">
              {t("loginPage.premiumHeading")}
              <span className="block text-brand-200">{t("loginPage.premiumSubheading")}</span>
            </h1>
            <p className="mt-4 text-white/70 max-w-md">{t("loginPage.marketingBody")}</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/70">
            {t("loginPage.marketingFooter")}
          </div>
        </div>

        <form
          onSubmit={onSubmitHandler}
          className="glass-panel rounded-3xl p-6 sm:p-7 lg:p-8 flex flex-col gap-5 min-h-[620px] animate-slide-up"
        >
          <div className="lg:hidden flex items-center gap-3">
            <img src={assets.logo} alt="quickchat logo" className="h-9" />
            <div>
              <p className="text-white text-sm font-medium">{t("loginPage.brandName")}</p>
              <p className="text-white/60 text-xs">{t("loginPage.brandSubtitle")}</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-2xl text-white">
                {requiresTwoFactor
                  ? t("loginPage.twoFactorTitle")
                  : currState === SIGNUP_MODE
                  ? t("loginPage.signupTitle")
                  : t("loginPage.loginTitle")}
              </h2>
              {(isDataSubmitted || requiresTwoFactor) && (
                <button
                  type="button"
                  onClick={() => {
                    if (requiresTwoFactor) {
                      resetTwoFactorStep();
                      return;
                    }
                    setIsDataSubmitted(false);
                  }}
                  className="h-9 w-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center"
                  aria-label={
                    requiresTwoFactor
                      ? t("loginPage.backToLoginAria")
                      : t("loginPage.backToAccountDetailsAria")
                  }
                >
                  <img
                    src={assets.arrow_icon}
                    alt=""
                    className={`w-5 ${isRtl ? "rotate-180" : ""}`}
                  />
                </button>
              )}
            </div>
            <p className="text-white/65 text-sm mt-2">
              {requiresTwoFactor
                ? t("loginPage.twoFactorIntro", { email })
                : currState === SIGNUP_MODE
                ? t("loginPage.signupIntro")
                : t("loginPage.loginIntro")}
            </p>
          </div>

          <div className="space-y-3.5">
            {currState === SIGNUP_MODE && !isDataSubmitted && (
              <div className="relative">
                <label htmlFor="signup-full-name" className="sr-only">
                  {t("loginPage.fullName")}
                </label>
                <span
                  className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-white/45 ${
                    isRtl ? "right-3" : "left-3"
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 12c2.761 0 5-2.462 5-5.5S14.761 1 12 1 7 3.462 7 6.5 9.239 12 12 12zm0 2c-4.418 0-8 2.91-8 6.5V23h16v-2.5c0-3.59-3.582-6.5-8-6.5z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                <input
                  id="signup-full-name"
                  onChange={(e) => setFullName(e.target.value)}
                  value={fullName}
                  placeholder={t("loginPage.fullNamePlaceholder")}
                  type="text"
                  className={`w-full py-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45 ${
                    isRtl ? "pr-10 pl-3" : "pl-10 pr-3"
                  }`}
                  required
                />
              </div>
            )}

            {!requiresTwoFactor && !isDataSubmitted && (
              <>
                <div className="relative">
                  <label htmlFor="auth-email" className="sr-only">
                    {t("loginPage.emailAddress")}
                  </label>
                  <span
                    className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-white/45 ${
                      isRtl ? "right-3" : "left-3"
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13zm2.75.5 6.25 4.688L18.25 6h-12.5zm12.75 1.25-6.05 4.537a.75.75 0 0 1-.9 0L5.5 7.25V18.5c0 .276.224.5.5.5h12a.5.5 0 0 0 .5-.5V7.25z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <input
                    id="auth-email"
                    onChange={(e) => setEmail(e.target.value)}
                    value={email}
                    type="email"
                    placeholder={t("loginPage.emailPlaceholder")}
                    required
                    className={`w-full py-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45 ${
                      isRtl ? "pr-10 pl-3" : "pl-10 pr-3"
                    }`}
                  />
                </div>

                <div className="relative">
                  <label htmlFor="auth-password" className="sr-only">
                    {t("loginPage.password")}
                  </label>
                  <span
                    className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-white/45 ${
                      isRtl ? "right-3" : "left-3"
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M17 9h-1V7a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7-2a2 2 0 1 1 4 0v2h-4V7zm7 12H7v-8h10v8z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <input
                    id="auth-password"
                    onChange={(e) => setPassWord(e.target.value)}
                    value={password}
                    type={showPassword ? "text" : "password"}
                    placeholder={t("loginPage.passwordPlaceholder")}
                    required
                    className={`w-full py-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45 ${
                      isRtl ? "pr-10 pl-16" : "pl-10 pr-16"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className={`absolute top-1/2 -translate-y-1/2 text-xs text-white/60 hover:text-white ${
                      isRtl ? "left-3" : "right-3"
                    }`}
                    aria-label={
                      showPassword
                        ? t("loginPage.hidePasswordAria")
                        : t("loginPage.showPasswordAria")
                    }
                  >
                    {showPassword ? t("loginPage.hide") : t("loginPage.show")}
                  </button>
                </div>
              </>
            )}

            {currState === LOGIN_MODE && requiresTwoFactor && (
              <div className="space-y-2">
                <label htmlFor="login-two-factor-code" className="sr-only">
                  {t("loginPage.twoFactorCode")}
                </label>
                <input
                  id="login-two-factor-code"
                  onChange={(e) =>
                    setTwoFactorCode(e.target.value.replace(/[^\d\s-]/g, ""))
                  }
                  value={twoFactorCode}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder={t("loginPage.twoFactorCodePlaceholder")}
                  className="w-full py-3 px-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45 tracking-[0.28em] text-center"
                  required
                />
                <p className="text-xs text-white/55">
                  {t("loginPage.twoFactorHint")}
                </p>
              </div>
            )}

            {currState === SIGNUP_MODE && isDataSubmitted && (
              <div>
                <label htmlFor="signup-bio" className="sr-only">
                  {t("loginPage.bio")}
                </label>
                <textarea
                  id="signup-bio"
                  onChange={(e) => setBio(e.target.value)}
                  value={bio}
                  rows={5}
                  className="w-full p-3 rounded-xl bg-white/8 border border-white/15 text-sm text-white placeholder:text-white/45"
                  placeholder={t("loginPage.bioPlaceholder")}
                />
              </div>
            )}
          </div>

          {currState === SIGNUP_MODE && (
            <label
              htmlFor="terms-consent"
              className="flex items-center gap-2 text-sm text-white/65"
            >
              <input
                id="terms-consent"
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-white/10 accent-brand-400"
                required
              />
              {t("loginPage.agreeTerms")}
            </label>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-gradient rounded-xl py-3.5 text-sm font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            aria-busy={isSubmitting}
          >
            {isSubmitting
              ? t("loginPage.pleaseWait")
              : requiresTwoFactor
                ? t("loginPage.verifyCode")
                : currState === SIGNUP_MODE
                ? isDataSubmitted
                  ? t("loginPage.completeSignup")
                  : t("loginPage.continue")
                : t("loginPage.loginNow")}
          </button>

          <div className="mt-auto pt-2 text-sm text-white/65">
            {currState === SIGNUP_MODE ? (
              <p>
                {t("loginPage.alreadyHaveAccount")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setCurrState(LOGIN_MODE);
                    setIsDataSubmitted(false);
                    resetTwoFactorStep();
                  }}
                  className="font-medium text-brand-200 hover:text-brand-100 cursor-pointer"
                >
                  {t("loginPage.loginHere")}
                </button>
              </p>
            ) : requiresTwoFactor ? (
              <p>
                {t("loginPage.codeNotForYou")}{" "}
                <button
                  type="button"
                  onClick={resetTwoFactorStep}
                  className="font-medium text-brand-200 hover:text-brand-100 cursor-pointer"
                >
                  {t("loginPage.useAnotherAccount")}
                </button>
              </p>
            ) : (
              <p>
                {t("loginPage.newToQuickChat")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setCurrState(SIGNUP_MODE);
                    resetTwoFactorStep();
                  }}
                  className="font-medium text-brand-200 hover:text-brand-100 cursor-pointer"
                >
                  {t("loginPage.createAccount")}
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
