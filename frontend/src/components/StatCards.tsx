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

const CARDS: { key: keyof Omit<Stats, "partial">; label: string; hint: string }[] = [
  { key: "total", label: "Transporters", hint: "Matching this search" },
  { key: "active", label: "Active", hint: "Currently available" },
  { key: "phoneAvailable", label: "Phone available", hint: "Direct contact" },
  { key: "transportTypes", label: "Transport types", hint: "Across matching results" },
];

export default function StatCards({ stats, fallbackTotal }: Props) {
  return (
    <div className="grid4" aria-label="Result summary">
      {CARDS.map(({ key, label, hint }) => {
        const value = key === "total" ? (stats ? stats.total : fallbackTotal) : stats?.[key];
        return (
          <div className="stat" key={key}>
            <div className="label">
              {label}
              {stats?.partial && key !== "total" ? "*" : ""}
            </div>
            <div className="num">{value == null ? "…" : value}</div>
            <div className="hint">{hint}</div>
          </div>
        );
      })}
    </div>
  );
}
