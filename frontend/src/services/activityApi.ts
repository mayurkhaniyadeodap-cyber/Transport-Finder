import { withBase } from "./base";
import { USE_MOCK } from "./api";
import { SessionExpiredError } from "./settingsApi";

// Activity Log: stored on the server (local SQLite). The app reports panel opens, searches and
// profile views; sign-ins and every Admin change are recorded by the server itself.

export type ActivityType = "panel_open" | "search" | "profile_view";
export type ActivityKind = "session" | "search" | "profile" | "admin" | "settings";

export interface ActivityEntry {
  id: number;
  created_at: string; // UTC, ISO 8601
  role: "admin" | "user" | null; // null: nobody signed in (a failed sign-in)
  login_id: string | null;
  kind: ActivityKind;
  event: string;
  detail: string | null;
  ip: string | null;
}

export interface ActivityPage {
  results: ActivityEntry[];
  total: number;
  today: { events: number; panel_opens: number; searches: number };
}

/** Fire-and-forget: a failure to log must never get in the way of what the person is doing. */
export function reportActivity(token: string, type: ActivityType, detail?: string): void {
  if (USE_MOCK || !token) return;
  fetch(withBase("/api/activity"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, detail: detail?.slice(0, 300) }),
  }).catch(() => undefined);
}

export async function listActivity(
  token: string, params: { limit?: number; offset?: number; kind?: ActivityKind | ""; q?: string } = {},
): Promise<ActivityPage> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  if (params.kind) qs.set("kind", params.kind);
  if (params.q?.trim()) qs.set("q", params.q.trim());
  const res = await fetch(withBase(`/api/activity?${qs.toString()}`), { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new SessionExpiredError("Your session has expired. Please log in again.");
  if (!res.ok) throw new Error(`Could not load the activity log (${res.status})`);
  return res.json();
}
