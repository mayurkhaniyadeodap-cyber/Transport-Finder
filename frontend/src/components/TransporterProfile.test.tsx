import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SearchResults from "./SearchResults";
import TransporterDrawer from "./TransporterDrawer";
import type { SearchResponse, TransportResult } from "../services/api";

afterEach(cleanup);

const noop = () => {};

const row = (over: Partial<TransportResult> = {}): TransportResult => ({
  transport_name: "Abhisek Travels", branch_name: null, location: null, city: "Mumbai", state: "Maharashtra",
  pincode: "400001, 400002", serviceability: null, documents_required: null, surface_delivery: null,
  air_delivery: null, rail_delivery: null, branch_type: null, godown_name: null, contact_number: "9624203797",
  alternate_contact: null, address: null, source_url: null, last_updated: null, status: "Active",
  service_cities: ["Mumbai", "Pune", "Thane"], photo_url: null, ...over,
});

const data = (r: TransportResult): SearchResponse => ({
  search: { pincode: null, city: "Mumbai", state: null }, match_level: "city_state",
  message: null, results: [r], total: 1, page: 1, page_size: 50, total_pages: 1,
});

describe("View Profile buttons", () => {
  it("every result card has a View Profile button that opens that transporter", () => {
    const onView = vi.fn();
    const r = row();
    render(<SearchResults data={data(r)} page={1} onPageChange={noop} view="cards" onViewChange={noop} onViewDetails={onView} />);
    fireEvent.click(screen.getByRole("button", { name: /View Profile/ }));
    expect(onView).toHaveBeenCalledWith(r);
  });

  it("every table row has a View Profile button too", () => {
    const onView = vi.fn();
    render(<SearchResults data={data(row())} page={1} onPageChange={noop} view="table" onViewChange={noop} onViewDetails={onView} />);
    fireEvent.click(screen.getByRole("button", { name: "View Profile" }));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it("result cards and the table don't show a Location", () => {
    const { unmount } = render(
      <SearchResults data={data(row())} page={1} onPageChange={noop} view="cards" onViewChange={noop} onViewDetails={noop} />,
    );
    const card = screen.getByRole("heading", { name: "Abhisek Travels" }).closest("article")!;
    expect(within(card).queryByText("Location")).toBeNull();
    expect(within(card).queryByText(/Mumbai, Maharashtra/)).toBeNull();
    expect(within(card).getByText("Service Cities")).toBeTruthy(); // the other fields stay
    unmount();
    render(<SearchResults data={data(row())} page={1} onPageChange={noop} view="table" onViewChange={noop} onViewDetails={noop} />);
    expect(screen.queryByRole("columnheader", { name: "Location" })).toBeNull();
    expect(screen.queryByText(/Mumbai, Maharashtra/)).toBeNull();
  });

  it("a result card shows the transporter's photo as its avatar when it has one", () => {
    render(
      <SearchResults data={data(row({ photo_url: "/api/transport/photo?key=a&v=1" }))} page={1} onPageChange={noop} view="cards"
                     onViewChange={noop} onViewDetails={noop} />,
    );
    const card = screen.getByRole("heading", { name: "Abhisek Travels" }).closest("article")!;
    expect(card.querySelector("img.avatar-photo")?.getAttribute("src")).toBe("/api/transport/photo?key=a&v=1");
  });

  it("a result card and table row without an image show the transporter's short name", () => {
    const { unmount } = render(
      <SearchResults data={data(row())} page={1} onPageChange={noop} view="cards" onViewChange={noop} onViewDetails={noop} />,
    );
    const card = screen.getByRole("heading", { name: "Abhisek Travels" }).closest("article")!;
    expect(within(card).getByRole("img", { name: "Abhisek Travels (AT)" }).textContent).toBe("AT");
    expect(card.querySelector("img")).toBeNull();
    expect(within(card).queryByText("No image available")).toBeNull();
    unmount();
    render(<SearchResults data={data(row())} page={1} onPageChange={noop} view="table" onViewChange={noop} onViewDetails={noop} />);
    expect(screen.getByRole("img", { name: "Abhisek Travels (AT)" }).textContent).toBe("AT");
  });
});

describe("View logo/image preview", () => {
  const preview = () => screen.queryByRole("dialog", { name: /logo\/image$/ });
  const open = (name = "Abhisek Travels") => fireEvent.click(screen.getByRole("button", { name: `View ${name} logo/image` }));

  it("clicking the profile image opens a larger preview of the official logo", () => {
    render(<TransporterDrawer row={row({ photo_url: "/api/transport/photo?key=a&v=1", photo_source: "official" })} onClose={noop} />);
    expect(preview()).toBeNull();
    open();
    const box = preview()!;
    const img = within(box).getByRole("img", { name: "Abhisek Travels image" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/transport/photo?key=a&v=1");
    expect(img.classList.contains("lightbox-image")).toBe(true);
    expect(within(box).getByText("Official company logo")).toBeTruthy();
  });

  it("shows the Admin-uploaded image when there is one", () => {
    render(<TransporterDrawer row={row({ photo_url: "/p/uploaded.png", photo_source: "admin" })} onClose={noop} />);
    open();
    const box = preview()!;
    expect(within(box).getByRole("img", { name: "Abhisek Travels image" }).getAttribute("src")).toBe("/p/uploaded.png");
    expect(within(box).getByText("Image uploaded by Admin")).toBeTruthy();
  });

  it("with no image, the preview shows the short name, not a picture", () => {
    render(<TransporterDrawer row={row({ transport_name: "Gujarat Transport Service" })} onClose={noop} />);
    open("Gujarat Transport Service");
    const box = preview()!;
    expect(within(box).getByRole("img", { name: "Gujarat Transport Service (GTS)" }).textContent).toBe("GTS");
    expect(box.querySelector("img")).toBeNull();
  });

  it("falls back to the short name in the preview if the image fails to load", () => {
    render(<TransporterDrawer row={row({ photo_url: "/broken.png", photo_source: "official" })} onClose={noop} />);
    open();
    const box = preview()!;
    fireEvent.error(within(box).getByRole("img", { name: "Abhisek Travels image" }));
    expect(within(box).getByRole("img", { name: "Abhisek Travels (AT)" }).textContent).toBe("AT");
  });

  it("closes with the × button, keeping the profile open", () => {
    const onClose = vi.fn();
    render(<TransporterDrawer row={row({ photo_url: "/p.png", photo_source: "official" })} onClose={onClose} />);
    open();
    fireEvent.click(within(preview()!).getByRole("button", { name: "Close image preview" }));
    expect(preview()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Abhisek Travels" })).toBeTruthy();
  });

  it("closes on a click outside the image, but not on the image itself", () => {
    const onClose = vi.fn();
    render(<TransporterDrawer row={row({ photo_url: "/p.png", photo_source: "official" })} onClose={onClose} />);
    open();
    fireEvent.click(within(preview()!).getByRole("img", { name: "Abhisek Travels image" }));
    expect(preview()).not.toBeNull();
    fireEvent.click(document.querySelector(".lightbox-overlay")!);
    expect(preview()).toBeNull();
    expect(onClose).not.toHaveBeenCalled(); // the profile underneath stays open
  });

  it("Escape closes the preview first, then a second Escape closes the profile", () => {
    const onClose = vi.fn();
    render(<TransporterDrawer row={row()} onClose={onClose} />);
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(preview()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is view-only: the preview has no upload or change controls", () => {
    render(<TransporterDrawer row={row({ photo_url: "/p.png", photo_source: "official" })} onClose={noop} />);
    open();
    const box = preview()!;
    expect(box.querySelector('input[type="file"]')).toBeNull();
    expect(within(box).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Close image preview"]);
  });
});

describe("Transporter profile", () => {
  it("shows the official company logo when there is one, and says so", () => {
    render(<TransporterDrawer row={row({ photo_url: "/api/transport/photo?key=a&v=1", photo_source: "official" })} onClose={noop} />);
    const img = screen.getByRole("img", { name: "Abhisek Travels image" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/transport/photo?key=a&v=1");
    expect(screen.getByText("Official company logo")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Abhisek Travels (AT)" })).toBeNull(); // no short name when there's a logo
  });

  it("an Admin-uploaded image is labelled as such", () => {
    render(<TransporterDrawer row={row({ photo_url: "/p.png", photo_source: "admin" })} onClose={noop} />);
    expect(screen.getByText("Image uploaded by Admin")).toBeTruthy();
  });

  it("shows the transporter's short name -- not a made-up picture -- when there's no image", () => {
    render(<TransporterDrawer row={row({ transport_name: "Gujarat Transport Service" })} onClose={noop} />);
    const dialog = screen.getByRole("dialog");
    const tile = within(dialog).getByRole("img", { name: "Gujarat Transport Service (GTS)" });
    expect(tile.textContent).toBe("GTS");
    expect(tile.classList.contains("profile-photo")).toBe(true);
    expect(dialog.querySelector("img")).toBeNull(); // no picture element at all
    expect(within(dialog).queryByText("No image available")).toBeNull();
    expect(within(dialog).queryByText("Official company logo")).toBeNull();
  });

  it("falls back to the short name if the image fails to load", () => {
    render(<TransporterDrawer row={row({ photo_url: "/broken.png", photo_source: "official" })} onClose={noop} />);
    fireEvent.error(screen.getByRole("img", { name: "Abhisek Travels image" }));
    expect(screen.getByRole("img", { name: "Abhisek Travels (AT)" }).textContent).toBe("AT");
  });

  it("shows name, mobile, service cities, pincodes, status and transport type", () => {
    render(<TransporterDrawer row={row()} onClose={noop} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Transporter profile")).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Abhisek Travels" })).toBeTruthy();
    expect(within(dialog).getAllByText("9624203797").length).toBeGreaterThan(0); // mobile
    expect(within(dialog).getByText("Mumbai, Pune, Thane")).toBeTruthy(); // service cities
    expect(within(dialog).getByText("400001, 400002")).toBeTruthy(); // pincodes
    expect(within(dialog).getAllByText("Active").length).toBeGreaterThan(0); // status
    expect(within(dialog).getAllByText("Travels").length).toBeGreaterThan(0); // transport type
    fireEvent.click(within(dialog).getByRole("tab", { name: "Coverage" }));
    expect(within(dialog).getByRole("heading", { name: "Service Cities (3)" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Pincodes (2)" })).toBeTruthy();
  });

  it("does not show a Location anywhere", () => {
    render(<TransporterDrawer row={row()} onClose={noop} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("Location")).toBeNull();
    expect(within(dialog).queryByText(/Mumbai, Maharashtra/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Coverage" }));
    expect(within(dialog).queryByText("Location")).toBeNull();
  });

  it("is view-only: no photo upload or edit controls, for any role", () => {
    render(<TransporterDrawer row={row({ photo_url: "/p.png" })} onClose={noop} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Upload|Replace|Remove|Edit|Delete/ })).toBeNull();
  });
});

describe("Pincodes: first 2, then +X more", () => {
  const many = "380001, 380002, 380003, 380004";

  it("on a result card", () => {
    render(<SearchResults data={data(row({ pincode: many }))} page={1} onPageChange={noop} view="cards" onViewChange={noop} onViewDetails={noop} />);
    const card = screen.getByRole("heading", { name: "Abhisek Travels" }).closest("article")!;
    expect([...card.querySelectorAll(".pin-chip")].map((c) => c.textContent)).toEqual(["380001", "380002"]);
    expect(within(card).getByText("+2 more")).toBeTruthy();
  });

  it("in the table", () => {
    render(<SearchResults data={data(row({ pincode: many }))} page={1} onPageChange={noop} view="table" onViewChange={noop} onViewDetails={noop} />);
    const cell = screen.getAllByRole("cell")[3];
    expect(cell.textContent).toBe("380001, 380002+2 more");
  });

  it("on the profile overview -- the Coverage tab still lists every pincode", () => {
    render(<TransporterDrawer row={row({ pincode: many })} onClose={noop} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("380001, 380002")).toBeTruthy();
    expect(within(dialog).getByText("+2 more")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Coverage" }));
    expect(within(dialog).getByRole("heading", { name: "Pincodes (4)" })).toBeTruthy();
    expect(within(dialog).getAllByRole("listitem").filter((li) => li.classList.contains("pin-chip"))).toHaveLength(4);
  });

  it("2 or fewer pincodes show no +more", () => {
    render(<TransporterDrawer row={row({ pincode: "400001, 400002" })} onClose={noop} />);
    expect(screen.queryByText(/more$/)).toBeNull();
  });
});

describe("Approx. Shipment Charge / 1 Box on the profile", () => {
  const fact = () => screen.getByText("Approx. Shipment Charge / 1 Box (₹)").closest(".fact") as HTMLElement;

  it.each([["45", "₹45"], ["75.50", "₹75.50"], ["120", "₹120"]])("shows %s as %s", (value, shown) => {
    render(<TransporterDrawer row={row({ shipment_charge: value })} onClose={noop} />);
    expect(within(fact()).getByText(shown)).toBeTruthy();
  });

  it("shows Not Available when empty", () => {
    render(<TransporterDrawer row={row({ shipment_charge: null })} onClose={noop} />);
    expect(within(fact()).getByText("Not Available")).toBeTruthy();
  });

  it("is view-only on the profile", () => {
    render(<TransporterDrawer row={row({ shipment_charge: "75.50" })} onClose={noop} />);
    expect(screen.getByRole("dialog").querySelector("input")).toBeNull();
  });
});
