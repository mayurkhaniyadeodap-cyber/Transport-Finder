import { withBase } from "./base";
export interface TransportResult {
  transport_name: string;
  branch_name: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  serviceability: string | null;
  documents_required: string | null;
  surface_delivery: boolean | null;
  air_delivery: boolean | null;
  rail_delivery: boolean | null;
  branch_type: string | null;
  godown_name: string | null;
  contact_number: string | null;
  alternate_contact: string | null;
  address: string | null;
  source_url: string | null;
  last_updated: string | null;
  status?: string | null;
  override_id?: number | null;
  service_cities?: string[]; // every real city this transporter covers (optional: mock data has none)
  photo_url?: string | null; // Admin-uploaded photo, else a verified official logo, if any
  photo_source?: "admin" | "official" | null;
  shipment_charge?: string | null; // Admin-entered approx. charge per box in rupees ("75.50"); never derived from order data
}

export interface SearchParams {
  pincode: string;
  city: string;
  state: string;
  transport_name: string;
}

export const DEFAULT_PAGE_SIZE = 50;

export interface SearchResponse {
  search: { pincode: string | null; city: string | null; state: string | null; transport_name?: string | null };
  match_level: "pincode" | "city_state" | "state" | "transporter" | null;
  message: string | null;
  results: TransportResult[];
  // Pagination (optional so older/mock responses without it still degrade gracefully).
  total?: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
}

export type SuggestionType = "pincode" | "city" | "state" | "transporter";

export interface Suggestion {
  type: SuggestionType;
  value: string;
}

// --- MOCK MODE (temporary): enabled by VITE_USE_MOCK=true in frontend/.env.development ---
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
// --- end mock block ---

export async function searchTransport(params: SearchParams, page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<SearchResponse> {
  if (USE_MOCK) {
    // dynamic import keeps mock data out of the production bundle when the flag is off
    const { mockSearchTransport } = await import("../mock/mockSearch");
    return mockSearchTransport(params);
  }
  const qs = new URLSearchParams();
  (Object.keys(params) as (keyof SearchParams)[]).forEach((k) => {
    const v = params[k].trim();
    if (v) qs.set(k, v);
  });
  qs.set("page", String(page));
  qs.set("page_size", String(pageSize));
  const res = await fetch(withBase(`/api/transport/search?${qs.toString()}`));
  if (!res.ok) throw new Error(`Server error (${res.status})`);
  return res.json();
}

/** Autocomplete suggestions for the unified search box -- real pincodes/cities/states/transporter
 * names from the backend's already-loaded, already-allowlisted data (see /api/transport/suggest),
 * never made up client-side. */
export async function suggestTransport(q: string, limit = 8): Promise<Suggestion[]> {
  const query = q.trim();
  if (!query || USE_MOCK) return []; // no mock backing for suggestions; a real backend is required
  const qs = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(withBase(`/api/transport/suggest?${qs.toString()}`));
  if (!res.ok) return []; // suggestions are a soft-fail convenience, never block typing/search
  return res.json();
}
