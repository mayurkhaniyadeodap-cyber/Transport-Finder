import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertIcon, ArrowLeftIcon, CheckCircleIcon, ChevronDownIcon, LogOutIcon, PhoneIcon, RefreshIcon, SettingsIcon, TruckIcon,
  ZapIcon,
} from "../components/Icons";
import SearchResults, { ResultsViewMode } from "../components/SearchResults";
import Sidebar, { View } from "../components/Sidebar";
import StatCards, { Stats } from "../components/StatCards";
import TransporterDrawer from "../components/TransporterDrawer";
import UnifiedSearchBar from "../components/UnifiedSearchBar";
import { TruckArt } from "../components/ui";
import ManageTransporters from "./ManageTransporters";
import { Role } from "./LoginPage";
import SettingsPage from "./SettingsPage";
import { DEFAULT_PREFERENCES, getPreferences, Preferences, SessionExpiredError } from "../services/settingsApi";
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

// Facts shown under the search hero (kept accurate to the backend: Active-only search, verified
// contacts only).
const DATA_FACTS = [
  { icon: CheckCircleIcon, title: "Active transporters only", text: "Not Active transporters are left out of Search", tone: "tone-sky" },
  { icon: PhoneIcon, title: "Mobile when confirmed", text: "Only verified transporter numbers, never customer numbers", tone: "tone-amber" },
];

interface Props {
  role: Role;
  token: string;
  onLogout: () => void;
}

export default function TransportFinder({ role, token, onLogout }: Props) {
  // Both roles land on Search right after login; Manage Transporters is reached from the navbar
  // (Admin only -- see the guard effect below), never as the initial post-login page.
  const [view, setView] = useState<View>("search");

  // Manage Transporters is Admin-only. There's no URL router in this app (view is plain React
  // state), so this is the one place that gates it -- if a non-admin role ever ends up with
  // view === "manage" by any path, send them back to Search rather than rendering it.
  useEffect(() => {
    if (role !== "admin" && view === "manage") setView("search");
  }, [role, view]);

  const [query, setQuery] = useState("");
  const [resolvedParams, setResolvedParams] = useState<SearchParams | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultsView, setResultsView] = useState<ResultsViewMode>("cards");
  const [stats, setStats] = useState<Stats | null>(null);
  const [detailsRow, setDetailsRow] = useState<TransportResult | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);

  // App-wide search preferences (set by the Admin in Settings). Until they load -- or if they can't
  // be loaded -- search behaves exactly as before (no default pincode, automatic type, 50 per page).
  const onSessionExpired = useCallback(() => onLogout(), [onLogout]);
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

  const applyResolved = async (resolve: () => Promise<ResolvedSearch>, targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const { params, response } = await resolve();
      setResolvedParams(params);
      setData(response);
      setPage(targetPage);
      setStats(null);
      fetchAllResultsForStats(params)
        .then((rows) => setStats(computeStats(rows, response)))
        .catch(() => setStats(null)); // stat cards just stay in their loading state
    } catch (e) {
      setData(null);
      console.error(e);
      setError("We couldn't complete your search. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const runSearch = (targetQuery: string, targetPage: number) =>
    applyResolved(() => searchUnified(targetQuery, targetPage, { pageSize: prefs.results_per_page, searchType: prefs.default_search_type }), targetPage);

  const onSearch = () => query.trim() && runSearch(query, 1);
  const onQuickPick = (term: string) => {
    setQuery(term);
    runSearch(term, 1);
  };
  // A typed autocomplete suggestion already knows its exact type (pincode/city/state/transporter),
  // so it searches directly instead of going through searchUnified()'s guessing chain.
  const onSuggestionPick = (s: Suggestion) => {
    setQuery(s.value);
    applyResolved(() => searchByType(s.type, s.value, 1, prefs.results_per_page), 1);
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

  const closeDetails = useCallback(() => setDetailsRow(null), []);

  const backToSearch = () => {
    setData(null);
    setResolvedParams(null);
    setError(null);
  };

  const isAdmin = role === "admin";
  const hasResults = Boolean(data || loading || error);
  const title = view === "settings" ? "Settings" : view === "manage" && isAdmin ? "Manage transporters" : "Find transporters";
  const subtitle = view === "settings"
    ? "Account, appearance, preferences and security"
    : view === "manage" && isAdmin
      ? "Edit, hide, add and restore transporters"
      : "Search by pincode, city, state or transporter name";

  return (
    <div className="app-shell">
      <Sidebar view={view} isAdmin={isAdmin} onNavigate={setView} />

      <div className="main-area">
        <Topbar title={title} subtitle={subtitle} role={role} onLogout={onLogout} onSettings={() => setView("settings")} />

        {view === "settings" ? (
          <main className="content">
            <SettingsPage role={role} token={token} preferences={prefs} onPreferencesSaved={applyPrefs}
                          onLogout={onLogout} onSessionExpired={onSessionExpired} />
          </main>
        ) : view === "manage" && isAdmin ? (
          <main className="content">
            <ManageTransporters />
          </main>
        ) : (
          <main className="content">
            {USE_MOCK && (
              <p className="mock-note">
                MOCK DATA — try 110001, 400001, 360001 (results), 999999 (no result), 500500 (error)
              </p>
            )}

            {!hasResults ? (
              <div className="search-home">
                <section className="hero" id="top">
                  <div className="hero-inner">
                    <span className="hero-eyebrow">
                      <ZapIcon size={14} /> Pan-India transporter search
                    </span>
                    <h1>Find Transporters Near You</h1>
                    <p>Search by pincode, city, state or transporter name to get the best transporters in your area.</p>
                    <UnifiedSearchBar
                      key={`hero-${prefs.default_pincode}`} // remount so a pre-filled pincode doesn't pop open suggestions
                      value={query}
                      loading={loading}
                      onChange={setQuery}
                      onSearch={onSearch}
                      onQuickPick={onQuickPick}
                      onSuggestionPick={onSuggestionPick}
                      valueAlreadySearched
                    />
                  </div>
                  <TruckArt className="hero-art" />
                </section>

                <section aria-labelledby="about-data">
                  <h2 id="about-data" className="section-label">About the data</h2>
                  <div className="facts-grid">
                    {DATA_FACTS.map(({ icon: Icon, title: t, text, tone }) => (
                      <div key={t} className="card fact-card">
                        <span className={`tile-icon ${tone}`}>
                          <Icon size={20} />
                        </span>
                        <div>
                          <p className="fact-card-title">{t}</p>
                          <p className="fact-card-text">{text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <div className="results-page">
                <div className="results-searchbar">
                  <button type="button" className="icon-btn icon-btn-ghost" onClick={backToSearch} aria-label="Back to search">
                    <ArrowLeftIcon size={18} />
                  </button>
                  <UnifiedSearchBar
                    compact
                    valueAlreadySearched
                    value={query}
                    loading={loading}
                    onChange={setQuery}
                    onSearch={onSearch}
                    onQuickPick={onQuickPick}
                    onSuggestionPick={onSuggestionPick}
                  />
                </div>

                {loading && !data && <ResultsSkeleton view={resultsView} />}

                {error && !loading && (
                  <section className="card state-card" role="alert">
                    <span className="state-icon state-icon-error">
                      <AlertIcon size={30} />
                    </span>
                    <h3>Something went wrong</h3>
                    <p>{error}</p>
                    <button type="button" className="btn btn-primary" onClick={onSearch}>
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
                      onViewDetails={setDetailsRow}
                      onBack={backToSearch}
                      summary={data.results.length > 0 ? <StatCards stats={stats} fallbackTotal={data.total ?? data.results.length} /> : null}
                    />
                  </div>
                )}
              </div>
            )}
          </main>
        )}
      </div>

      <TransporterDrawer row={detailsRow} onClose={closeDetails} />
    </div>
  );
}

function ResultsSkeleton({ view }: { view: ResultsViewMode }) {
  return (
    <div className="skeleton-wrap" aria-busy="true">
      <p className="loading-line" role="status" aria-live="polite">
        <span className="spinner spinner-xs" aria-hidden="true" />
        Searching transporters…
      </p>
      <div className="stat-cards">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton skeleton-tile" />
        ))}
      </div>
      {view === "cards" ? (
        <div className="result-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card skeleton-card">
              <div className="skeleton-row">
                <span className="skeleton skeleton-avatar" />
                <span className="skeleton-lines">
                  <span className="skeleton skeleton-line w-60" />
                  <span className="skeleton skeleton-line w-30" />
                </span>
              </div>
              <span className="skeleton skeleton-line w-50" />
              <span className="skeleton skeleton-line w-75" />
              <span className="skeleton skeleton-line w-40" />
            </div>
          ))}
        </div>
      ) : (
        <div className="card skeleton-table">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="skeleton skeleton-bar" />
          ))}
        </div>
      )}
    </div>
  );
}

function Topbar({ title, subtitle, role, onLogout, onSettings }: {
  title: string; subtitle: string; role: Role; onLogout: () => void; onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const name = role === "admin" ? "Admin" : "User";

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
      <span className="brand-logo topbar-logo" aria-hidden="true">
        <TruckIcon size={18} />
      </span>
      <div className="topbar-title">
        <p className="topbar-heading">{title}</p>
        <p className="topbar-sub">{subtitle}</p>
      </div>
      <div className="account-menu-wrap" ref={menuRef}>
        <button type="button" className="account-chip" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="account-avatar">{name.slice(0, 2).toUpperCase()}</span>
          <span className="account-text">
            <span className="account-name">{name}</span>
            <span className="account-role">{role === "admin" ? "Full access" : "Search only"}</span>
          </span>
          <ChevronDownIcon size={16} />
        </button>
        {open && (
          <div className="account-menu">
            <div className="account-menu-head">
              <span>Signed in as</span>
              <strong>{name}</strong>
            </div>
            <button type="button" className="account-menu-item" onClick={() => { setOpen(false); onSettings(); }}>
              <SettingsIcon size={16} /> Settings
            </button>
            <button type="button" className="account-menu-item" onClick={onLogout}>
              <LogOutIcon size={16} /> Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
