import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  addUser, deleteUser, listUsers, ManagedUser, SessionExpiredError, updateUser,
} from "../services/settingsApi";
import { AlertIcon, CheckCircleIcon, EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from "./Icons";

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
      <div className="users-head">
        <p className="muted small">
          {users ? `${users.length} user${users.length === 1 ? "" : "s"} · ${activeCount} active` : "Loading users…"}
        </p>
        {!adding && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
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
        <div className="alert error" role="alert">
          <AlertIcon size={16} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          <CheckCircleIcon size={16} />
          <span>{notice}</span>
        </div>
      )}

      {users && users.length === 0 && <p className="empty">No Users yet. Add one to let someone sign in with User access.</p>}

      {users && users.length > 0 && (
        <div className="tablewrap flat">
          <table className="data" aria-label="Users">
            <thead>
              <tr>
                <th scope="col">Login ID</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Added</th>
                <th scope="col" className="actions-cell">Actions</th>
              </tr>
            </thead>
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
          </table>
        </div>
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
    <form className="inline-form" onSubmit={submit} noValidate aria-label="Add User">
      <h3>Add User</h3>
      <div className="formgrid">
        <div className="field">
          <label htmlFor="new-user-id">User ID</label>
          <input id="new-user-id" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" autoFocus />
        </div>
        <div className="field">
          <label htmlFor="new-user-pw">Password</label>
          <input id="new-user-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="field">
          <label htmlFor="new-user-confirm">Confirm password</label>
          <input id="new-user-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
      </div>
      <p className="hint">At least 8 characters, with a letter and a number. Share it with the person privately.</p>
      {error && (
        <div className="alert error" role="alert">
          <AlertIcon size={16} />
          <span>{error}</span>
        </div>
      )}
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn" disabled={busy}>{busy ? "Adding…" : "Add User"}</button>
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

  const added = user.created_at
    ? new Date(user.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "";

  return (
    // One <tbody> per User: their row, plus the edit/reset/delete panel under it when open.
    <tbody aria-label={`User ${user.login_id}`}>
      <tr className={user.active ? undefined : "muted-row"}>
        <td><b className="mono">{user.login_id}</b></td>
        <td>User</td>
        <td><span className={`status ${user.active ? "" : "off"}`}>{user.active ? "Active" : "Inactive"}</span></td>
        <td className="nowrap">{added}</td>
        <td className="actions-cell">
          <button type="button" className="linkbtn" aria-label={`Edit ID of ${user.login_id}`} title="Edit User ID" onClick={() => open("edit")}>
            Edit
          </button>
          <button type="button" className="linkbtn" aria-label={`Reset password of ${user.login_id}`} onClick={() => open("reset")}>
            Reset password
          </button>
          <button type="button" className="linkbtn" onClick={() => run(onToggleActive)} disabled={busy}>
            {user.active ? "Deactivate" : "Activate"}
          </button>
          <button type="button" className="linkbtn danger" aria-label={`Delete ${user.login_id}`} title="Delete User" onClick={() => open("delete")}>
            Delete
          </button>
        </td>
      </tr>

      {mode && (
        <tr className="panel-row">
          <td colSpan={5}>
            {mode === "edit" && (
              <form className="row-panel" onSubmit={rename} noValidate aria-label={`Edit ID of ${user.login_id}`}>
                <div className="formgrid">
                  <div className="field">
                    <label htmlFor={`rename-${user.id}`}>New User ID</label>
                    <input id={`rename-${user.id}`} value={newId} onChange={(e) => setNewId(e.target.value)} autoFocus />
                  </div>
                </div>
                <RowError error={error} />
                <div className="actions">
                  <button type="button" className="ghost" onClick={close}>Cancel</button>
                  <button type="submit" className="btn sm" disabled={busy}>Save ID</button>
                </div>
              </form>
            )}

            {mode === "reset" && (
              <form className="row-panel" onSubmit={reset} noValidate aria-label={`Reset password of ${user.login_id}`}>
                <b>Set a new password for <span className="mono">{user.login_id}</span></b>
                <div className="formgrid">
                  <div className="field">
                    <label htmlFor={`reset-pw-${user.id}`}>New password</label>
                    <input id={`reset-pw-${user.id}`} type={showPw ? "text" : "password"} value={pw}
                           onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus />
                  </div>
                  <div className="field">
                    <label htmlFor={`reset-confirm-${user.id}`}>Confirm new password</label>
                    <input id={`reset-confirm-${user.id}`} type={showPw ? "text" : "password"} value={confirm}
                           onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                  </div>
                </div>
                <div>
                  <button type="button" className="linkbtn" aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>
                    {showPw ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />} {showPw ? "Hide password" : "Show password"}
                  </button>
                </div>
                <p className="hint">
                  The current password can't be viewed — only replaced. The new one is saved as a secure hash, and the User is
                  signed out everywhere and must use it.
                </p>
                <RowError error={error} />
                <div className="actions">
                  <button type="button" className="ghost" onClick={close}>Cancel</button>
                  <button type="submit" className="btn sm" disabled={busy}>Reset password</button>
                </div>
              </form>
            )}

            {mode === "delete" && (
              <div className="row-panel" role="group" aria-label={`Confirm delete ${user.login_id}`}>
                <p>Delete <strong>{user.login_id}</strong>? They won't be able to sign in. This can't be undone.</p>
                <div className="actions">
                  <button type="button" className="ghost" onClick={() => setMode(null)}>Cancel</button>
                  <button type="button" className="btn solid-danger sm" onClick={() => run(onDelete)} disabled={busy}>
                    <TrashIcon size={14} /> Delete User
                  </button>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </tbody>
  );
}

function RowError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      <AlertIcon size={16} />
      <span>{error}</span>
    </div>
  );
}
