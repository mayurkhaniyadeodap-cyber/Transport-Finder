import type { Role } from "./pages/LoginPage";

// Persists only the logged-in role and its opaque session token across a page refresh -- never the
// password. Uses sessionStorage (not localStorage) so it survives a refresh but clears when the tab
// closes, rather than leaving a stale "logged in" state indefinitely on a shared machine.
const KEY = "transportFinder.role";
const TOKEN_KEY = "transportFinder.token";

export interface Session {
  role: Role;
  token: string;
}

function isRole(v: string | null): v is Role {
  return v === "admin" || v === "user";
}

export function loadSession(): Session | null {
  try {
    const role = sessionStorage.getItem(KEY);
    const token = sessionStorage.getItem(TOKEN_KEY);
    return isRole(role) && token ? { role, token } : null;
  } catch {
    return null; // storage blocked (private browsing, disabled cookies, ...) -- just don't persist
  }
}

export function saveSession({ role, token }: Session): void {
  try {
    sessionStorage.setItem(KEY, role);
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore -- the session simply won't survive a refresh in this browser context
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}
