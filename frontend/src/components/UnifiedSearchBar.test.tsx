import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UnifiedSearchBar from "./UnifiedSearchBar";
import type { Suggestion } from "../services/api";

afterEach(cleanup);

const suggestTransport = vi.fn();
vi.mock("../services/api", () => ({
  suggestTransport: (...args: unknown[]) => suggestTransport(...args),
}));

function setup(overrides: Partial<Parameters<typeof UnifiedSearchBar>[0]> = {}) {
  const props = {
    value: "",
    loading: false,
    onChange: vi.fn(),
    onSearch: vi.fn(),
    onQuickPick: vi.fn(),
    onSuggestionPick: vi.fn(),
    ...overrides,
  };
  const utils = render(<UnifiedSearchBar {...props} />);
  return { ...utils, props };
}

beforeEach(() => {
  suggestTransport.mockReset().mockResolvedValue([]);
});

describe("UnifiedSearchBar autocomplete", () => {
  it("fetches and shows real suggestions, tagged with their type", async () => {
    const suggestions: Suggestion[] = [
      { type: "pincode", value: "360003" },
      { type: "city", value: "Rajkot" },
      { type: "state", value: "Gujarat" },
      { type: "transporter", value: "Pavan Parcel Service" },
    ];
    suggestTransport.mockResolvedValue(suggestions);
    setup({ value: "Pav" });

    await waitFor(() => expect(suggestTransport).toHaveBeenCalledWith("Pav"));
    // Scoped to the list: some values (360003, Rajkot, Gujarat) also exist as Popular Searches tags.
    const list = await screen.findByRole("listbox");
    const options = within(list).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "360003Pincode",
      "RajkotCity",
      "GujaratState",
      "Pavan Parcel ServiceTransporter",
    ]);
  });

  it("clicking a suggestion calls onSuggestionPick with its exact type and value", async () => {
    suggestTransport.mockResolvedValue([{ type: "transporter", value: "Pavan Travels" }]);
    const user = userEvent.setup();
    const { props } = setup({ value: "Pav" });

    const option = await screen.findByText("Pavan Travels");
    await user.click(option);

    expect(props.onSuggestionPick).toHaveBeenCalledWith({ type: "transporter", value: "Pavan Travels" });
  });

  it("does not re-suggest (and reopen over the results) for the value that was just picked", async () => {
    suggestTransport.mockResolvedValue([{ type: "transporter", value: "Pavan Parcel Service" }]);
    const user = userEvent.setup();
    const { props, rerender } = setup({ value: "Pav" });
    await user.click(await screen.findByText("Pavan Parcel Service"));
    suggestTransport.mockClear();

    // The parent then sets the box to the picked value, as TransportFinder does.
    rerender(<UnifiedSearchBar {...props} value="Pavan Parcel Service" />);
    await new Promise((r) => setTimeout(r, 350)); // past the 200ms debounce
    expect(suggestTransport).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not re-suggest for a Popular Searches term once it's clicked", async () => {
    const user = userEvent.setup();
    const { props, rerender } = setup();
    await user.click(screen.getByRole("button", { name: "Rajkot" }));
    rerender(<UnifiedSearchBar {...props} value="Rajkot" />);
    await new Promise((r) => setTimeout(r, 350));
    expect(suggestTransport).not.toHaveBeenCalled();
  });

  it("does not fetch suggestions for an empty query", () => {
    setup({ value: "" });
    expect(suggestTransport).not.toHaveBeenCalled();
  });

  it("clicking a Popular Searches tag calls onQuickPick with that term", async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole("button", { name: "Rajkot" }));
    expect(props.onQuickPick).toHaveBeenCalledWith("Rajkot");
  });

  it("submitting the form without picking a suggestion calls onSearch", async () => {
    const user = userEvent.setup();
    const { props } = setup({ value: "360003" });
    await user.click(screen.getByRole("button", { name: /Search Transport/ }));
    expect(props.onSearch).toHaveBeenCalled();
    expect(props.onSuggestionPick).not.toHaveBeenCalled();
  });

  it("shows a validation hint only after an empty search is attempted", async () => {
    const user = userEvent.setup();
    setup({ value: "" });
    expect(screen.queryByText(/Enter a pincode/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Search Transport/ }));
    expect(await screen.findByText(/Enter a pincode, city, state or transporter name\./)).toBeTruthy();
  });

  it("ArrowDown then Enter picks the highlighted suggestion instead of free-text searching", async () => {
    suggestTransport.mockResolvedValue([
      { type: "city", value: "Rajkot" },
      { type: "transporter", value: "Rajdhani Roadways" },
    ]);
    const { props } = setup({ value: "Raj" });
    const input = await screen.findByRole("combobox");
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.submit(input.closest("form")!);
    expect(props.onSuggestionPick).toHaveBeenCalledWith({ type: "transporter", value: "Rajdhani Roadways" });
    expect(props.onSearch).not.toHaveBeenCalled();
  });

  it("Escape closes the open suggestion list", async () => {
    suggestTransport.mockResolvedValue([{ type: "city", value: "Rajkot" }]);
    setup({ value: "Raj" });
    const input = await screen.findByRole("combobox");
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "Escape" });
    // The list closes; "Rajkot" itself still exists as a Popular Searches tag, so check the list.
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });
});
