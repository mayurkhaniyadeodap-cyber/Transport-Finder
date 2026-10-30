import { FormEvent, useState } from "react";
import {
  AlertIcon, ArrowRightIcon, EyeIcon, EyeOffIcon, LocationPinIcon, PhoneIcon, SearchIcon, ShieldIcon, TruckIcon,
} from "../components/Icons";
import LoginMap from "../components/LoginMap";
import { ApiError, login } from "../services/settingsApi";

export type Role = "admin" | "user";

interface Props {
  onLogin: (role: Role, token: string) => void;
}

// One sign-in form for the Admin and every User: the backend finds the account by its ID, checks the
// password against the hashed accounts in the local SQLite file (changeable in Settings; unrelated
// to the RDS credentials) and says which role it is. Only the role and a session token come back --
// the password is never stored in the browser.

const FEATURES = [
  { icon: SearchIcon, title: "One search box", text: "Pincode, city, state or transporter name" },
  { icon: LocationPinIcon, title: "Real delivery history", text: "Built from DeoDap's own orders" },
  { icon: PhoneIcon, title: "Verified contacts", text: "Transporter numbers, never customer numbers" },
];

export default function LoginPage({ onLogin }: Props) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !password.trim()) {
      setError("Enter both your ID and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const session = await login(id.trim(), password);
      onLogin(session.role, session.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <main className="loginwrap">
      <section className="loginside" aria-label="About Transport Finder">
        <LoginMap />
        <div className="brand">
          <div className="brandmark" aria-hidden="true"><TruckIcon size={20} /></div>
          <div>
            <b>Transport Finder</b>
            <small>DEODAP OPERATIONS</small>
          </div>
        </div>

        <div className="loginpitch">
          <div className="eyebrow">Logistics network</div>
          <h1>The right transporter for every pincode.</h1>
          <p>See who has delivered to a location, and reach them in seconds.</p>
        </div>

        <ul className="loginfeatures">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <span className="ico"><Icon size={18} /></span>
              <span>
                <b>{title}</b>
                {text}
              </span>
            </li>
          ))}
        </ul>
        <p className="logincredit">Map: svg-maps by Victor Cazanave, simplified (CC BY 4.0). Illustration only.</p>
      </section>

      <section className="loginmain">
        <div className="panel loginpanel">
          <h2>Welcome back</h2>
          <p className="sub">Sign in to your transport network workspace.</p>

          <form className="loginform" onSubmit={submit} noValidate>
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
              {submitting ? "Signing in…" : <>Sign in <ArrowRightIcon size={16} /></>}
            </button>
          </form>
          <p className="notice">
            <ShieldIcon size={13} /> Secure access for authorised DeoDap staff only.
          </p>
        </div>
      </section>
    </main>
  );
}
