import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SearchResults from "./components/SearchResults";
import type { SearchResponse, TransportResult } from "./services/api";
import { buildRequestParams, DEFAULT_PICKUP_PINCODE, INITIAL_PARAMS } from "./searchDefaults";

const noop = () => {};

describe("search form starts empty", () => {
  it("has no pre-filled values", () => {
    expect(INITIAL_PARAMS).toEqual({ pincode: "", city: "", state: "", transport_name: "" });
  });
});

describe("buildRequestParams", () => {
  // The fields start empty now, so this special case rarely triggers in practice — these tests
  // just confirm the existing request-shaping logic still behaves correctly and wasn't touched.
  it("passes params through unchanged when pincode isn't the untouched legacy default", () => {
    expect(buildRequestParams(INITIAL_PARAMS, false)).toEqual(INITIAL_PARAMS);
    const params = { pincode: "", city: "Sonipat", state: "Haryana", transport_name: "" };
    expect(buildRequestParams(params, false)).toEqual(params);
  });

  it("still drops an untouched, unedited default-pincode value so a City/State search works", () => {
    const params = { pincode: DEFAULT_PICKUP_PINCODE, city: "Sonipat", state: "", transport_name: "" };
    expect(buildRequestParams(params, false).pincode).toBe("");
  });

  it("always sends a pincode the user typed, even alongside City/State", () => {
    const edited = { pincode: "131001", city: "Sonipat", state: "Haryana", transport_name: "" };
    expect(buildRequestParams(edited, true)).toEqual(edited);
  });

  it("keeps an edited pincode even if it matches the legacy default value", () => {
    const params = { pincode: DEFAULT_PICKUP_PINCODE, city: "Rajkot", state: "", transport_name: "" };
    expect(buildRequestParams(params, true)).toEqual(params);
  });
});

describe("results table Status column", () => {
  const row = (over: Partial<TransportResult>): TransportResult => ({
    transport_name: "TCI Express", branch_name: null, location: null, city: "Rajkot", state: "Gujarat",
    pincode: "360003", serviceability: null, documents_required: null, surface_delivery: null,
    air_delivery: null, rail_delivery: null, branch_type: null, godown_name: null, contact_number: null,
    alternate_contact: null, address: null, source_url: null, last_updated: null, ...over,
  });
  const data = (results: TransportResult[], extra: Partial<SearchResponse> = {}): SearchResponse => ({
    search: { pincode: "360003", city: null, state: null }, match_level: "pincode", message: null, results,
    total: results.length, page: 1, page_size: 50, total_pages: 1, ...extra,
  });
  const render = (d: SearchResponse, page = 1) =>
    renderToStaticMarkup(
      <SearchResults data={d} page={page} onPageChange={noop} view="table" onViewChange={noop} onViewDetails={noop} />,
    );

  it("table view includes City/Transport/Mobile/Pincode/Status, plus Transport Type and Actions", () => {
    const html = render(data([row({ status: "Active" })]));
    const heads = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual([
      "#", "Transporter", "Service Cities", "Pincode", "Mobile", "Status", "Transport Type", "Actions",
    ]);
  });

  it("shows an Active badge, and Not Available for a missing mobile number", () => {
    const html = render(data([row({ status: "Active" })]));
    expect(html).toMatch(/<span class="badge badge-active">Active<\/span>/);
    expect(html).toContain("Not Available");
    expect(html).not.toContain("Order Count");
  });

  it("still renders a Not Active badge if the API ever returns one", () => {
    const html = render(data([row({ status: "Not Active" })]));
    expect(html).toMatch(/<span class="badge badge-inactive">Not Active<\/span>/);
  });

  it("renders a verified mobile number as returned by the API", () => {
    const html = render(data([row({ transport_name: "VRL Logistics", contact_number: "88868-65879", status: "Active" })]));
    expect(html).toContain("88868-65879");
  });
});

describe("pagination", () => {
  const row = (n: number): TransportResult => ({
    transport_name: `T${n}`, branch_name: null, location: null, city: "Rajkot", state: "Gujarat",
    pincode: "360003", serviceability: null, documents_required: null, surface_delivery: null,
    air_delivery: null, rail_delivery: null, branch_type: null, godown_name: null, contact_number: null,
    alternate_contact: null, address: null, source_url: null, last_updated: null, status: "Active",
  });
  const data = (extra: Partial<SearchResponse>): SearchResponse => ({
    search: { pincode: "360003", city: null, state: null }, match_level: "pincode", message: null,
    results: [row(1)], total: 1, page: 1, page_size: 50, total_pages: 1, ...extra,
  });

  const render = (d: SearchResponse, page = 1) =>
    renderToStaticMarkup(
      <SearchResults data={d} page={page} onPageChange={noop} view="table" onViewChange={noop} onViewDetails={noop} />,
    );

  it("hides pagination controls when everything fits on one page", () => {
    const html = render(data({}));
    expect(html).not.toContain("pagination-controls");
  });

  it("shows Previous/Next, numbered pages with the current one marked, and the range", () => {
    const html = render(data({ total: 120, total_pages: 3 }), 2);
    expect(html).toContain('aria-label="Previous page"');
    expect(html).toContain('aria-label="Next page"');
    expect(html).toMatch(/aria-current="page"[^>]*>2<\/button>/);
    expect(html).toContain("120");
  });

  it("disables Previous on the first page and Next on the last page", () => {
    const first = render(data({ total: 120, total_pages: 3 }), 1);
    expect(first).toMatch(/aria-label="Previous page" disabled/);
    const last = render(data({ total: 120, total_pages: 3 }), 3);
    expect(last).toMatch(/aria-label="Next page" disabled/);
  });
});
