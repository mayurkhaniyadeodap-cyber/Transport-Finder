// Company-form and filler words that don't identify the transporter ("Pvt. Ltd", "Co.", "and" ...).
const SKIP = new Set(["pvt", "private", "ltd", "limited", "co", "company", "llp", "inc", "regd", "and", "of", "the"]);

/** Short name shown when a transporter has no image: the first letter of up to three meaningful words,
 * e.g. "Gujarat Transport Service" -> "GTS", "TCI Express" -> "TE", "Baradi Roadways" -> "BR".
 * A one-word name gives its first two letters. Bracketed parts ("(Arc)") and company-form words are
 * ignored unless they're all there is. */
export function initials(name: string): string {
  const clean = (text: string) => text.split(/[\s.,/&-]+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  const all = clean(name);
  if (all.length === 0) return "?";
  const unbracketed = clean(name.replace(/\([^)]*\)/g, " "));
  const words = unbracketed.filter((w) => !SKIP.has(w.toLowerCase()));
  const pick = words.length ? words : unbracketed.length ? unbracketed : all;
  if (pick.length === 1) return pick[0].slice(0, 2).toUpperCase();
  return pick.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
}
