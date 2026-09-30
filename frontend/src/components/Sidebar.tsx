import { useTheme } from "../theme";
import { MoonIcon, SearchIcon, SettingsIcon, SunIcon, TruckIcon, UsersIcon } from "./Icons";

export type View = "search" | "manage" | "settings";

interface Props {
  view: View;
  isAdmin: boolean;
  onNavigate: (view: View) => void;
}

/** Persistent navigation: a dark sidebar on desktop and a bottom tab bar on phones (CSS only, one
 * set of buttons). Only real destinations: Search, Manage Transporters (Admin only) and Settings,
 * plus a Light/Dark theme toggle (bottom of the sidebar; last item of the phone bar). */
export default function Sidebar({ view, isAdmin, onNavigate }: Props) {
  const { resolved, setTheme } = useTheme();
  const toDark = resolved === "light";
  const items = [
    { id: "search" as const, label: "Search", short: "Search", icon: SearchIcon },
    ...(isAdmin ? [{ id: "manage" as const, label: "Manage Transporters", short: "Manage", icon: UsersIcon, tag: "Admin" }] : []),
    { id: "settings" as const, label: "Settings", short: "Settings", icon: SettingsIcon },
  ];

  return (
    <aside className="sidebar">
      <a className="sidebar-brand" href="#top" aria-label="Transport Finder home">
        <span className="brand-logo">
          <TruckIcon size={20} />
        </span>
        <span className="brand-name">Transport Finder</span>
      </a>

      <p className="sidebar-label">Menu</p>
      <nav className="sidebar-nav" aria-label="Primary">
        {items.map(({ id, label, short, icon: Icon, tag }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-current={view === id ? "page" : undefined}
            className={`sidebar-nav-item ${view === id ? "active" : ""}`}
            onClick={() => onNavigate(id)}
          >
            <Icon size={20} />
            <span className="nav-label">{label}</span>
            <span className="nav-short">{short}</span>
            {tag && <span className="nav-tag">{tag}</span>}
          </button>
        ))}
        <button
          type="button"
          className="sidebar-nav-item theme-toggle"
          aria-label={toDark ? "Switch to dark theme" : "Switch to light theme"}
          title={toDark ? "Switch to dark theme" : "Switch to light theme"}
          onClick={() => setTheme(toDark ? "dark" : "light")}
        >
          {toDark ? <MoonIcon size={20} /> : <SunIcon size={20} />}
          <span className="nav-label">{toDark ? "Dark mode" : "Light mode"}</span>
          <span className="nav-short">{toDark ? "Dark" : "Light"}</span>
        </button>
      </nav>
    </aside>
  );
}
