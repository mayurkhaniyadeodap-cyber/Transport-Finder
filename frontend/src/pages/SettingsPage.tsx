import { FormEvent, useEffect, useState } from "react";
import { AlertIcon, CheckCircleIcon, EyeIcon, EyeOffIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from "../components/Icons";
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

type Tab = "account" | "appearance" | "preferences" | "security" | "users";

interface Props {
  role: Role;
  token: string;
  preferences: Preferences;
  onPreferencesSaved: (p: Preferences) => void;
  onLogout: () => void;
  onSessionExpired: () => void;
  onAccountChanged?: (a: Account) => void;
}

function Status({ error, success }: { error: string | null; success: string | null }) {
  if (error) {
    return (
      <div className="alert error" role="alert">
        <AlertIcon size={16} />
        <span>{error}</span>
      </div>
    );
  }
  if (success) {
    return (
      <div className="alert success" role="status">
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

export default function SettingsPage({ role, token, preferences, onPreferencesSaved, onLogout, onSessionExpired, onAccountChanged }: Props) {
  const isAdmin = role === "admin";
  const idLabel = isAdmin ? "Admin ID" : "User ID";
  const [account, setAccount] = useState<Account | null>(null);
  const [tab, setTab] = useState<Tab>("account");

  useEffect(() => {
    getAccount(token).then(setAccount).catch((e) => {
      if (e instanceof SessionExpiredError) onSessionExpired();
    });
  }, [token, onSessionExpired]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "account", label: "Account" },
    { id: "appearance", label: "Appearance" },
    { id: "preferences", label: "Search preferences" },
    { id: "security", label: "Security" },
    ...(isAdmin ? [{ id: "users" as const, label: "User management" }] : []),
  ];
  const accountChanged = (a: Account) => {
    setAccount(a);
    onAccountChanged?.(a);
  };

  return (
    <section>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Preferences</div>
          <h1 className="h1">Settings</h1>
          <p className="sub">Manage your account and workspace experience.</p>
        </div>
      </div>

      <div className="panel">
        <div className="tabs" role="tablist" aria-label="Settings sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
                    className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="tabpanel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "account" && (
            <>
              <h3>Account details</h3>
              <p className="sub">Who you're signed in as, and your sign-in ID.</p>
              <dl className="facts">
                <div>
                  <dt>Role</dt>
                  <dd>
                    <span className="tag role-pill">{isAdmin ? "Admin" : "User"}</span>
                    <span className="muted small">{isAdmin ? "Search and manage transporters" : "Search and view transporters"}</span>
                  </dd>
                </div>
                <div>
                  <dt>Current {idLabel}</dt>
                  <dd className="mono">{account?.login_id ?? "…"}</dd>
                </div>
              </dl>
              <ChangeIdForm idLabel={idLabel} token={token} onSessionExpired={onSessionExpired} onChanged={accountChanged} />
            </>
          )}

          {tab === "appearance" && (
            <>
              <h3>Appearance</h3>
              <p className="sub">Choose how Transport Finder looks on this device. Saved in this browser.</p>
              <ThemePicker />
            </>
          )}

          {tab === "preferences" && (
            <>
              <h3>Search preferences</h3>
              <p className="sub">{isAdmin ? "Search defaults for everyone using Transport Finder." : "Search defaults, set by the Admin."}</p>
              {isAdmin
                ? <PreferencesForm token={token} preferences={preferences} onSaved={onPreferencesSaved} onSessionExpired={onSessionExpired} />
                : <PreferencesView preferences={preferences} />}
            </>
          )}

          {tab === "security" && (
            <>
              <h3>Change password</h3>
              <p className="sub">At least 8 characters, with a letter and a number.</p>
              <ChangePasswordForm token={token} onSessionExpired={onSessionExpired} />
              <div className="divider">
                <h3>Log out</h3>
                <p className="sub">End this session on this browser.</p>
                <div className="actions" style={{ justifyContent: "flex-start" }}>
                  <button type="button" className="btn danger" onClick={onLogout}>
                    <LogOutIcon size={16} /> Log out
                  </button>
                </div>
              </div>
            </>
          )}

          {tab === "users" && isAdmin && (
            <section aria-label="User Management">
              <h3>User management</h3>
              <p className="sub">Manage access to the internal directory: add Users, change their ID, reset passwords, activate, deactivate or delete.</p>
              <UserManagement token={token} onSessionExpired={onSessionExpired} />
            </section>
          )}
        </div>
      </div>
    </section>
  );
}

function PasswordInput({ id, value, onChange, autoComplete }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-wrap">
      <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
      </button>
    </span>
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
    <form onSubmit={submit} noValidate aria-label={`Change ${idLabel}`}>
      <div className="formgrid">
        <div className="field">
          <label htmlFor="new-id">New {idLabel}</label>
          <input id="new-id" value={newId} onChange={(e) => setNewId(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="id-current-pw">Current password</label>
          <PasswordInput id="id-current-pw" value={current} onChange={setCurrent} autoComplete="current-password" />
        </div>
      </div>
      <Status error={error} success={success} />
      <div className="actions">
        <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : `Change ${idLabel}`}</button>
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
    <form onSubmit={submit} noValidate aria-label="Change password">
      <div className="formgrid">
        <div className="field full">
          <label htmlFor="pw-current">Current password</label>
          <PasswordInput id="pw-current" value={current} onChange={setCurrent} autoComplete="current-password" />
        </div>
        <div className="field">
          <label htmlFor="pw-new">New password</label>
          <PasswordInput id="pw-new" value={next} onChange={setNext} autoComplete="new-password" />
        </div>
        <div className="field">
          <label htmlFor="pw-confirm">Confirm new password</label>
          <PasswordInput id="pw-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </div>
      </div>
      <Status error={error} success={success} />
      <div className="actions">
        <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
      </div>
    </form>
  );
}

function ThemePicker() {
  // Shared with the top bar's Light/Dark toggle, so the two always show the same choice.
  const { choice: theme, setTheme: choose } = useTheme();
  return (
    <div className="theme-options" role="radiogroup" aria-label="Theme">
      {THEMES.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={theme === id} className="btn secondary" onClick={() => choose(id)}>
          <Icon size={16} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function PreferencesView({ preferences }: { preferences: Preferences }) {
  return (
    <dl className="facts">
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
    <form onSubmit={submit} noValidate aria-label="Search preferences">
      <div className="formgrid">
        <div className="field">
          <label htmlFor="pref-search-type">Default search type</label>
          <select id="pref-search-type" value={searchType} aria-describedby="pref-search-type-hint"
                  onChange={(e) => setSearchType(e.target.value as SearchTypePreference)}>
            {(Object.keys(SEARCH_TYPE_LABELS) as SearchTypePreference[]).map((t) => <option key={t} value={t}>{SEARCH_TYPE_LABELS[t]}</option>)}
          </select>
          <span className="hint" id="pref-search-type-hint">How typed text is searched. A 6-digit number is always a pincode.</span>
        </div>
        <div className="field">
          <label htmlFor="pref-per-page">Results per page</label>
          <select id="pref-per-page" value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pref-pincode">Default pincode</label>
          <input id="pref-pincode" className="mono" value={pincode} onChange={(e) => setPincode(e.target.value)} inputMode="numeric"
                 maxLength={6} placeholder="e.g. 360003" aria-describedby="pref-pincode-hint" />
          <span className="hint" id="pref-pincode-hint">Pre-filled in the search box. Leave empty for none.</span>
        </div>
      </div>
      <Status error={error} success={success} />
      <div className="actions">
        <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Save preferences"}</button>
      </div>
    </form>
  );
}
