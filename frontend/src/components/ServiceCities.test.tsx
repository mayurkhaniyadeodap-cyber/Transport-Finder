import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SearchResults from "./SearchResults";
import TransporterDrawer from "./TransporterDrawer";
import type { SearchResponse, TransportResult } from "../services/api";

afterEach(cleanup);

const noop = () => {};

const row = (over: Partial<TransportResult> = {}): TransportResult => ({
  transport_name: "Abhisek Travels", branch_name: null, location: null, city: "Mumbai", state: "Maharashtra",
  pincode: "400001", serviceability: null, documents_required: null, surface_delivery: null,
  air_delivery: null, rail_delivery: null, branch_type: null, godown_name: null, contact_number: null,
  alternate_contact: null, address: null, source_url: null, last_updated: null, status: "Active",
  service_cities: ["Ahmedabad", "Borivali", "Mumbai", "Pune", "Thane"], ...over,
});

const data = (r: TransportResult): SearchResponse => ({
  search: { pincode: null, city: null, state: null, transport_name: r.transport_name }, match_level: "transporter",
  message: null, results: [r], total: 1, page: 1, page_size: 50, total_pages: 1,
});

describe("Service Cities", () => {
  it("result card shows the first service cities and how many more", () => {
    render(<SearchResults data={data(row())} page={1} onPageChange={noop} view="cards" onViewChange={noop} onViewDetails={noop} />);
    const card = screen.getByRole("heading", { name: "Abhisek Travels" }).closest("article")!;
    expect(within(card).getByText("Service Cities")).toBeTruthy();
    expect(within(card).getByText(/Ahmedabad, Borivali, Mumbai/)).toBeTruthy();
    expect(within(card).getByText("+2 more")).toBeTruthy();
  });

  it("table view has a Service Cities column", () => {
    render(<SearchResults data={data(row())} page={1} onPageChange={noop} view="table" onViewChange={noop} onViewDetails={noop} />);
    expect(screen.getByRole("columnheader", { name: "Service Cities" })).toBeTruthy();
    expect(screen.getByText(/Ahmedabad, Borivali, Mumbai/)).toBeTruthy();
  });

  it("shows Not Available instead of inventing cities when there are none", () => {
    render(
      <SearchResults data={data(row({ service_cities: [] }))} page={1} onPageChange={noop} view="cards" onViewChange={noop} onViewDetails={noop} />,
    );
    const card = screen.getByRole("heading", { name: "Abhisek Travels" }).closest("article")!;
    const facts = within(card).getByText("Service Cities").closest("div")!;
    expect(within(facts).getByText("Not Available")).toBeTruthy();
  });

  it("details drawer summarises service cities, and its Coverage tab lists every one", () => {
    render(<TransporterDrawer row={row()} onClose={noop} />);
    expect(screen.getByText("See all 5")).toBeTruthy(); // Overview: compact summary + link
    fireEvent.click(screen.getByRole("tab", { name: "Coverage" }));
    expect(screen.getByRole("heading", { name: "Service Cities (5)" })).toBeTruthy();
    const chips = within(screen.getByRole("list", { name: "Service cities" })).getAllByRole("listitem");
    expect(chips.map((c) => c.textContent)).toEqual(["Ahmedabad", "Borivali", "Mumbai", "Pune", "Thane"]);
  });
});
