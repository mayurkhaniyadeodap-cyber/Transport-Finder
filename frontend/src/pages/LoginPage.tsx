import { FormEvent, useState } from "react";
import { AlertIcon, ArrowRightIcon, EyeIcon, EyeOffIcon, ShieldIcon, TruckIcon, UserIcon } from "../components/Icons";
import { ApiError, login } from "../services/settingsApi";

export type Role = "admin" | "user";

interface Props {
  onLogin: (role: Role, token: string) => void;
}

// The ID and password are checked by the backend against the hashed accounts in the local SQLite
// file (changeable in Settings; unrelated to the RDS credentials). Only the role and a session token
// come back -- the password is never stored in the browser.

export default function LoginPage({ onLogin }: Props) {
  const [role, setRole] = useState<Role>("admin");
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    <main className="loginwrap">
      <div className="panel loginpanel">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brandmark" aria-hidden="true"><TruckIcon size={20} /></div>
          <div>
            <b>Transport Finder</b>
            <small>DEODAP OPERATIONS</small>
          </div>
        </div>
        <h2>Welcome back</h2>
        <p className="sub">Sign in to your transport network workspace.</p>

        <div className="role" role="tablist" aria-label="Sign in as">
          {(["admin", "user"] as Role[]).map((r) => (
            <button key={r} type="button" role="tab" aria-selected={role === r} className={role === r ? "active" : ""} onClick={() => switchRole(r)}>
              {r === "admin" ? <ShieldIcon size={15} /> : <UserIcon size={15} />}
              {r === "admin" ? "Admin" : "User"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="login-id">Login ID</label>
            <input id="login-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="Enter your login ID" autoComplete="username"
                   aria-invalid={Boolean(error)} />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <span className="pw-wrap">
              <input id="login-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                     placeholder="Enter password" autoComplete="current-password" aria-invalid={Boolean(error)} />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </span>
          </div>

          {error && (
            <div className="alert error" role="alert">
              <AlertIcon size={16} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? "Signing in…" : <>Sign in as {role === "admin" ? "Admin" : "User"} <ArrowRightIcon size={16} /></>}
          </button>
        </form>
        <p className="notice">
          <ShieldIcon size={13} /> Secure access for authorised DeoDap staff only. Admin can search and manage transporters; User can search.
        </p>
      </div>
    </main>
  );
}
