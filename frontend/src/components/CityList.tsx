const NA = "Not Available";

/** "Mumbai, Pune, Thane +2 more" -- a compact, one-line summary of a long list. */
export function CompactList({ items, max = 3 }: { items?: string[] | null; max?: number }) {
  if (!items || items.length === 0) return <span className="na">{NA}</span>;
  const rest = items.length - max;
  return (
    <span className="compact-list" title={items.join(", ")}>
      {items.slice(0, max).join(", ")}
      {rest > 0 && <span className="more-count">+{rest} more</span>}
    </span>
  );
}

/** How many pincodes a transporter's summary shows before "+X more" (search cards, table, profile,
 * Manage Transporters). The full list is still in the data, and on the profile's Coverage tab. */
export const PINCODE_PREVIEW = 2;

/** "380001, 380002 +26 more" */
export function PincodeSummary({ pins }: { pins?: string[] | null }) {
  return <CompactList items={pins} max={PINCODE_PREVIEW} />;
}

export const splitPincodes = (value: string | null | undefined): string[] =>
  (value || "").split(",").map((p) => p.trim()).filter(Boolean);

/** Admin-entered approx. charge per box, e.g. "75.50" -> "₹75.50"; null when not set. */
export const formatCharge = (value: string | null | undefined): string | null => (value ? `₹${value}` : null);

/** Every service city, as chips (transporter details). */
export function CityChips({ cities }: { cities?: string[] | null }) {
  if (!cities || cities.length === 0) return <p className="na">{NA}</p>;
  return (
    <ul className="city-chips" aria-label="Service cities">
      {cities.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  );
}
