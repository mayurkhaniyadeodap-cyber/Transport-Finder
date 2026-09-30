import { withBase } from "./base";
import type { Role } from "../pages/LoginPage";
import { USE_MOCK } from "./api";

// Sign-in and the Settings page. Credentials are checked by the backend against hashed accounts in
// the local SQLite file; the browser only ever keeps the role and an opaque session token.

export type SearchTypePreference = "auto" | "pincode" | "city" | "state" | "transporter";

export interface Preferences {
  default_pincode: string;
  default_search_type: SearchTypePreference;
  results_per_page: number;
}

export interface Account {
  role: Role;
  login_id: string;
}

export interface LoginResult extends Account {
  token: string;
}

export const DEFAULT_PREFERENCES: Preferences = { default_pincode: "", default_search_type: "auto", results_per_page: 50 };
export const PAGE_SIZES = [10, 25, 50, 100];

/** 401 from a settings call: the session is gone (expired, signed out, password changed elsewhere). */
export class SessionExpiredError extends Error {}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call(url: string, token: string | null, options: RequestInit = {}): Promise<any> {
  const res = await fetch(withBase(url), {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.detail ? String(body.detail) : `Server error (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return res.json();
}

// Mock mode (VITE_USE_MOCK) has no backend: keep the original demo sign-ins working there only.
const MOCK_ACCOUNTS: Record<Role, { id: string; password: string }> = {
  admin: { id: "Admin_deodap@123", password: "Admin@123" },
  user: { id: "User_deodap@123", password: "User@123" },
};

export async function login(role: Role, login_id: string, password: string): Promise<LoginResult> {
  if (USE_MOCK) {
    const m = MOCK_ACCOUNTS[role];
    if (login_id.trim() !== m.id || password !== m.password) throw new ApiError("Invalid ID or password", 401);
    return { role, login_id: m.id, token: "mock" };
  }
  return call("/api/auth/login", null, { method: "POST", body: JSON.stringify({ role, login_id, password }) });
}

export async function logout(token: string): Promise<void> {
  if (USE_MOCK) return;
  await call("/api/auth/logout", token, { method: "POST" }).catch(() => undefined);
}

/** Settings calls: a 401 becomes SessionExpiredError so the app can send the user back to login. */
async function authed(url: string, token: string, options?: RequestInit): Promise<any> {
  try {
    return await call(url, token, options);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw new SessionExpiredError(e.message);
    throw e;
  }
}

export const getAccount = (token: string): Promise<Account> => authed("/api/settings/account", token);

export const updateAccount = (
  token: string, body: { current_password: string; new_login_id?: string; new_password?: string },
): Promise<Account> => authed("/api/settings/account", token, { method: "PATCH", body: JSON.stringify(body) });

export async function getPreferences(token: string): Promise<Preferences> {
  if (USE_MOCK) return DEFAULT_PREFERENCES;
  return authed("/api/settings/preferences", token);
}

export const savePreferences = (token: string, prefs: Partial<Preferences>): Promise<Preferences> =>
  authed("/api/settings/preferences", token, { method: "PUT", body: JSON.stringify(prefs) });

// --- User Management (Admin only; the server refuses anyone else) ---

export interface ManagedUser {
  id: number;
  login_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export const listUsers = (token: string): Promise<ManagedUser[]> => authed("/api/settings/users", token);

export const addUser = (token: string, body: { login_id: string; password: string; active?: boolean }): Promise<ManagedUser> =>
  authed("/api/settings/users", token, { method: "POST", body: JSON.stringify(body) });

export const updateUser = (
  token: string, id: number, body: { login_id?: string; password?: string; active?: boolean },
): Promise<ManagedUser> => authed(`/api/settings/users/${id}`, token, { method: "PATCH", body: JSON.stringify(body) });

export const deleteUser = (token: string, id: number): Promise<void> =>
  authed(`/api/settings/users/${id}`, token, { method: "DELETE" });
