import { FormEvent, useState } from "react";
import {
  AlertIcon, ArrowRightIcon, EyeIcon, EyeOffIcon, LockIcon, PincodeIcon, ShieldIcon, TruckIcon, UserIcon,
  ZapIcon,
} from "../components/Icons";
import { TruckArt } from "../components/ui";
import { ApiError, login } from "../services/settingsApi";

export type Role = "admin" | "user";

interface Props {
  onLogin: (role: Role, token: string) => void;
}

// The ID and password are checked by the backend against the hashed accounts in the local SQLite
// file (changeable in Settings; unrelated to the RDS credentials). Only the role and a session token
// come back -- the password is never stored in the browser.

const FEATURES = [
  { icon: PincodeIcon, title: "Pan-India search", sub: "Pincode, city, state or transporter name in one box" },
  { icon: ZapIcon, title: "Fast lookups", sub: "Results in a few seconds" },
];

const ROLE_HINT: Record<Role, string> = {
  admin: "Search and manage transporters",
  user: "Search and view transporters",
};

export default function LoginPage({ onLogin }: Props) {
  const [role, setRole] = useState<Role>("admin");
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const idLabel = role === "admin" ? "Admin ID" : "User ID";
  const buttonLabel = role === "admin" ? "Login as Admin" : "Login as User";

  const switchRole = (next: Role) => {
    setRole(next);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !password.trim()) {
      setError("Enter both your ID and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const session = await login(role, id.trim(), password);
      onLogin(session.role, session.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <aside className="login-promo">
        <div>
          <div className="login-brand">
            <span className="brand-logo brand-logo-lg">
              <TruckIcon size={24} />
            </span>
            <span className="login-brand-name">Transport Finder</span>
          </div>
          <h1 className="login-headline">The right transporter for every pincode.</h1>
          <p className="login-tagline">Search by pincode, city or state, backed by real delivery history.</p>
        </div>
        <TruckArt className="login-art" />
        <ul className="login-features">
          {FEATURES.map(({ icon: Icon, title, sub }) => (
            <li key={title}>
              <span className="login-feature-icon">
                <Icon size={20} />
              </span>
              <div>
                <p className="login-feature-title">{title}</p>
                <p className="login-feature-sub">{sub}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <main className="login-main">
        <div className="login-column">
          <div className="login-mobile-brand">
            <span className="brand-logo">
              <TruckIcon size={20} />
            </span>
            <span>Transport Finder</span>
          </div>

          <div className="login-card">
            <h2>Welcome Back</h2>
            <p className="login-subtitle">Sign in to your account to continue</p>

            <div className="segmented role-tabs" role="tablist" aria-label="Login as">
              {(["admin", "user"] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={role === r}
                  className={`segmented-btn ${role === r ? "active" : ""}`}
                  onClick={() => switchRole(r)}
                >
                  {r === "admin" ? <ShieldIcon size={16} /> : <UserIcon size={16} />}
                  {r === "admin" ? "Admin Login" : "User Login"}
                </button>
              ))}
            </div>
            <p className="role-hint">{ROLE_HINT[role]}</p>

            <form onSubmit={submit} className="login-form">
              <label className="field">
                <span className="field-label">{idLabel}</span>
                <span className={`input-wrap ${error ? "invalid" : ""}`}>
                  <span className="input-icon">
                    <UserIcon size={16} />
                  </span>
                  <input value={id} onChange={(e) => setId(e.target.value)} placeholder={`Enter ${idLabel}`} autoComplete="username" />
                </span>
              </label>

              <label className="field">
                <span className="field-label">Password</span>
                <span className={`input-wrap ${error ? "invalid" : ""}`}>
                  <span className="input-icon">
                    <LockIcon size={16} />
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter Password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="input-action"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                  </button>
                </span>
              </label>

              {error && (
                <div className="alert alert-error" role="alert">
                  <AlertIcon size={16} />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitting}>
                {submitting ? "Signing in…" : buttonLabel} {!submitting && <ArrowRightIcon size={16} />}
              </button>
            </form>
          </div>

          <p className="login-footnote">
            <ShieldIcon size={14} /> Secure access for authorized users only
          </p>
        </div>
      </main>
    </div>
  );
}
