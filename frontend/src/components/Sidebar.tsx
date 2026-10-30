import type { ReactNode } from "react";
import { ClockIcon, ListIcon, ProfileIcon, SearchIcon, SettingsIcon, TruckIcon } from "./Icons";
import { personInitials } from "./ui";

export type View = "search" | "profile" | "manage" | "settings" | "activity";

interface Props {
  view: View;
  isAdmin: boolean;
  loginId: string | null;
  onNavigate: (view: View) => void;
}

interface Item {
  id: View;
  label: string;
  short: string;
  icon: ReactNode;
  tag?: string;
}

/** Persistent navigation: the sidebar on desktop, and the same buttons as a bottom tab bar on
 * phones (CSS only). Manage transporters is listed for the Admin only. */
export default function Sidebar({ view, isAdmin, loginId, onNavigate }: Props) {
  const workspace: Item[] = [
    { id: "search", label: "Find transport", short: "Search", icon: <SearchIcon size={18} /> },
    { id: "profile", label: "Transporter profile", short: "Profile", icon: <ProfileIcon size={18} /> },
    ...(isAdmin ? [{ id: "manage" as const, label: "Manage transporters", short: "Manage", icon: <ListIcon size={18} /> }] : []),
  ];
  const preferences: Item[] = [
    { id: "settings", label: "Settings", short: "Settings", icon: <SettingsIcon size={18} /> },
    { id: "activity", label: "Activity log", short: "Activity", icon: <ClockIcon size={18} /> },
  ];

  const button = ({ id, label, short, icon, tag }: Item) => (
    <button key={id} type="button" aria-label={label} aria-current={view === id ? "page" : undefined}
            className={view === id ? "active" : ""} onClick={() => onNavigate(id)}>
      <span className="ico">{icon}</span>
      <span className="nav-label">{label}</span>
      <span className="nav-short">{short}</span>
      {tag && <span className="nav-tag">{tag}</span>}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandmark" aria-hidden="true"><TruckIcon size={20} /></div>
        <div>
          <b>Transport Finder</b>
          <small>DEODAP · OPERATIONS</small>
        </div>
      </div>
      <nav className="navgroups" aria-label="Primary" style={{ display: "contents" }}>
        <div className="navgroup">
          <div className="navlabel">Workspace</div>
          <div className="nav">{workspace.map(button)}</div>
        </div>
        <div className="navgroup">
          <div className="navlabel">Preferences</div>
          <div className="nav">{preferences.map(button)}</div>
        </div>
      </nav>
      <div className="sidefoot">
        <div className="userpill">
          <div className="avatar" aria-hidden="true">{personInitials(loginId)}</div>
          <div style={{ minWidth: 0 }}>
            <b>{loginId ?? "…"}</b>
            <span>{isAdmin ? "Administrator" : "Standard user"}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
