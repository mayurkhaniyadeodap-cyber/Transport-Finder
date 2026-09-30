import { CheckCircleIcon, LayersIcon, PhoneIcon, TruckIcon } from "./Icons";

export interface Stats {
  total: number;
  active: number;
  phoneAvailable: number;
  transportTypes: number;
  partial: boolean; // true if the aggregate is capped before the full result set was fetched
}

interface Props {
  stats: Stats | null; // null while the background aggregate fetch is still running
  fallbackTotal: number; // the current page's own response.total, shown immediately
}

const CARDS: { key: keyof Omit<Stats, "partial">; label: string; icon: typeof TruckIcon; tone: string }[] = [
  { key: "total", label: "Transporters", icon: TruckIcon, tone: "tone-blue" },
  { key: "active", label: "Active", icon: CheckCircleIcon, tone: "tone-green" },
  { key: "phoneAvailable", label: "Phone available", icon: PhoneIcon, tone: "tone-sky" },
  { key: "transportTypes", label: "Transport types", icon: LayersIcon, tone: "tone-amber" },
];

export default function StatCards({ stats, fallbackTotal }: Props) {
  return (
    <div className="stat-cards" aria-label="Result summary">
      {CARDS.map(({ key, label, icon: Icon, tone }) => {
        const value = key === "total" ? (stats ? stats.total : fallbackTotal) : stats?.[key];
        return (
          <div className="stat-card" key={key}>
            <span className={`tile-icon ${tone}`}>
              <Icon size={20} />
            </span>
            <div className="stat-text">
              <div className="stat-value">{value == null ? <span className="stat-loading">…</span> : value}</div>
              <div className="stat-label">
                {label}
                {stats?.partial && key !== "total" ? "*" : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
