import { useCallback, useEffect, useRef, useState } from "react";
import { AlertIcon, ArrowLeftIcon, ChevronDownIcon, LogOutIcon, RefreshIcon, SearchIcon, SettingsIcon } from "../components/Icons";
import SearchResults, { matchedPlace, ResultsViewMode } from "../components/SearchResults";
import Sidebar, { View } from "../components/Sidebar";
import StatCards, { Stats } from "../components/StatCards";
import ThemeToggle from "../components/ThemeToggle";
import TransporterProfile from "../components/TransporterProfile";
import UnifiedSearchBar from "../components/UnifiedSearchBar";
import { personInitials } from "../components/ui";
import ActivityLog from "./ActivityLog";
import ManageTransporters from "./ManageTransporters";
import { Role } from "./LoginPage";
import SettingsPage from "./SettingsPage";
import { reportActivity } from "../services/activityApi";
import { DEFAULT_PREFERENCES, getAccount, getPreferences, Preferences, SessionExpiredError } from "../services/settingsApi";
import { deriveTransportType, fetchAllResultsForStats, ResolvedSearch, searchByType, searchUnified } from "../searchDefaults";
import { searchTransport, SearchParams, SearchResponse, Suggestion, TransportResult, USE_MOCK } from "../services/api";

function computeStats(rows: TransportResult[], response: SearchResponse): Stats {
  return {
    total: response.total ?? rows.length,
    active: rows.filter((r) => r.status === "Active").length,
    phoneAvailable: rows.filter((r) => r.contact_number).length,
    transportTypes: new Set(rows.map((r) => deriveTransportType(r.transport_name))).size,
    partial: (response.total ?? rows.length) > rows.length,
  };
}

const TITLES: Record<View, { title: string; crumb: string }> = {
  search: { title: "Find transport", crumb: "Search" },
  profile: { title: "Transporter profile", crumb: "Profile" },
  manage: { title: "Manage transporters", crumb: "Manage" },
  settings: { title: "Settings", crumb: "Settings" },
  activity: { title: "Activity log", crumb: "Activity" },
};

interface Props {
  role: Role;
  token: string;
  onLogout: () => void;
}

export default function TransportFinder({ role, token, onLogout }: Props) {
  // Both roles land on Search right after login.
  const [view, setView] = useState<View>("search");
  const isAdmin = role === "admin";

  // Manage transporters is Admin-only. There's no URL router in this app (view is plain React
  // state), so this is the one place that gates it -- if a non-admin role ever ends up with
  // view === "manage" by any path, send them back to Search rather than rendering it.
  useEffect(() => {
    if (!isAdmin && view === "manage") setView("search");
  }, [isAdmin, view]);

  const [query, setQuery] = useState("");
  const [resolvedParams, setResolvedParams] = useState<SearchParams | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultsView, setResultsView] = useState<ResultsViewMode>("table"); // the dense List, as in the design
  const [stats, setStats] = useState<Stats | null>(null);
  const [profileRow, setProfileRow] = useState<TransportResult | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loginId, setLoginId] = useState<string | null>(null);

  const onSessionExpired = useCallback(() => onLogout(), [onLogout]);

  // App-wide search preferences (set by the Admin in Settings). Until they load -- or if they can't
  // be loaded -- search behaves exactly as before (no default pincode, automatic type, 50 per page).
  // The default pincode pre-fills an empty search box (never overwriting what the user typed).
  const applyPrefs = useCallback((p: Preferences) => {
    setPrefs(p);
    if (p.default_pincode) setQuery((q) => q || p.default_pincode);
  }, []);
  useEffect(() => {
    getPreferences(token).then(applyPrefs).catch((e) => {
      if (e instanceof SessionExpiredError) onSessionExpired();
    });
  }, [token, onSessionExpired, applyPrefs]);

  useEffect(() => {
    if (USE_MOCK) return;
    getAccount(token).then((a) => setLoginId(a.login_id)).catch(() => undefined);
  }, [token]);

  // One "Panel opened" per sign-in or page load. The ref (kept across React StrictMode's
  // development-only double effect run) stops it being recorded twice.
  const reportedOpen = useRef<string | null>(null);
  useEffect(() => {
    if (reportedOpen.current === token) return;
    reportedOpen.current = token;
    reportActivity(token, "panel_open", isAdmin ? "Admin workspace opened" : "User workspace opened");
  }, [token, isAdmin]);

  const applyResolved = async (resolve: () => Promise<ResolvedSearch>, targetPage: number, typed: string) => {
    setLoading(true);
    setError(null);
    try {
      const { params, response } = await resolve();
      setResolvedParams(params);
      setData(response);
      setPage(targetPage);
      setStats(null);
      const total = response.total ?? response.results.length;
      const place = matchedPlace(response);
      reportActivity(token, "search",
        `Searched for "${typed.trim()}" · ${total} transporter${total === 1 ? "" : "s"}${total && place ? ` for ${place}` : ""}`);
      fetchAllResultsForStats(params)
        .then((rows) => setStats(computeStats(rows, response)))
        .catch(() => setStats(null)); // stat tiles just stay in their loading state
    } catch (e) {
      setData(null);
      console.error(e);
      setError("We couldn't complete your search. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const runSearch = (targetQuery: string, targetPage: number) =>
    applyResolved(
      () => searchUnified(targetQuery, targetPage, { pageSize: prefs.results_per_page, searchType: prefs.default_search_type }),
      targetPage, targetQuery,
    );

  const onSearch = () => query.trim() && runSearch(query, 1);
  const onQuickPick = (term: string) => {
    setQuery(term);
    runSearch(term, 1);
  };
  // A typed autocomplete suggestion already knows its exact type (pincode/city/state/transporter),
  // so it searches directly instead of going through searchUnified()'s guessing chain.
  const onSuggestionPick = (s: Suggestion) => {
    setQuery(s.value);
    applyResolved(() => searchByType(s.type, s.value, 1, prefs.results_per_page), 1, s.value);
  };

  const onPageChange = async (nextPage: number) => {
    if (!resolvedParams) return;
    setLoading(true);
    setError(null);
    try {
      setData(await searchTransport(resolvedParams, nextPage, prefs.results_per_page));
      setPage(nextPage);
    } catch (e) {
      console.error(e);
      setError("We couldn't complete your search. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const openProfile = (row: TransportResult) => {
    setProfileRow(row);
    setView("profile");
    reportActivity(token, "profile_view", row.transport_name);
    window.scrollTo?.({ top: 0 });
  };

  // Back to the start of Search: no results, and an empty box (or the Admin's default pincode).
  const clearSearch = () => {
    setData(null);
    setResolvedParams(null);
    setError(null);
    setStats(null);
    setQuery(prefs.default_pincode || "");
    window.scrollTo?.({ top: 0 });
  };

  const navigate = (next: View) => {
    setView(next);
    window.scrollTo?.({ top: 0 });
  };

  const hasResults = Boolean(data || loading || error);

  return (
    <div className="app">
      <Sidebar view={view} isAdmin={isAdmin} loginId={loginId} onNavigate={navigate} />

      <div className="main">
        <Topbar view={view} role={role} loginId={loginId} onLogout={onLogout} onSettings={() => navigate("settings")} />

        <main className="content">
          {view === "settings" ? (
            <SettingsPage role={role} token={token} preferences={prefs} onPreferencesSaved={applyPrefs}
                          onLogout={onLogout} onSessionExpired={onSessionExpired} onAccountChanged={(a) => setLoginId(a.login_id)} />
          ) : view === "manage" && isAdmin ? (
            <ManageTransporters />
          ) : view === "activity" ? (
            <ActivityLog role={role} token={token} onSessionExpired={onSessionExpired} />
          ) : view === "profile" ? (
            <TransporterProfile row={profileRow} onBack={() => navigate("search")} />
          ) : (
            <section>
              {USE_MOCK && (
                <p className="alert info">MOCK DATA — try 110001, 400001, 360001 (results), 999999 (no result), 500500 (error)</p>
              )}
              <div className="pagehead">
                <div>
                  <div className="eyebrow">Network intelligence</div>
                  <h1 className="h1">Find the right transporter.</h1>
                  <p className="sub">Search order-history coverage by pincode, city, state or transporter.</p>
                </div>
                {hasResults ? (
                  <button type="button" className="btn secondary" onClick={clearSearch}>
                    <ArrowLeftIcon size={16} /> Back to search
                  </button>
                ) : (
                  <span className="tag">ORDER HISTORY DATA</span>
                )}
              </div>

              <UnifiedSearchBar
                key={`search-${prefs.default_pincode}`} // remount so a pre-filled pincode doesn't pop open suggestions
                value={query}
                loading={loading}
                onChange={setQuery}
                onSearch={onSearch}
                onQuickPick={onQuickPick}
                onSuggestionPick={onSuggestionPick}
                valueAlreadySearched
              />

              {!hasResults && (
                <div className="panel empty">
                  <span className="empty-icon"><SearchIcon size={24} /></span>
                  <h3>Search to see transporters</h3>
                  <p>Type a 6-digit pincode, a city, a state or a transporter name, or pick a popular search above.</p>
                  <p className="hint" style={{ marginTop: 12 }}>
                    Only Active transporters are shown · Mobile numbers are verified transporter numbers, never customer numbers.
                  </p>
                </div>
              )}

              {loading && !data && <ResultsSkeleton />}

              {error && !loading && (
                <section className="panel empty" role="alert">
                  <span className="empty-icon error"><AlertIcon size={24} /></span>
                  <h3>Something went wrong</h3>
                  <p>{error}</p>
                  <button type="button" className="btn" onClick={onSearch}>
                    <RefreshIcon size={16} /> Try again
                  </button>
                </section>
              )}

              {data && !error && (
                <div className={loading ? "is-refreshing" : undefined}>
                  <SearchResults
                    data={data}
                    page={page}
                    onPageChange={onPageChange}
                    view={resultsView}
                    onViewChange={setResultsView}
                    onViewDetails={openProfile}
                    summary={data.results.length > 0 ? <StatCards stats={stats} fallbackTotal={data.total ?? data.results.length} /> : null}
                  />
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-busy="true">
      <p className="loading-line" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" /> Searching transporters…
      </p>
      <div className="grid4">
        {[0, 1, 2, 3].map((i) => <span key={i} className="skeleton tile" />)}
      </div>
      <div className="cards">
        {[0, 1, 2, 3].map((i) => <span key={i} className="skeleton card" />)}
      </div>
    </div>
  );
}

function Topbar({ view, role, loginId, onLogout, onSettings }: {
  view: View; role: Role; loginId: string | null; onLogout: () => void; onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const roleName = role === "admin" ? "Admin" : "User";

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <header className="topbar">
      <div className="topbar-title">
        <b>{TITLES[view].title}</b>
        <div className="crumb">DeoDap / {TITLES[view].crumb}</div>
      </div>
      <div className="top-actions">
        <ThemeToggle />
        <span className="top-role">{role === "admin" ? "Admin · Full access" : "User · Search only"}</span>
        <div className="account-wrap" ref={menuRef}>
          <button type="button" className="account-btn" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span className="avatar">{personInitials(loginId ?? roleName)}</span>
            <ChevronDownIcon size={14} />
          </button>
          {open && (
            <div className="account-menu">
              <div className="account-menu-head">
                Signed in as {roleName}
                <strong>{loginId ?? "…"}</strong>
              </div>
              <button type="button" onClick={() => { setOpen(false); onSettings(); }}>
                <SettingsIcon size={16} /> Settings
              </button>
              <button type="button" onClick={onLogout}>
                <LogOutIcon size={16} /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
