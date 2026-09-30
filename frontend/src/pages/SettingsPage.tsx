import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
  AlertIcon, CheckCircleIcon, LockIcon, LogOutIcon, MonitorIcon, MoonIcon, ShieldIcon, SlidersIcon, SunIcon, UserIcon, UsersIcon,
} from "../components/Icons";
import UserManagement from "../components/UserManagement";
import {
  Account, getAccount, PAGE_SIZES, Preferences, savePreferences, SearchTypePreference, SessionExpiredError, updateAccount,
} from "../services/settingsApi";
import { ThemeChoice, useTheme } from "../theme";
import type { Role } from "./LoginPage";

const SEARCH_TYPE_LABELS: Record<SearchTypePreference, string> = {
  auto: "Automatic (pincode, city, state, then transporter)",
  pincode: "Pincode",
  city: "City",
  state: "State",
  transporter: "Transporter name",
};

const THEMES: { id: ThemeChoice; label: string; icon: typeof SunIcon }[] = [
  { id: "light", label: "Light", icon: SunIcon },
  { id: "dark", label: "Dark", icon: MoonIcon },
  { id: "system", label: "System", icon: MonitorIcon },
];

interface Props {
  role: Role;
  token: string;
  preferences: Preferences;
  onPreferencesSaved: (p: Preferences) => void;
  onLogout: () => void;
  onSessionExpired: () => void;
}

function Section({ id, icon, title, sub, children }: { id: string; icon: ReactNode; title: string; sub: string; children: ReactNode }) {
  return (
    <section className="card settings-section" id={id} aria-labelledby={`${id}-title`}>
      <header className="settings-section-head">
        <span className="tile-icon tone-blue">{icon}</span>
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          <p>{sub}</p>
        </div>
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function Status({ error, success }: { error: string | null; success: string | null }) {
  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <AlertIcon size={16} />
        <span>{error}</span>
      </div>
    );
  }
  if (success) {
    return (
      <div className="alert alert-success" role="status">
        <CheckCircleIcon size={16} />
        <span>{success}</span>
      </div>
    );
  }
  return null;
}

/** Runs a settings request, turning an expired session into a sign-out and other errors into text. */
function useSubmit(onSessionExpired: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      setSuccess(await fn());
    } catch (e) {
      if (e instanceof SessionExpiredError) return onSessionExpired();
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, success, run, setError };
}

export default function SettingsPage({ role, token, preferences, onPreferencesSaved, onLogout, onSessionExpired }: Props) {
  const isAdmin = role === "admin";
  const idLabel = isAdmin ? "Admin ID" : "User ID";
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    getAccount(token).then(setAccount).catch((e) => {
      if (e instanceof SessionExpiredError) onSessionExpired();
    });
  }, [token, onSessionExpired]);

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h2>Settings</h2>
          <p>Your account, appearance, search preferences and security.</p>
        </div>
      </div>

      <div className="settings-grid">
        <Section id="account" icon={<UserIcon size={20} />} title="Account" sub="Who you're signed in as, and your sign-in ID.">
          <dl className="settings-facts">
            <div>
              <dt>Signed in as</dt>
              <dd>
                <span className={`role-pill ${isAdmin ? "role-admin" : "role-user"}`}>{isAdmin ? "Admin" : "User"}</span>
                <span className="muted small">{isAdmin ? "Search and manage transporters" : "Search and view transporters"}</span>
              </dd>
            </div>
            <div>
              <dt>Current {idLabel}</dt>
              <dd className="mono">{account?.login_id ?? "…"}</dd>
            </div>
          </dl>
          <ChangeIdForm idLabel={idLabel} token={token} onSessionExpired={onSessionExpired} onChanged={setAccount} />
        </Section>

        {isAdmin && (
          <Section id="users" icon={<UsersIcon size={20} />} title="User Management"
                   sub="Admin only. Add Users, change their ID, reset passwords, activate, deactivate or delete.">
            <UserManagement token={token} onSessionExpired={onSessionExpired} />
          </Section>
        )}

        <Section id="appearance" icon={<SunIcon size={20} />} title="Appearance" sub="Saved in this browser and kept after a restart.">
          <ThemePicker />
        </Section>

        <Section id="preferences" icon={<SlidersIcon size={20} />} title="Preferences"
                 sub={isAdmin ? "Search defaults for everyone using Transport Finder." : "Search defaults, set by the Admin."}>
          {isAdmin
            ? <PreferencesForm token={token} preferences={preferences} onSaved={onPreferencesSaved} onSessionExpired={onSessionExpired} />
            : <PreferencesView preferences={preferences} />}
        </Section>

        <Section id="security" icon={<ShieldIcon size={20} />} title="Security" sub="Change your password or sign out.">
          <ChangePasswordForm token={token} onSessionExpired={onSessionExpired} />
          <div className="settings-divider" />
          <div className="settings-row">
            <div>
              <p className="settings-row-title">Log out</p>
              <p className="hint">End this session on this browser.</p>
            </div>
            <button type="button" className="btn btn-outline" onClick={onLogout}>
              <LogOutIcon size={16} /> Log out
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function ChangeIdForm({ idLabel, token, onSessionExpired, onChanged }: {
  idLabel: string; token: string; onSessionExpired: () => void; onChanged: (a: Account) => void;
}) {
  const [newId, setNewId] = useState("");
  const [current, setCurrent] = useState("");
  const { busy, error, success, run, setError } = useSubmit(onSessionExpired);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!newId.trim()) return setError(`Enter a new ${idLabel}.`);
    if (/\s/.test(newId.trim())) return setError(`The ${idLabel} can't contain spaces.`);
    if (!current) return setError("Enter your current password to confirm.");
    run(async () => {
      const acct = await updateAccount(token, { current_password: current, new_login_id: newId.trim() });
      onChanged(acct);
      setNewId("");
      setCurrent("");
      return `${idLabel} changed. Use the new ID next time you sign in.`;
    });
  };

  return (
    <form className="settings-form" onSubmit={submit} noValidate aria-label={`Change ${idLabel}`}>
      <p className="settings-form-title">Change {idLabel}</p>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">New {idLabel}</span>
          <input className="edit-input" value={newId} onChange={(e) => setNewId(e.target.value)} autoComplete="username" />
        </label>
        <label className="field">
          <span className="field-label">Current password</span>
          <input className="edit-input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
      </div>
      <Status error={error} success={success} />
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : `Change ${idLabel}`}</button>
      </div>
    </form>
  );
}

function ChangePasswordForm({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, success, run, setError } = useSubmit(onSessionExpired);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!current) return setError("Enter your current password.");
    if (next.length < 8) return setError("The new password must be at least 8 characters.");
    if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return setError("The new password must contain at least one letter and one number.");
    if (next !== confirm) return setError("The new passwords don't match.");
    run(async () => {
      await updateAccount(token, { current_password: current, new_password: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      return "Password changed. Other signed-in sessions for this account were signed out.";
    });
  };

  return (
    <form className="settings-form" onSubmit={submit} noValidate aria-label="Change password">
      <p className="settings-form-title">
        <LockIcon size={16} /> Change password
      </p>
      <div className="form-stack">
        <label className="field">
          <span className="field-label">Current password</span>
          <input className="edit-input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">New password</span>
            <input className="edit-input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="field">
            <span className="field-label">Confirm new password</span>
            <input className="edit-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
        </div>
        <p className="hint">At least 8 characters, with a letter and a number.</p>
      </div>
      <Status error={error} success={success} />
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
      </div>
    </form>
  );
}

function ThemePicker() {
  // Shared with the sidebar's Light/Dark toggle, so the two always show the same choice.
  const { choice: theme, setTheme: choose } = useTheme();
  return (
    <div className="theme-options" role="radiogroup" aria-label="Theme">
      {THEMES.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={theme === id}
                className={`theme-option ${theme === id ? "active" : ""}`} onClick={() => choose(id)}>
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function PreferencesView({ preferences }: { preferences: Preferences }) {
  return (
    <dl className="settings-facts">
      <div>
        <dt>Default pincode</dt>
        <dd>{preferences.default_pincode || <span className="na">None</span>}</dd>
      </div>
      <div>
        <dt>Default search type</dt>
        <dd>{SEARCH_TYPE_LABELS[preferences.default_search_type]}</dd>
      </div>
      <div>
        <dt>Results per page</dt>
        <dd>{preferences.results_per_page}</dd>
      </div>
    </dl>
  );
}

function PreferencesForm({ token, preferences, onSaved, onSessionExpired }: {
  token: string; preferences: Preferences; onSaved: (p: Preferences) => void; onSessionExpired: () => void;
}) {
  const [pincode, setPincode] = useState(preferences.default_pincode);
  const [searchType, setSearchType] = useState<SearchTypePreference>(preferences.default_search_type);
  const [perPage, setPerPage] = useState(preferences.results_per_page);
  const { busy, error, success, run, setError } = useSubmit(onSessionExpired);

  useEffect(() => {
    setPincode(preferences.default_pincode);
    setSearchType(preferences.default_search_type);
    setPerPage(preferences.results_per_page);
  }, [preferences]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pincode.trim() && !/^\d{6}$/.test(pincode.trim())) return setError("Default pincode must be 6 digits, or empty for none.");
    run(async () => {
      onSaved(await savePreferences(token, { default_pincode: pincode.trim(), default_search_type: searchType, results_per_page: perPage }));
      return "Preferences saved.";
    });
  };

  return (
    <form className="settings-form" onSubmit={submit} noValidate aria-label="Search preferences">
      <div className="form-grid">
        <div className="field">
          <label className="field-label" htmlFor="pref-pincode">Default pincode</label>
          <input id="pref-pincode" className="edit-input mono" value={pincode} onChange={(e) => setPincode(e.target.value)} inputMode="numeric"
                 maxLength={6} placeholder="e.g. 360003" aria-describedby="pref-pincode-hint" />
          <span className="hint" id="pref-pincode-hint">Pre-filled in the search box. Leave empty for none.</span>
        </div>
        <label className="field">
          <span className="field-label">Results per page</span>
          <select className="edit-input" value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="pref-search-type">Default search type</label>
        <select id="pref-search-type" className="edit-input" value={searchType} aria-describedby="pref-search-type-hint"
                onChange={(e) => setSearchType(e.target.value as SearchTypePreference)}>
          {(Object.keys(SEARCH_TYPE_LABELS) as SearchTypePreference[]).map((t) => <option key={t} value={t}>{SEARCH_TYPE_LABELS[t]}</option>)}
        </select>
        <span className="hint" id="pref-search-type-hint">How typed text is searched. A 6-digit number is always a pincode, and picking a suggestion always uses its own type.</span>
      </div>
      <Status error={error} success={success} />
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save preferences"}</button>
      </div>
    </form>
  );
}
