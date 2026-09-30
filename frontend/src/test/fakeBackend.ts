import { vi } from "vitest";

/** An in-memory stand-in for the backend's sign-in, Settings and User Management endpoints (plus
 * quiet empty answers for everything else), installed as the global fetch for UI tests. */
export interface FakeUser {
  id: number;
  login_id: string;
  password: string;
  active: boolean;
}

export interface FakeBackend {
  fetch: ReturnType<typeof vi.fn>;
  admin: { login_id: string; password: string };
  users: FakeUser[];
  preferences: { default_pincode: string; default_search_type: string; results_per_page: number };
  sessions: Map<string, { role: "admin" | "user"; userId?: number }>;
  calls: (path: string) => { url: string; init?: RequestInit }[];
  user: (loginId: string) => FakeUser | undefined;
}

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const out = (u: FakeUser) => ({ id: u.id, login_id: u.login_id, active: u.active, created_at: "2026-09-30T00:00:00+00:00", updated_at: "2026-09-30T00:00:00+00:00" });

export function installFakeBackend(): FakeBackend {
  let n = 0;
  let nextId = 2;
  const fb: FakeBackend = {
    fetch: vi.fn(),
    admin: { login_id: "Admin_deodap@123", password: "Admin@123" },
    users: [{ id: 1, login_id: "User_deodap@123", password: "User@123", active: true }],
    preferences: { default_pincode: "", default_search_type: "auto", results_per_page: 50 },
    sessions: new Map(),
    calls: (path) => fb.fetch.mock.calls.filter(([u]) => String(u).startsWith(path)).map(([url, init]) => ({ url: String(url), init })),
    user: (loginId) => fb.users.find((u) => u.login_id === loginId),
  };
  const idTaken = (id: string, exceptUser?: number, exceptAdmin = false) =>
    (!exceptAdmin && fb.admin.login_id.toLowerCase() === id.toLowerCase())
    || fb.users.some((u) => u.login_id.toLowerCase() === id.toLowerCase() && u.id !== exceptUser);

  fb.fetch.mockImplementation(async (rawUrl: string, init: RequestInit = {}) => {
    const url = String(rawUrl);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization?.replace("Bearer ", "");
    const session = auth ? fb.sessions.get(auth) : undefined;
    const me = session?.role === "user" ? fb.users.find((u) => u.id === session.userId && u.active) : undefined;

    if (url === "/api/auth/login") {
      const token = `tok-${++n}`;
      if (body.role === "admin") {
        if (body.login_id !== fb.admin.login_id || body.password !== fb.admin.password) return json(401, { detail: "Invalid ID or password" });
        fb.sessions.set(token, { role: "admin" });
        return json(200, { token, role: "admin", login_id: fb.admin.login_id });
      }
      const u = fb.user(body.login_id);
      if (!u || u.password !== body.password) return json(401, { detail: "Invalid ID or password" });
      if (!u.active) return json(403, { detail: "This account has been deactivated. Please contact the Admin." });
      fb.sessions.set(token, { role: "user", userId: u.id });
      return json(200, { token, role: "user", login_id: u.login_id });
    }
    if (url === "/api/auth/logout") {
      if (auth) fb.sessions.delete(auth);
      return json(200, { ok: true });
    }
    if (url.startsWith("/api/settings/")) {
      if (!session || (session.role === "user" && !me)) return json(401, { detail: "Your session has expired. Please log in again." });
      const acct = session.role === "admin" ? fb.admin : me!;
      if (url === "/api/settings/account" && method === "GET") return json(200, { role: session.role, login_id: acct.login_id });
      if (url === "/api/settings/account" && method === "PATCH") {
        if (body.current_password !== acct.password) return json(422, { detail: "Current password is incorrect." });
        if (body.new_login_id) {
          if (idTaken(body.new_login_id, me?.id, session.role === "admin")) return json(422, { detail: "That ID is already in use." });
          acct.login_id = body.new_login_id;
        }
        if (body.new_password) acct.password = body.new_password;
        return json(200, { role: session.role, login_id: acct.login_id });
      }
      if (url === "/api/settings/preferences" && method === "GET") return json(200, fb.preferences);
      if (url.startsWith("/api/settings/") && session.role !== "admin") return json(403, { detail: "Only the Admin can do this." });
      if (url === "/api/settings/preferences" && method === "PUT") {
        fb.preferences = { ...fb.preferences, ...body };
        return json(200, fb.preferences);
      }
      if (url === "/api/settings/users" && method === "GET") {
        return json(200, [...fb.users].sort((a, b) => a.login_id.localeCompare(b.login_id)).map(out));
      }
      if (url === "/api/settings/users" && method === "POST") {
        if (idTaken(body.login_id)) return json(422, { detail: "That ID is already in use." });
        const u = { id: nextId++, login_id: body.login_id, password: body.password, active: body.active ?? true };
        fb.users.push(u);
        return json(201, out(u));
      }
      const m = url.match(/^\/api\/settings\/users\/(\d+)$/);
      if (m) {
        const u = fb.users.find((x) => x.id === Number(m[1]));
        if (!u) return json(404, { detail: "That user no longer exists." });
        if (method === "DELETE") {
          fb.users = fb.users.filter((x) => x !== u);
          return json(200, { deleted: true });
        }
        if (body.login_id !== undefined) {
          if (idTaken(body.login_id, u.id)) return json(422, { detail: "That ID is already in use." });
          u.login_id = body.login_id;
        }
        if (body.password !== undefined) u.password = body.password;
        if (body.active !== undefined) u.active = body.active;
        return json(200, out(u));
      }
    }
    if (url.startsWith("/api/manage/")) return json(200, { results: [], total: 0, deleted: [] });
    if (url.startsWith("/api/transport/search")) {
      return json(200, { search: { pincode: null, city: null, state: null }, match_level: null, message: null, results: [], total: 0, page: 1, page_size: 50, total_pages: 0 });
    }
    return json(200, []);
  });
  vi.stubGlobal("fetch", fb.fetch);
  return fb;
}
