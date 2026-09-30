// TEMPORARY MOCK DATA — delete this whole `src/mock/` folder (and the marked block in
// services/api.ts, the banner in pages/TransportFinder.tsx, and frontend/.env.development)
// once the real API/database is used again.
//
// All names, phone numbers and addresses below are made up for UI testing only.
import type { SearchParams, SearchResponse, TransportResult } from "../services/api";

const NOW = new Date().toISOString();

const MOCK: TransportResult[] = [
  {
    transport_name: "TCI Express",
    branch_name: "XPHJ-PAHARGANJ",
    location: "New Delhi",
    city: "New Delhi",
    state: "Delhi",
    pincode: "110001",
    serviceability: "SERVICEABLE",
    documents_required: "Copies of Invoice, E-Way Bill",
    surface_delivery: true,
    air_delivery: true,
    rail_delivery: true,
    branch_type: "Branch",
    godown_name: "Paharganj Godown",
    contact_number: "011-5550-0101",
    alternate_contact: null,
    address: "Plot 12, Main Bazar Road, Paharganj, New Delhi - 110001",
    source_url: null,
    last_updated: NOW,
  },
  {
    transport_name: "VRL Logistics",
    branch_name: "New Delhi",
    location: "New Delhi",
    city: "New Delhi",
    state: "Delhi",
    pincode: "110001",
    serviceability: "SERVICEABLE",
    documents_required: "Invoice, E-Way Bill, GST Copy",
    surface_delivery: true,
    air_delivery: false,
    rail_delivery: true,
    branch_type: "Booking Office",
    godown_name: "New Delhi Godown",
    contact_number: "011-5550-0202",
    alternate_contact: "98XXXXXX02",
    address: "Godown 4, Transport Nagar, New Delhi - 110001",
    source_url: null,
    last_updated: NOW,
  },
  {
    transport_name: "TCI Express",
    branch_name: "XMUM-ANDHERI",
    location: "Mumbai",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    serviceability: "SERVICEABLE",
    documents_required: "Copies of Invoice",
    surface_delivery: true,
    air_delivery: true,
    rail_delivery: false,
    branch_type: null,
    godown_name: null, // missing on purpose: shows "Not Available"
    contact_number: null,
    alternate_contact: null,
    address: null,
    source_url: null,
    last_updated: NOW,
  },
  {
    transport_name: "VRL Logistics",
    branch_name: "Rajkot",
    location: "Rajkot",
    city: "Rajkot",
    state: "Gujarat",
    pincode: "360001",
    serviceability: null, // branch known, serviceability unknown
    documents_required: null,
    surface_delivery: null,
    air_delivery: null,
    rail_delivery: null,
    branch_type: "Branch",
    godown_name: "Rajkot Godown",
    contact_number: "0281-555-0303",
    alternate_contact: null,
    address: "Survey 88, Aji GIDC, Rajkot - 360001",
    source_url: null,
    last_updated: NOW,
  },
];

const key = (s: string | null) => (s ?? "").replace(/[\s_-]+/g, " ").trim().toLowerCase();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mimics GET /api/transport/search (same priority: pincode -> city+state -> state).
 * Test triggers:
 *   110001 / 400001 / 360001 -> success   |   any unknown pincode (e.g. 999999) -> no result
 *   500500 -> simulated server error      |   non-6-digit pincode -> validation message
 */
export async function mockSearchTransport(params: SearchParams): Promise<SearchResponse> {
  await wait(700); // visible loading state

  const pincode = params.pincode.trim();
  const city = params.city.trim();
  const state = params.state.trim();
  const search = { pincode: pincode || null, city: city || null, state: state || null };

  if (pincode === "500500") throw new Error("Server error (500) — simulated by mock data");
  if (!pincode && !city && !state) {
    return { search, match_level: null, message: "Enter a pincode, city or state.", results: [] };
  }
  if (pincode && !/^\d{6}$/.test(pincode)) {
    return { search, match_level: null, message: "Pincode must be 6 digits.", results: [] };
  }

  const steps: [SearchResponse["match_level"], (r: TransportResult) => boolean, boolean][] = [
    ["pincode", (r) => r.pincode === pincode, !!pincode],
    ["city_state", (r) => key(r.city) === key(city) && (!state || key(r.state) === key(state)), !!city],
    ["state", (r) => key(r.state) === key(state), !!state],
  ];
  for (const [level, match, enabled] of steps) {
    if (!enabled) continue;
    const results = MOCK.filter(match);
    if (results.length) return { search, match_level: level, message: null, results };
  }
  return { search, match_level: null, message: "No transporters found for this search.", results: [] };
}
