import { useCallback, useEffect, useState } from "react";
import { AlertIcon, EmptyIcon, RefreshIcon, SearchIcon } from "../components/Icons";
import { Pagination } from "../components/ui";
import { ActivityKind, ActivityPage, listActivity } from "../services/activityApi";
import { SessionExpiredError } from "../services/settingsApi";
import type { Role } from "./LoginPage";

const PAGE_SIZE = 50;

const KIND_LABEL: Record<ActivityKind, string> = {
  session: "Session",
  search: "Search",
  profile: "Profile",
  admin: "Admin",
  settings: "Settings",
};

const KIND_TONE: Record<ActivityKind, string> = { session: "", search: "", profile: "", admin: "warn", settings: "muted" };

/** "30 Oct 2026, 2:41 pm" in India time, from the UTC timestamp the server stores. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

interface Props {
  role: Role;
  token: string;
  onSessionExpired: () => void;
}

/** Who did what, and when. The Admin sees everyone's activity; a User sees their own. */
export default function ActivityLog({ role, token, onSessionExpired }: Props) {
  const isAdmin = role === "admin";
  const [data, setData] = useState<ActivityPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<ActivityKind | "">("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");

  // Typing filters after a short pause, not on every key.
  useEffect(() => {
    const t = setTimeout(() => {
      setAppliedQuery(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await listActivity(token, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, kind, q: appliedQuery }));
    } catch (e) {
      if (e instanceof SessionExpiredError) return onSessionExpired();
      setError(e instanceof Error ? e.message : "Could not load the activity log.");
    } finally {
      setLoading(false);
    }
  }, [token, page, kind, appliedQuery, onSessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  const total = data?.total ?? 0;
  const stats = [
    { label: "Events today", value: data?.today.events, hint: isAdmin ? "Everyone, India time" : "Your activity, India time" },
    { label: "Panel opens", value: data?.today.panel_opens, hint: "Today" },
    { label: "Searches", value: data?.today.searches, hint: "Location lookups today" },
    { label: "Current role", value: isAdmin ? "Admin" : "User", hint: isAdmin ? "Sees all activity" : "Sees own activity" },
  ];

  return (
    <section>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Workspace audit trail</div>
          <h1 className="h1">Activity log</h1>
          <p className="sub">
            {isAdmin
              ? "Sign-ins, panel opens, searches, profile views and every Admin change, with who did it and when."
              : "Your sign-ins, panel opens, searches and profile views, with the date and time."}
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={load} disabled={loading}>
          <RefreshIcon size={16} /> Refresh log
        </button>
      </div>

      <div className="grid4">
        {stats.map(({ label, value, hint }) => (
          <div className="stat" key={label}>
            <div className="label">{label}</div>
            <div className="num" style={typeof value === "string" ? { fontSize: 20 } : undefined}>{value ?? "…"}</div>
            <div className="hint">{hint}</div>
          </div>
        ))}
      </div>

      <section className="panel section" aria-labelledby="activity-title">
        <div className="resulthead">
          <div>
            <h3 id="activity-title">Recent activity</h3>
            <p>Newest first. Stored on the server, so it's the same on every device.</p>
          </div>
          <div className="filterwrap">
            <select value={kind} onChange={(e) => { setKind(e.target.value as ActivityKind | ""); setPage(1); }} aria-label="Type">
              <option value="">All types</option>
              {(Object.keys(KIND_LABEL) as ActivityKind[])
                .filter((k) => isAdmin || (k !== "admin"))
                .map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <span className="inputbox">
              <span className="glass"><SearchIcon size={14} /></span>
              <input className="filterinput" value={query} onChange={(e) => setQuery(e.target.value)}
                     placeholder="Search activity…" aria-label="Search the activity log" />
            </span>
          </div>
        </div>

        {error && (
          <div className="alert error" role="alert">
            <AlertIcon size={16} />
            <span>{error}</span>
          </div>
        )}
        {!data && !error && <p className="loading-line"><span className="spinner" aria-hidden="true" /> Loading activity…</p>}

        {data && data.results.length === 0 && (
          <div className="empty" role="status">
            <span className="empty-icon"><EmptyIcon size={24} /></span>
            <h3>No activity recorded yet</h3>
            <p>{kind || appliedQuery ? "Nothing matches these filters." : "Events appear here as soon as they happen."}</p>
          </div>
        )}

        {data && data.results.length > 0 && (
          <div className={loading ? "is-refreshing" : undefined}>
            <div className="tablewrap flat" tabIndex={0} role="region" aria-label="Activity log table">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Details</th>
                    <th scope="col">Performed by</th>
                    <th scope="col">Time</th>
                    <th scope="col">Type</th>
                    {isAdmin && <th scope="col">IP address</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap"><b>{e.event}</b></td>
                      <td>{e.detail || <span className="na">—</span>}</td>
                      <td className="nowrap">
                        {e.login_id || <span className="na">Unknown</span>}
                        {e.role && <span className="muted"> · {e.role === "admin" ? "Admin" : "User"}</span>}
                      </td>
                      <td className="nowrap">{formatWhen(e.created_at)}</td>
                      <td><span className={`tag ${KIND_TONE[e.kind] ?? ""}`}>{KIND_LABEL[e.kind] ?? e.kind}</span></td>
                      {isAdmin && <td className="nowrap muted">{e.ip || "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
          </div>
        )}
      </section>
      <p className="notice">
        Recorded on the server with the person's ID, date and time (shown in India time) and IP address. Passwords are never logged.
      </p>
    </section>
  );
}
