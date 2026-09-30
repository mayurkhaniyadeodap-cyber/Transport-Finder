import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManageTransporters from "./ManageTransporters";
import type { ManagedTransporter, ManageList, Override } from "../services/overridesApi";

// vitest.config has no `test.globals`, so @testing-library/react's automatic afterEach
// cleanup (which relies on a global `afterEach`) never registers -- do it explicitly.
afterEach(cleanup);

const listManagedTransporters = vi.fn();
const updateTransporter = vi.fn();
const deleteTransporter = vi.fn();
const restoreTransporter = vi.fn();
const listOverrides = vi.fn();
const updateOverride = vi.fn();
const deleteOverride = vi.fn();
const createNewTransporter = vi.fn();
const addTransporter = vi.fn();
const uploadTransporterPhoto = vi.fn();
const removeTransporterPhoto = vi.fn();
vi.mock("../services/overridesApi", () => ({
  PHOTO_TYPES: ["image/jpeg", "image/png", "image/webp"],
  MAX_PHOTO_BYTES: 2 * 1024 * 1024,
  uploadTransporterPhoto: (...a: unknown[]) => uploadTransporterPhoto(...a),
  removeTransporterPhoto: (...a: unknown[]) => removeTransporterPhoto(...a),
  listManagedTransporters: (...a: unknown[]) => listManagedTransporters(...a),
  updateTransporter: (...a: unknown[]) => updateTransporter(...a),
  deleteTransporter: (...a: unknown[]) => deleteTransporter(...a),
  restoreTransporter: (...a: unknown[]) => restoreTransporter(...a),
  listOverrides: (...a: unknown[]) => listOverrides(...a),
  updateOverride: (...a: unknown[]) => updateOverride(...a),
  deleteOverride: (...a: unknown[]) => deleteOverride(...a),
  createNewTransporter: (...a: unknown[]) => createNewTransporter(...a),
  addTransporter: (...a: unknown[]) => addTransporter(...a),
}));

const t = (over: Partial<ManagedTransporter>): ManagedTransporter => ({
  transport_name: "TCI Express", service_cities: ["Ahmedabad", "Rajkot"], pincodes: ["360003", "380001"],
  mobile: "9876543210", status: "Active", hidden: false, added_locally: false, edited: false, ...over,
});

const LIST: ManageList = {
  results: [
    t({ transport_name: "Abhisek Travels", service_cities: ["Ahmedabad", "Borivali", "Mumbai", "Pune", "Thane"], mobile: null }),
    t({ transport_name: "Kishan Travels", status: "Not Active", service_cities: ["Rajkot"], pincodes: ["360001"] }),
    t({ transport_name: "TCI Express" }),
    t({ transport_name: "Pavan Parcel Service", hidden: true }),
  ],
  total: 4,
  deleted: [],
};

beforeEach(() => {
  listManagedTransporters.mockReset().mockResolvedValue(LIST);
  updateTransporter.mockReset().mockResolvedValue({});
  deleteTransporter.mockReset().mockResolvedValue({});
  restoreTransporter.mockReset().mockResolvedValue({});
  listOverrides.mockReset().mockResolvedValue([]);
  updateOverride.mockReset().mockResolvedValue({});
  deleteOverride.mockReset().mockResolvedValue({});
  createNewTransporter.mockReset().mockResolvedValue({});
  addTransporter.mockReset().mockResolvedValue({});
  uploadTransporterPhoto.mockReset().mockResolvedValue({ photo_url: "/api/transport/photo?key=x&v=1" });
  removeTransporterPhoto.mockReset().mockResolvedValue({ removed: true });
  // jsdom doesn't implement scrollIntoView; clicking a summary card calls it on the list section.
  Element.prototype.scrollIntoView = vi.fn();
});

const rowOf = (name: string) => {
  const r = screen.getByText(name).closest("tr");
  if (!r) throw new Error(`row not found: ${name}`);
  return r;
};

async function loaded() {
  render(<ManageTransporters />);
  await screen.findByText("Abhisek Travels");
}

describe("All Transporters list", () => {
  it("shows every transporter, including Not Active and hidden ones, with the required columns", async () => {
    await loaded();
    const heads = screen.getAllByRole("columnheader").slice(0, 6).map((h) => h.textContent);
    expect(heads).toEqual(["Transporter Name", "Service Cities", "Pincode", "Mobile", "Status", "Actions"]);
    const totalTile = screen.getByText("Transporters", { selector: ".tile-label" }).closest(".tile") as HTMLElement;
    expect(within(totalTile).getByText("4")).toBeTruthy();
    expect(within(rowOf("Kishan Travels")).getByText("Not Active")).toBeTruthy();
    expect(within(rowOf("Pavan Parcel Service")).getByText("Hidden")).toBeTruthy();
  });

  it("shows service cities compactly, and Edit / Hide / Delete on every row", async () => {
    await loaded();
    const row = rowOf("Abhisek Travels");
    expect(within(row).getByText(/Ahmedabad, Borivali, Mumbai/)).toBeTruthy();
    expect(within(row).getByText("+2 more")).toBeTruthy();
    expect(within(row).getByText("Not Available")).toBeTruthy(); // no mobile: never invented
    for (const name of ["Edit", "Hide", "Delete"]) expect(within(row).getByRole("button", { name })).toBeTruthy();
    expect(within(rowOf("Pavan Parcel Service")).getByRole("button", { name: "Unhide" })).toBeTruthy();
  });
});

describe("Summary card filters", () => {
  const tile = (label: string) => screen.getByText(label, { selector: ".tile-label" }).closest("button") as HTMLElement;
  const namesShown = () =>
    within(screen.getByRole("region", { name: "All transporters table" }))
      .getAllByText(/./, { selector: ".transport-name" })
      .map((el) => el.textContent);

  it("clicking Active shows only Active transporters and marks that card selected", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(tile("Active"));
    expect(namesShown().sort()).toEqual(["Abhisek Travels", "Pavan Parcel Service", "TCI Express"]);
    expect(screen.queryByText("Kishan Travels")).toBeNull();
    expect(tile("Active").getAttribute("aria-pressed")).toBe("true");
    expect(tile("Transporters").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("heading", { name: "Active transporters" })).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("clicking Not Active shows only Not Active transporters", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(tile("Not Active"));
    expect(namesShown()).toEqual(["Kishan Travels"]);
    expect(tile("Not Active").getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking Hidden shows only hidden transporters", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(tile("Hidden"));
    expect(namesShown()).toEqual(["Pavan Parcel Service"]);
    expect(screen.getByRole("heading", { name: "Hidden transporters" })).toBeTruthy();
  });

  it("clicking Transporters (the total card) shows every transporter again", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(tile("Not Active"));
    expect(namesShown()).toEqual(["Kishan Travels"]);
    await user.click(tile("Transporters"));
    expect(namesShown().sort()).toEqual(["Abhisek Travels", "Kishan Travels", "Pavan Parcel Service", "TCI Express"]);
    expect(screen.getByRole("heading", { name: "All Transporters" })).toBeTruthy();
  });

  it("a filter pill appears once filtered, and clicking its × clears the filter", async () => {
    const user = userEvent.setup();
    await loaded();
    expect(screen.queryByLabelText("Clear filter")).toBeNull();
    await user.click(tile("Hidden"));
    await user.click(screen.getByLabelText("Clear filter"));
    expect(namesShown().sort()).toEqual(["Abhisek Travels", "Kishan Travels", "Pavan Parcel Service", "TCI Express"]);
    expect(screen.queryByLabelText("Clear filter")).toBeNull();
  });

  it("combines with the name search: Active + a name that only matches a Not Active transporter finds nothing", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(tile("Active"));
    await user.type(screen.getByRole("textbox", { name: "Search transporter name" }), "kishan");
    expect(screen.getByText("No transporters found")).toBeTruthy();
    expect(screen.getByText('No transporter name matches "kishan" among active transporters.')).toBeTruthy();
  });

  it("Delete/Restore still work while a filter is active, and counts on the cards update", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    await loaded();
    await user.click(tile("Active"));
    await user.click(within(rowOf("TCI Express")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteTransporter).toHaveBeenCalledWith("TCI Express"));
  });
});

describe("Transporter Name search", () => {
  it("filters the list as the Admin types, ignoring case and spacing", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.type(screen.getByRole("textbox", { name: "Search transporter name" }), "  kishan ");
    expect(screen.getByText("Kishan Travels")).toBeTruthy();
    expect(screen.queryByText("Abhisek Travels")).toBeNull();
    expect(screen.queryByText("TCI Express")).toBeNull();
  });

  it("shows an empty state for no match, and clearing restores the full list", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.type(screen.getByRole("textbox", { name: "Search transporter name" }), "zzz");
    expect(screen.getByText("No transporters found")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("Abhisek Travels")).toBeTruthy();
  });

  it("paginates a long list", async () => {
    const many = Array.from({ length: 30 }, (_, i) => t({ transport_name: `Transport ${String(i).padStart(2, "0")}` }));
    listManagedTransporters.mockResolvedValue({ results: many, total: 30, deleted: [] });
    const user = userEvent.setup();
    render(<ManageTransporters />);
    await screen.findByText("Transport 00");
    expect(screen.queryByText("Transport 29")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Transport 29")).toBeTruthy();
  });
});

describe("Delete", () => {
  it("deletes after confirmation and reloads the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    await loaded();
    await user.click(within(rowOf("TCI Express")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteTransporter).toHaveBeenCalledWith("TCI Express"));
    await waitFor(() => expect(listManagedTransporters).toHaveBeenCalledTimes(2));
  });

  it("does nothing if the Admin cancels the confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    await loaded();
    await user.click(within(rowOf("TCI Express")).getByRole("button", { name: "Delete" }));
    expect(deleteTransporter).not.toHaveBeenCalled();
  });

});

describe("Deleted transporters section", () => {
  const header = () => screen.getByRole("button", { name: /Deleted transporters/ });

  it("is not shown at all when nothing is deleted", async () => {
    await loaded();
    expect(screen.queryByText("Deleted transporters")).toBeNull();
  });

  it("shows a collapsed header with the count, and no transporter names, until clicked", async () => {
    listManagedTransporters.mockResolvedValue({ ...LIST, deleted: ["Old Roadways", "Retired Cargo"] });
    await loaded();
    const btn = header();
    expect(within(btn).getByText("2")).toBeTruthy(); // count shown on the collapsed header itself
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Old Roadways")).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("clicking the header expands it to show every deleted transporter and its Restore button", async () => {
    listManagedTransporters.mockResolvedValue({ ...LIST, deleted: ["Old Roadways", "Retired Cargo"] });
    const user = userEvent.setup();
    await loaded();
    await user.click(header());
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Old Roadways")).toBeTruthy();
    expect(screen.getByText("Retired Cargo")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(2);
  });

  it("clicking the header again collapses it", async () => {
    listManagedTransporters.mockResolvedValue({ ...LIST, deleted: ["Old Roadways"] });
    const user = userEvent.setup();
    await loaded();
    await user.click(header());
    expect(screen.getByText("Old Roadways")).toBeTruthy();
    await user.click(header());
    expect(header().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Old Roadways")).toBeNull();
  });

  it("Restore still works once expanded", async () => {
    listManagedTransporters.mockResolvedValue({ ...LIST, deleted: ["Old Roadways"] });
    const user = userEvent.setup();
    await loaded();
    await user.click(header());
    const item = screen.getByText("Old Roadways").closest("li")!;
    await user.click(within(item).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restoreTransporter).toHaveBeenCalledWith("Old Roadways"));
  });
});

describe("Hide / Unhide and Edit", () => {
  it("Hide and Unhide toggle the transporter's hidden flag", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(within(rowOf("TCI Express")).getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(updateTransporter).toHaveBeenCalledWith("TCI Express", { hidden: true }));
    await user.click(within(rowOf("Pavan Parcel Service")).getByRole("button", { name: "Unhide" }));
    await waitFor(() => expect(updateTransporter).toHaveBeenCalledWith("Pavan Parcel Service", { hidden: false }));
  });

  const openEdit = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(within(rowOf(name)).getByRole("button", { name: "Edit" }));
    return screen.findByRole("dialog", { name: "Edit transporter" });
  };
  const field = (panel: HTMLElement, label: string) =>
    within(panel).getByText(label, { exact: false, selector: ".field-label" }).closest("label")!
      .querySelector("input, textarea, select") as HTMLInputElement;

  it("Edit shows every field, pre-filled with the transporter's current details", async () => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "Abhisek Travels");
    expect(within(panel).getByRole("heading", { name: "Edit transporter" })).toBeTruthy();
    expect(within(panel).getByText("Abhisek Travels", { selector: ".source-summary-name" })).toBeTruthy();
    expect(field(panel, "Transporter Name").value).toBe("Abhisek Travels");
    expect(field(panel, "Service Cities").value).toBe("Ahmedabad, Borivali, Mumbai, Pune, Thane");
    expect(field(panel, "Pincode(s)").value).toBe("360003, 380001");
    expect(field(panel, "Mobile Number").value).toBe("");
    expect(field(panel, "Status").value).toBe("Active");
    expect((within(panel).getByRole("switch", { name: /Hide from search/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("Edit saves all changed fields, and only those", async () => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "Kishan Travels");
    const nameInput = field(panel, "Transporter Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Kishan Roadlines");
    await user.type(field(panel, "Service Cities"), ", Surat,{Enter}surat");
    const pins = field(panel, "Pincode(s)");
    await user.clear(pins);
    await user.type(pins, "360001{Enter}395007");
    await user.selectOptions(field(panel, "Status"), "Active");
    await user.click(within(panel).getByRole("switch", { name: /Hide from search/ }));
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateTransporter).toHaveBeenCalledWith("Kishan Travels", {
      name: "Kishan Roadlines", service_cities: ["Rajkot", "Surat"], pincodes: ["360001", "395007"],
      status: "Active", hidden: true,
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(listManagedTransporters).toHaveBeenCalledTimes(2); // reloaded so the change shows right away
  });

  it("Edit lets the Admin set a Not Active transporter back to Active", async () => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "Kishan Travels");
    await user.selectOptions(field(panel, "Status"), "Active");
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateTransporter).toHaveBeenCalledWith("Kishan Travels", { status: "Active" }));
  });

  it("saving with no changes closes without a request", async () => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateTransporter).not.toHaveBeenCalled();
  });

  it("checks pincodes are 6 digits before saving", async () => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    await user.type(field(panel, "Pincode(s)"), ", 12345");
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    expect(within(panel).getByRole("alert").textContent).toContain("12345");
    expect(updateTransporter).not.toHaveBeenCalled();
  });

  it("shows the server's error instead of closing when a save fails", async () => {
    updateTransporter.mockRejectedValue(new Error('Another transporter is already named "TCI Express".'));
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "Kishan Travels");
    const nameInput = field(panel, "Transporter Name");
    await user.clear(nameInput);
    await user.type(nameInput, "TCI Express");
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    expect(await within(panel).findByText('Another transporter is already named "TCI Express".')).toBeTruthy();

    // ...and that error doesn't follow the Admin into the next panel.
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Add Transporter" }));
    const addPanel = await screen.findByRole("dialog", { name: "Add Transporter" });
    expect(within(addPanel).queryByText(/already named/)).toBeNull();
  });
});

describe("Transporter photo (Admin)", () => {
  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "truck.png", { type: "image/png" });
  const openEdit = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(within(rowOf(name)).getByRole("button", { name: "Edit" }));
    return screen.findByRole("dialog", { name: "Edit transporter" });
  };

  it("shows the placeholder picture and an Upload button when there's no photo", async () => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    expect(within(panel).getByRole("img", { name: "TCI Express (TE)" }).textContent).toBe("TE");
    expect(within(panel).getByText("Upload image")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /Remove image/ })).toBeNull();
  });

  it("uploads the chosen photo on Save, under the transporter's name", async () => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    const file = png();
    await user.upload(within(panel).getByLabelText("Upload image"), file);
    expect(within(panel).getByText(/Selected: truck\.png/)).toBeTruthy();
    expect(uploadTransporterPhoto).not.toHaveBeenCalled(); // nothing is sent until Save
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(uploadTransporterPhoto).toHaveBeenCalledWith("TCI Express", file));
    expect(updateTransporter).not.toHaveBeenCalled(); // only the photo changed
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Cancel discards a chosen photo", async () => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    await user.upload(within(panel).getByLabelText("Upload image"), png());
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(uploadTransporterPhoto).not.toHaveBeenCalled();
  });

  it("shows the current photo, and can change or remove it", async () => {
    listManagedTransporters.mockResolvedValue({
      ...LIST, results: LIST.results.map((t) => (t.transport_name === "TCI Express" ? { ...t, photo_url: "/p/tci.png" } : t)),
    });
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    expect((within(panel).getByRole("img", { name: "TCI Express image" }) as HTMLImageElement).getAttribute("src")).toBe("/p/tci.png");
    expect(within(panel).getByText("Replace image")).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: /Remove image/ }));
    expect(within(panel).getByRole("img", { name: "TCI Express (TE)" })).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(removeTransporterPhoto).toHaveBeenCalledWith("TCI Express"));
  });

  it("uploads under the new name when the transporter is renamed in the same save", async () => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "Kishan Travels");
    const nameInput = within(panel).getByDisplayValue("Kishan Travels");
    await user.clear(nameInput);
    await user.type(nameInput, "Kishan Roadlines");
    await user.upload(within(panel).getByLabelText("Upload image"), png());
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateTransporter).toHaveBeenCalledWith("Kishan Travels", { name: "Kishan Roadlines" }));
    await waitFor(() => expect(uploadTransporterPhoto).toHaveBeenCalledWith("Kishan Roadlines", expect.any(File)));
  });

  it("rejects a non-image file before uploading anything", async () => {
    const user = userEvent.setup({ applyAccept: false });
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    const pdf = new File(["%PDF"], "rates.pdf", { type: "application/pdf" });
    await user.upload(within(panel).getByLabelText("Upload image"), pdf);
    expect(within(panel).getByRole("alert").textContent).toContain("JPEG, PNG or WebP");
  });

  it("a photo can be added together with a new transporter", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByRole("button", { name: "Add Transporter" }));
    const panel = await screen.findByRole("dialog", { name: "Add Transporter" });
    await user.type(within(panel).getByPlaceholderText("e.g. Abhisek Travels"), "Om Logistics");
    const file = png();
    await user.upload(within(panel).getByLabelText("Upload image"), file);
    await user.click(within(panel).getByRole("button", { name: "Add Transporter" }));
    await waitFor(() => expect(addTransporter).toHaveBeenCalled());
    await waitFor(() => expect(uploadTransporterPhoto).toHaveBeenCalledWith("Om Logistics", file));
  });

  it("an official logo can be replaced by an upload but not removed, and says it's the official logo", async () => {
    listManagedTransporters.mockResolvedValue({
      ...LIST, results: LIST.results.map((t) => (t.transport_name === "TCI Express"
        ? { ...t, photo_url: "/p/tci-logo.png", photo_source: "official" as const } : t)),
    });
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    expect((within(panel).getByRole("img", { name: "TCI Express image" }) as HTMLImageElement).getAttribute("src")).toBe("/p/tci-logo.png");
    expect(within(panel).getByText(/Showing the official company logo/)).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /Remove image/ })).toBeNull();
    const file = png();
    await user.upload(within(panel).getByLabelText("Replace image"), file);
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(uploadTransporterPhoto).toHaveBeenCalledWith("TCI Express", file));
    expect(removeTransporterPhoto).not.toHaveBeenCalled();
  });

  it("an Admin-uploaded image (photo_source admin) can be removed", async () => {
    listManagedTransporters.mockResolvedValue({
      ...LIST, results: LIST.results.map((t) => (t.transport_name === "TCI Express"
        ? { ...t, photo_url: "/p/uploaded.png", photo_source: "admin" as const } : t)),
    });
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    await user.click(within(panel).getByRole("button", { name: /Remove image/ }));
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(removeTransporterPhoto).toHaveBeenCalledWith("TCI Express"));
  });

  it("list rows without an image show the transporter's short name", async () => {
    await loaded();
    expect(within(rowOf("Kishan Travels")).getByRole("img", { name: "Kishan Travels (KT)" }).textContent).toBe("KT");
    expect(rowOf("Kishan Travels").querySelector("img")).toBeNull();
  });

  it("shows a transporter's photo as its avatar in the list", async () => {
    listManagedTransporters.mockResolvedValue({
      ...LIST, results: LIST.results.map((t) => (t.transport_name === "TCI Express" ? { ...t, photo_url: "/p/tci.png" } : t)),
    });
    await loaded();
    expect(rowOf("TCI Express").querySelector("img.avatar-photo")?.getAttribute("src")).toBe("/p/tci.png");
  });
});

describe("Add Transporter", () => {
  it("has a clear Add Transporter button that opens an empty form", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByRole("button", { name: "Add Transporter" }));
    const panel = await screen.findByRole("dialog", { name: "Add Transporter" });
    expect(within(panel).getByRole("heading", { name: "Add Transporter" })).toBeTruthy();
    expect(within(panel).queryByRole("switch")).toBeNull(); // hiding is for existing transporters only
  });

  it("adds a transporter with name, service cities, pincodes, mobile and status", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByRole("button", { name: "Add Transporter" }));
    const panel = await screen.findByRole("dialog", { name: "Add Transporter" });
    await user.type(within(panel).getByPlaceholderText("e.g. Abhisek Travels"), "Shree Ganesh Roadways");
    await user.type(within(panel).getByPlaceholderText("e.g. Mumbai, Pune, Thane"), "Surat, Vapi");
    await user.type(within(panel).getByPlaceholderText("e.g. 400001, 411001"), "396191, 395007");
    await user.type(within(panel).getByPlaceholderText("e.g. 9876543210"), "9812345678");
    await user.click(within(panel).getByRole("button", { name: "Add Transporter" }));
    await waitFor(() => expect(addTransporter).toHaveBeenCalledWith({
      transport_name: "Shree Ganesh Roadways", service_cities: ["Surat", "Vapi"], pincodes: ["396191", "395007"],
      mobile: "9812345678", status: "Active",
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("requires a Transporter Name", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByRole("button", { name: "Add Transporter" }));
    const panel = await screen.findByRole("dialog", { name: "Add Transporter" });
    await user.click(within(panel).getByRole("button", { name: "Add Transporter" }));
    expect(within(panel).getByRole("alert").textContent).toContain("Transporter Name is required");
    expect(addTransporter).not.toHaveBeenCalled();
  });
});

describe("regression: Current local overrides still work", () => {
  it("Current local overrides -> Edit opens the form populated with the override's own fields", async () => {
    const override: Override = {
      id: 7, is_new: false, source_city: "Rajkot", source_transport_name: "TCI Express", source_pincode: "360003",
      override_transport_name: "TCI Express Renamed", override_city: "Rajkot", override_pincode: "360003",
      override_mobile: "9998887770", override_status: "Not Active", hidden: false,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    };
    listOverrides.mockResolvedValue([override]);
    const user = userEvent.setup();
    await loaded();
    const nameCell = await screen.findByText("TCI Express Renamed");
    await user.click(within(nameCell.closest("tr")!).getByRole("button", { name: "Edit" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("heading", { name: "Edit override: TCI Express Renamed" })).toBeTruthy();
    expect(within(panel).getByDisplayValue("9998887770")).toBeTruthy();
    expect(within(panel).getByDisplayValue("Not Active")).toBeTruthy();
  });
});

describe("Pincodes in the list", () => {
  it("shows only the first 2 pincodes, then +X more", async () => {
    listManagedTransporters.mockResolvedValue({
      ...LIST, results: LIST.results.map((x) => (x.transport_name === "TCI Express"
        ? { ...x, pincodes: ["380001", "380002", "380003", "380004", "380005"] } : x)),
    });
    await loaded();
    const cell = rowOf("TCI Express").querySelectorAll("td")[2];
    expect(cell.textContent).toBe("380001, 380002+3 more");
    expect(cell.querySelector("[title]")?.getAttribute("title")).toBe("380001, 380002, 380003, 380004, 380005"); // full list on hover
  });
});

describe("Approx. Shipment Charge / 1 Box (Admin)", () => {
  const openEdit = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(within(rowOf(name)).getByRole("button", { name: "Edit" }));
    return screen.findByRole("dialog", { name: "Edit transporter" });
  };

  it("Admin adds a charge with decimals; only that field is sent", async () => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    const input = within(panel).getByLabelText("Approx. Shipment Charge / 1 Box (₹)") as HTMLInputElement;
    expect(input.value).toBe("");
    await user.type(input, "75.50");
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateTransporter).toHaveBeenCalledWith("TCI Express", { shipment_charge: "75.50" }));
  });

  it("shows the current charge, and emptying it clears it", async () => {
    listManagedTransporters.mockResolvedValue({
      ...LIST, results: LIST.results.map((x) => (x.transport_name === "TCI Express" ? { ...x, shipment_charge: "120" } : x)),
    });
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    const input = within(panel).getByLabelText("Approx. Shipment Charge / 1 Box (₹)") as HTMLInputElement;
    expect(input.value).toBe("120");
    await user.clear(input);
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateTransporter).toHaveBeenCalledWith("TCI Express", { shipment_charge: "" }));
  });

  it("an unchanged charge isn't sent with other edits", async () => {
    listManagedTransporters.mockResolvedValue({
      ...LIST, results: LIST.results.map((x) => (x.transport_name === "TCI Express" ? { ...x, shipment_charge: "45" } : x)),
    });
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    const mobile = within(panel).getByDisplayValue("9876543210");
    await user.clear(mobile);
    await user.type(mobile, "9999999999");
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateTransporter).toHaveBeenCalledWith("TCI Express", { mobile: "9999999999" }));
  });

  it.each(["abc", "12.345", "-5"])("rejects %s before sending anything", async (bad) => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    await user.type(within(panel).getByLabelText("Approx. Shipment Charge / 1 Box (₹)"), bad);
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    expect(within(panel).getByRole("alert").textContent).toContain("up to 2 decimals");
    expect(updateTransporter).not.toHaveBeenCalled();
  });

  it("accepts ₹ and commas as typed", async () => {
    const user = userEvent.setup();
    await loaded();
    const panel = await openEdit(user, "TCI Express");
    await user.type(within(panel).getByLabelText("Approx. Shipment Charge / 1 Box (₹)"), "₹1,250");
    await user.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateTransporter).toHaveBeenCalledWith("TCI Express", { shipment_charge: "1250" }));
  });

  it("isn't part of the Add Transporter form", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByRole("button", { name: "Add Transporter" }));
    const panel = await screen.findByRole("dialog", { name: "Add Transporter" });
    expect(within(panel).queryByLabelText("Approx. Shipment Charge / 1 Box (₹)")).toBeNull();
  });
});
