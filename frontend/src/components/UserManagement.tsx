import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  addUser, deleteUser, listUsers, ManagedUser, SessionExpiredError, updateUser,
} from "../services/settingsApi";
import { AlertIcon, CheckCircleIcon, EyeIcon, EyeOffIcon, PencilIcon, PlusIcon, RotateCcwIcon, TrashIcon } from "./Icons";

// Admin-only (the server refuses anyone else): add Users, change a User's ID, reset a password,
// activate/deactivate, delete. Passwords go only to the API, which stores a hash.

interface Props {
  token: string;
  onSessionExpired: () => void;
}

type RowMode = "edit" | "reset" | "delete" | null;

function checkPassword(pw: string, confirm: string): string | null {
  if (pw.length < 8) return "The password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "The password must contain at least one letter and one number.";
  if (pw !== confirm) return "The passwords don't match.";
  return null;
}

function checkId(id: string): string | null {
  if (!id.trim()) return "Enter a User ID.";
  if (/\s/.test(id.trim())) return "The User ID can't contain spaces.";
  return null;
}

export default function UserManagement({ token, onSessionExpired }: Props) {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Every request goes through here: an expired session signs out, anything else shows its message.
  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SessionExpiredError) onSessionExpired();
      else setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      return undefined;
    }
  }, [onSessionExpired]);

  const reload = useCallback(async () => {
    const list = await guard(() => listUsers(token));
    if (list) setUsers(list);
  }, [guard, token]);

  useEffect(() => {
    reload();
  }, [reload]);

  const done = async (message: string) => {
    await reload();
    setNotice(message);
  };

  const activeCount = users?.filter((u) => u.active).length ?? 0;

  return (
    <div className="user-mgmt">
      <div className="user-mgmt-head">
        <p className="muted small">
          {users ? `${users.length} user${users.length === 1 ? "" : "s"} · ${activeCount} active` : "Loading users…"}
        </p>
        {!adding && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            <PlusIcon size={14} /> Add User
          </button>
        )}
      </div>

      {adding && (
        <AddUserForm
          onCancel={() => setAdding(false)}
          onSubmit={async (login_id, password) => {
            const created = await guard(() => addUser(token, { login_id, password }));
            if (!created) return false;
            setAdding(false);
            await done(`User "${created.login_id}" added.`);
            return true;
          }}
        />
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          <AlertIcon size={16} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="alert alert-success" role="status">
          <CheckCircleIcon size={16} />
          <span>{notice}</span>
        </div>
      )}

      {users && users.length === 0 && <p className="user-empty">No Users yet. Add one to let someone sign in with User access.</p>}

      {users && users.length > 0 && (
        <ul className="user-list" aria-label="Users">
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              onRename={async (login_id) => {
                const r = await guard(() => updateUser(token, u.id, { login_id }));
                if (r) await done(`User ID changed to "${r.login_id}".`);
                return Boolean(r);
              }}
              onReset={async (password) => {
                const r = await guard(() => updateUser(token, u.id, { password }));
                if (r) await done(`Password reset for "${u.login_id}". They've been signed out and must use the new password.`);
                return Boolean(r);
              }}
              onToggleActive={async () => {
                const r = await guard(() => updateUser(token, u.id, { active: !u.active }));
                if (r) await done(r.active ? `"${u.login_id}" activated.` : `"${u.login_id}" deactivated and signed out.`);
              }}
              onDelete={async () => {
                const r = await guard(async () => {
                  await deleteUser(token, u.id);
                  return true;
                });
                if (r) await done(`User "${u.login_id}" deleted.`);
                return Boolean(r);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddUserForm({ onSubmit, onCancel }: { onSubmit: (id: string, pw: string) => Promise<boolean>; onCancel: () => void }) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = checkId(id) ?? checkPassword(pw, confirm);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    await onSubmit(id.trim(), pw);
    setBusy(false);
  };

  return (
    <form className="user-form card-inset" onSubmit={submit} noValidate aria-label="Add User">
      <p className="settings-form-title">Add User</p>
      <div className="form-grid form-grid-3">
        <label className="field">
          <span className="field-label">User ID</span>
          <input className="edit-input" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input className="edit-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="field">
          <span className="field-label">Confirm password</span>
          <input className="edit-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
      </div>
      <p className="hint">At least 8 characters, with a letter and a number. Share it with the person privately.</p>
      {error && (
        <div className="alert alert-error" role="alert">
          <AlertIcon size={16} />
          <span>{error}</span>
        </div>
      )}
      <div className="settings-actions user-form-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? "Adding…" : "Add User"}</button>
      </div>
    </form>
  );
}

function UserRow({ user, onRename, onReset, onToggleActive, onDelete }: {
  user: ManagedUser;
  onRename: (id: string) => Promise<boolean>;
  onReset: (pw: string) => Promise<boolean>;
  onToggleActive: () => Promise<void>;
  onDelete: () => Promise<boolean>;
}) {
  const [mode, setMode] = useState<RowMode>(null);
  const [newId, setNewId] = useState(user.login_id);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const open = (m: RowMode) => {
    setMode(m);
    setError(null);
    setNewId(user.login_id);
    setPw("");
    setConfirm("");
    setShowPw(false);
  };

  // Closing (after a save, or Cancel) also drops the typed password -- it's never kept or shown again.
  const close = () => open(null);

  const run = async (fn: () => Promise<boolean | void>) => {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok !== false) close();
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    const problem = checkId(newId);
    if (problem) return setError(problem);
    if (newId.trim() === user.login_id) return setMode(null);
    run(() => onRename(newId.trim()));
  };

  const reset = (e: FormEvent) => {
    e.preventDefault();
    const problem = checkPassword(pw, confirm);
    if (problem) return setError(problem);
    run(() => onReset(pw));
  };

  return (
    <li className={`user-row ${user.active ? "" : "is-inactive"}`} aria-label={`User ${user.login_id}`}>
      <div className="user-row-main">
        <div className="user-row-id">
          <span className="mono user-login">{user.login_id}</span>
          <span className={`badge ${user.active ? "badge-active" : "badge-inactive"}`}>{user.active ? "Active" : "Inactive"}</span>
        </div>
        <div className="user-row-actions">
          <button type="button" className="icon-btn" aria-label={`Edit ID of ${user.login_id}`} title="Edit User ID" onClick={() => open("edit")}>
            <PencilIcon size={16} />
          </button>
          <button type="button" className="btn btn-outline btn-sm" aria-label={`Reset password of ${user.login_id}`} onClick={() => open("reset")}>
            <RotateCcwIcon size={14} /> Reset Password
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => run(onToggleActive)} disabled={busy}>
            {user.active ? "Deactivate" : "Activate"}
          </button>
          <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${user.login_id}`} title="Delete User" onClick={() => open("delete")}>
            <TrashIcon size={16} />
          </button>
        </div>
      </div>

      {mode === "edit" && (
        <form className="user-row-panel" onSubmit={rename} noValidate aria-label={`Edit ID of ${user.login_id}`}>
          <label className="field">
            <span className="field-label">New User ID</span>
            <input className="edit-input" value={newId} onChange={(e) => setNewId(e.target.value)} autoFocus />
          </label>
          <RowError error={error} />
          <div className="user-form-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={close}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Save ID</button>
          </div>
        </form>
      )}

      {mode === "reset" && (
        <form className="user-row-panel" onSubmit={reset} noValidate aria-label={`Reset password of ${user.login_id}`}>
          <p className="settings-form-title user-reset-title">Set a new password for <span className="mono">{user.login_id}</span></p>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">New password</span>
              <input className="edit-input" type={showPw ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)}
                     autoComplete="new-password" autoFocus />
            </label>
            <label className="field">
              <span className="field-label">Confirm new password</span>
              <input className="edit-input" type={showPw ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                     autoComplete="new-password" />
            </label>
          </div>
          <button type="button" className="link-btn show-pw-toggle" aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>
            {showPw ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />} {showPw ? "Hide password" : "Show password"}
          </button>
          <p className="hint">
            The current password can't be viewed — only replaced. The new one is saved as a secure hash, and the User is
            signed out everywhere and must use it.
          </p>
          <RowError error={error} />
          <div className="user-form-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={close}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Reset password</button>
          </div>
        </form>
      )}

      {mode === "delete" && (
        <div className="user-row-panel user-row-confirm" role="group" aria-label={`Confirm delete ${user.login_id}`}>
          <p>Delete <strong>{user.login_id}</strong>? They won't be able to sign in. This can't be undone.</p>
          <div className="user-form-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setMode(null)}>Cancel</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => run(onDelete)} disabled={busy}>
              <TrashIcon size={14} /> Delete User
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function RowError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <AlertIcon size={16} />
      <span>{error}</span>
    </div>
  );
}
