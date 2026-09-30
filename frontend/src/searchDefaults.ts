import { searchTransport, SearchParams, SearchResponse, Suggestion, TransportResult } from "./services/api";

// Kept only as the comparison target inside buildRequestParams below; the pincode field is no
// longer pre-filled with this value (fields start empty), so this constant now has no visible effect.
export const DEFAULT_PICKUP_PINCODE = "360003";

export const INITIAL_PARAMS: SearchParams = { pincode: "", city: "", state: "", transport_name: "" };

/**
 * The backend gives Pincode priority over City/State. So that a pre-filled default pincode does not
 * override a City/State search, the default is left out of the request while the user has not edited
 * the pincode field and has entered a City or State. An edited pincode is always sent as typed.
 */
export function buildRequestParams(params: SearchParams, pincodeEdited: boolean): SearchParams {
  const usingCityOrState = params.city.trim() !== "" || params.state.trim() !== "";
  if (!pincodeEdited && usingCityOrState && params.pincode === DEFAULT_PICKUP_PINCODE) {
    return { ...params, pincode: "" };
  }
  return params;
}

// --- Unified single search box (Search page redesign) ---
// One text box stands in for the existing Pincode/City/State(/Transporter Name) fields -- it still
// only ever calls the existing /api/transport/search with exactly one of those filled in.

export interface ResolvedSearch {
  params: SearchParams;
  response: SearchResponse;
}

const EMPTY_PARAMS: SearchParams = { pincode: "", city: "", state: "", transport_name: "" };

/** A 6-digit value is always a pincode. Otherwise, try it as a City first (the common case for a
 * typed place name); if that finds nothing, fall back to State, then to Transporter Name --
 * mirroring the backend's own search priority, without guessing which one the user meant. Used
 * for free text the user typed and searched without picking a suggestion; picking a suggestion
 * instead calls searchByType() directly, since its type is already known. */
/** The Admin's "Default search type" preference: "auto" keeps the guessing chain below; any other
 * value searches free text as exactly that field. A 6-digit value is a pincode either way. */
export type SearchTypePreference = "auto" | Suggestion["type"];

export interface SearchOptions {
  pageSize?: number; // results per page (undefined = the API default)
  searchType?: SearchTypePreference;
}

export async function searchUnified(rawQuery: string, page = 1, { pageSize, searchType = "auto" }: SearchOptions = {}): Promise<ResolvedSearch> {
  const value = rawQuery.trim();
  if (/^\d{6}$/.test(value)) {
    const params: SearchParams = { ...EMPTY_PARAMS, pincode: value };
    return { params, response: await searchTransport(params, page, pageSize) };
  }
  if (searchType !== "auto") return searchByType(searchType, value, page, pageSize);

  const cityParams: SearchParams = { ...EMPTY_PARAMS, city: value };
  const cityResponse = await searchTransport(cityParams, page, pageSize);
  if (cityResponse.results.length > 0) return { params: cityParams, response: cityResponse };

  const stateParams: SearchParams = { ...EMPTY_PARAMS, state: value };
  const stateResponse = await searchTransport(stateParams, page, pageSize);
  if (stateResponse.results.length > 0) return { params: stateParams, response: stateResponse };

  const nameParams: SearchParams = { ...EMPTY_PARAMS, transport_name: value };
  return { params: nameParams, response: await searchTransport(nameParams, page, pageSize) };
}

/** Searches directly by a known field, e.g. from clicking a typed autocomplete suggestion -- no
 * guessing needed since the suggestion already says what it is. */
export async function searchByType(type: Suggestion["type"], value: string, page = 1, pageSize?: number): Promise<ResolvedSearch> {
  const key = type === "transporter" ? "transport_name" : type;
  const params: SearchParams = { ...EMPTY_PARAMS, [key]: value };
  return { params, response: await searchTransport(params, page, pageSize) };
}

// --- Summary stats (computed client-side from real rows, over the full result set) ---

export const AGGREGATE_PAGE_SIZE = 200; // matches the backend's MAX_PAGE_SIZE
const AGGREGATE_PAGE_CAP = 5; // safety ceiling: at most 1000 rows fetched for the stat cards

/** Re-fetches the resolved search at a larger page size so the stat cards reflect the whole
 * matching set, not just the 50 rows on the current display page -- still just the existing
 * search API, called more than once. Bounded so a huge state-wide search can't fire dozens of
 * requests; beyond the cap, stats are computed from as much as was fetched. */
export async function fetchAllResultsForStats(params: SearchParams): Promise<TransportResult[]> {
  const first = await searchTransport(params, 1, AGGREGATE_PAGE_SIZE);
  const totalPages = Math.min(first.total_pages ?? 1, AGGREGATE_PAGE_CAP);
  const all = [...first.results];
  for (let p = 2; p <= totalPages; p++) {
    // eslint-disable-next-line no-await-in-loop -- pages must be fetched in order, small bounded loop
    const resp = await searchTransport(params, p, AGGREGATE_PAGE_SIZE);
    all.push(...resp.results);
  }
  return all;
}

// --- Transport Type: not a real field the API returns -- derived client-side, for display only,
// from keywords already present in the transporter's own name. Purely cosmetic categorisation. ---

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/express/i, "Express"],
  [/surface/i, "Surface"],
  [/\bair\b/i, "Air"],
  [/cargo/i, "Cargo"],
  [/logistics?/i, "Logistics"],
  [/freight/i, "Freight"],
  [/road\s*ways?|road\s*lines?/i, "Roadways"],
  [/travels?/i, "Travels"],
  [/transport/i, "Transport"],
];

export function deriveTransportType(name: string): string {
  for (const [pattern, label] of TYPE_KEYWORDS) {
    if (pattern.test(name)) return label;
  }
  return "Courier"; // generic default when no keyword matches
}
