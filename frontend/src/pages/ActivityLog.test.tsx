import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { FakeBackend, installFakeBackend } from "../test/fakeBackend";
import { formatWhen } from "./ActivityLog";

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend();
  sessionStorage.clear();
});
afterEach(cleanup);

async function loginAs(role: "Admin" | "User") {
  const user = userEvent.setup();
  if (role === "User") await user.click(screen.getByRole("tab", { name: /User/ }));
  await user.type(screen.getByPlaceholderText("Enter your login ID"), `${role}_deodap@123`);
  await user.type(screen.getByPlaceholderText("Enter password"), `${role}@123`);
  await user.click(screen.getByRole("button", { name: new RegExp(`Sign in as ${role}`) }));
  await screen.findByText("Find the right transporter.");
  await waitFor(() => expect(backend.activity.length).toBeGreaterThan(0)); // "Panel opened" has been reported
  return user;
}

const table = () => screen.findByRole("region", { name: "Activity log table" });

describe("Activity log", () => {
  it("records the panel opening on sign-in, and shows it with who and when", async () => {
    render(<App />);
    const user = await loginAs("Admin");
    await waitFor(() => expect(backend.calls("/api/activity").some((c) => c.init?.method === "POST")).toBe(true));
    await user.click(screen.getByRole("button", { name: "Activity log" }));
    const t = await table();
    const row = within(t).getByText("Panel opened").closest("tr")!;
    expect(within(row).getByText(/Admin_deodap@123/)).toBeTruthy();
    expect(within(row).getByText(formatWhen("2026-10-30T08:00:00+00:00"))).toBeTruthy();
    expect(within(t).getByRole("columnheader", { name: "IP address" })).toBeTruthy(); // Admin only
  });

  it("records a search with what was searched", async () => {
    render(<App />);
    const user = await loginAs("Admin");
    await user.type(screen.getByRole("combobox"), "360001");
    await user.click(screen.getByRole("button", { name: /Search results/ }));
    await waitFor(() => expect(backend.activity.some((e) => e.event === "Search performed")).toBe(true));
    expect(backend.activity.find((e) => e.event === "Search performed")!.detail).toContain('"360001"');
    await user.click(screen.getByRole("button", { name: "Activity log" }));
    expect(within(await table()).getByText(/Searched for "360001"/)).toBeTruthy();
  });

  it("a User sees their own activity, without IP addresses or Admin filters", async () => {
    render(<App />);
    const user = await loginAs("User");
    await user.click(screen.getByRole("button", { name: "Activity log" }));
    const t = await table();
    expect(within(t).getByText(/User_deodap@123/)).toBeTruthy();
    expect(within(t).queryByRole("columnheader", { name: "IP address" })).toBeNull();
    expect(within(screen.getByRole("combobox", { name: "Type" })).queryByRole("option", { name: "Admin" })).toBeNull();
  });

  it("the type filter is sent to the server", async () => {
    render(<App />);
    const user = await loginAs("Admin");
    await user.click(screen.getByRole("button", { name: "Activity log" }));
    await table();
    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "search");
    await waitFor(() => expect(backend.calls("/api/activity?").some((c) => c.url.includes("kind=search"))).toBe(true));
  });
});
