import { useState, type FormEvent } from "react";
import type { AuthResponse, LoginRequest, RegisterRequest } from "@smartpark/shared";
import { AuthApiError, login, register } from "../api/auth";
import { SubPageHeader, ScreenError } from "../components/ui";

export function AuthScreen({
  mode,
  loading,
  onSwitchMode,
  onBack,
  onAuthenticated,
}: {
  mode: "login" | "register";
  loading: boolean;
  onSwitchMode: (mode: "login" | "register") => void;
  onBack: () => void;
  onAuthenticated: (session: AuthResponse) => Promise<void> | void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === "login";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || loading) return;

    if (!email.trim() || !password) {
      setError(isLogin ? "Enter your email and password." : "Enter your email, name and password.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!isLogin && !fullName.trim()) {
      setError("Enter your full name.");
      return;
    }
    if (!isLogin && phone.trim() && !/^\+?[0-9\s-]{6,16}$/.test(phone.trim())) {
      setError("Enter a valid phone number or leave it blank.");
      return;
    }

    const input: RegisterRequest | LoginRequest = isLogin
      ? { email: email.trim().toLowerCase(), password }
      : {
          email: email.trim().toLowerCase(),
          password,
          fullName: fullName.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        };

    setSubmitting(true);
    setError("");
    try {
      const response = isLogin ? await login(input) : await register(input);
      await onAuthenticated(response);
    } catch (cause) {
      if (cause instanceof AuthApiError && cause.status === 409) {
        setError(
          isLogin
            ? "No account found for that email. Create one instead."
            : "An account with that email already exists. Sign in instead.",
        );
      } else {
        setError(cause instanceof Error ? cause.message : "Unable to authenticate right now.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sp-subpage" style={{ maxWidth: 480 }}>
      <SubPageHeader onBack={onBack} title={isLogin ? "Welcome back" : "Create your account"} />
      {loading && <ScreenError message="Checking your session..." />}

      {!loading && (
        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <p className="muted" style={{ marginBottom: 14 }}>
            {isLogin
              ? "Sign in to book parking, pay digitally and show your pass at the gate."
              : "Register to book parking across SmartPark India facilities."}
          </p>
          {!isLogin && (
            <>
              <label htmlFor="auth-name">Full name</label>
              <input
                id="auth-name"
                autoComplete="name"
                maxLength={160}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="e.g. Aarav Sharma"
                value={fullName}
              />
            </>
          )}
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            autoComplete="email"
            type="email"
            inputMode="email"
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            value={email}
          />
          {!isLogin && (
            <>
              <label htmlFor="auth-phone">
                Phone <span className="optional">(optional)</span>
              </label>
              <input
                id="auth-phone"
                autoComplete="tel"
                type="tel"
                maxLength={24}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+91 ..."
                value={phone}
              />
            </>
          )}
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            type="password"
            minLength={8}
            maxLength={128}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            value={password}
          />
          {error && <ScreenError message={error} />}
          <button className="btn" style={{ width: "100%" }} type="submit" disabled={submitting}>
            {submitting
              ? isLogin
                ? "Signing in..."
                : "Creating account..."
              : isLogin
                ? "Sign in"
                : "Create account"}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setError("");
              onSwitchMode(isLogin ? "register" : "login");
            }}
          >
            {isLogin ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </form>
      )}
    </div>
  );
}
