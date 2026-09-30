import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { FakeBackend, installFakeBackend } from "../test/fakeBackend";

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend();
  sessionStorage.clear();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(cleanup);

async function loginAs(role: "Admin" | "User", id?: string, password?: string) {
  const user = userEvent.setup();
  if (role === "User") await user.click(screen.getByRole("tab", { name: /User/ }));
  await user.type(screen.getByPlaceholderText(`Enter ${role} ID`), id ?? `${role}_deodap@123`);
  await user.type(screen.getByPlaceholderText("Enter Password"), password ?? `${role}@123`);
  await user.click(screen.getByRole("button", { name: new RegExp(`Login as ${role}`) }));
  await screen.findByText("Find Transporters Near You");
  return user;
}

async function openSettings(role: "Admin" | "User") {
  render(<App />);
  const user = await loginAs(role);
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });
  return user;
}

const section = (name: string) => screen.getByRole("region", { name });

describe("Settings navigation", () => {
  it.each(["Admin", "User"] as const)("%s sees Settings in the navigation and it opens the page", async (role) => {
    await openSettings(role);
    for (const name of ["Account", "Appearance", "Preferences", "Security"]) expect(section(name)).toBeTruthy();
  });

  it("is also in the account menu", async () => {
    render(<App />);
    const user = await loginAs("User");
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(within(document.querySelector(".account-menu") as HTMLElement).getByRole("button", { name: /Settings/ }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  it("adding Settings doesn't give User the Manage Transporters page", async () => {
    await openSettings("User");
    expect(screen.queryByRole("button", { name: "Manage Transporters" })).toBeNull();
  });
});

describe("Account", () => {
  it("shows the signed-in role and current ID", async () => {
    await openSettings("Admin");
    const acct = section("Account");
    expect(within(acct).getByText("Admin", { selector: ".role-pill" })).toBeTruthy();
    expect(await within(acct).findByText("Admin_deodap@123")).toBeTruthy();
  });

  it("User changes their own ID with the current password; the new ID then signs in", async () => {
    const user = await openSettings("User");
    const acct = section("Account");
    await within(acct).findByText("User_deodap@123");
    await user.type(within(acct).getByLabelText("New User ID"), "desk_user");
    await user.type(within(acct).getByLabelText("Current password"), "User@123");
    await user.click(within(acct).getByRole("button", { name: "Change User ID" }));
    expect(await within(acct).findByText(/User ID changed/)).toBeTruthy();
    expect(within(acct).getByText("desk_user")).toBeTruthy();
    expect(backend.users[0].login_id).toBe("desk_user");
    expect(backend.admin.login_id).toBe("Admin_deodap@123"); // Admin untouched

    await user.click(within(section("Security")).getByRole("button", { name: /Log out/ }));
    await screen.findByText("Welcome Back");
    await loginAs("User", "desk_user", "User@123");
  });

  it("shows the server's error for a wrong current password", async () => {
    const user = await openSettings("Admin");
    const acct = section("Account");
    await user.type(within(acct).getByLabelText("New Admin ID"), "ops_admin");
    await user.type(within(acct).getByLabelText("Current password"), "nope");
    await user.click(within(acct).getByRole("button", { name: "Change Admin ID" }));
    expect((await within(acct).findByRole("alert")).textContent).toContain("Current password is incorrect.");
    expect(backend.admin.login_id).toBe("Admin_deodap@123");
  });
});

describe("Security", () => {
  it("checks the new password before sending it", async () => {
    const user = await openSettings("Admin");
    const sec = section("Security");
    await user.type(within(sec).getByLabelText("Current password"), "Admin@123");
    await user.type(within(sec).getByLabelText("New password"), "short1");
    await user.type(within(sec).getByLabelText("Confirm new password"), "short1");
    await user.click(within(sec).getByRole("button", { name: "Change password" }));
    expect(within(sec).getByRole("alert").textContent).toContain("at least 8 characters");
    await user.clear(within(sec).getByLabelText("New password"));
    await user.type(within(sec).getByLabelText("New password"), "LongerPass1");
    await user.click(within(sec).getByRole("button", { name: "Change password" }));
    expect(within(sec).getByRole("alert").textContent).toContain("don't match");
    expect(backend.calls("/api/settings/account").filter((c) => c.init?.method === "PATCH")).toHaveLength(0);
  });

  it("changes the password; the password is sent only to the API, never stored in the browser", async () => {
    const user = await openSettings("Admin");
    const sec = section("Security");
    await user.type(within(sec).getByLabelText("Current password"), "Admin@123");
    await user.type(within(sec).getByLabelText("New password"), "NewPass2026");
    await user.type(within(sec).getByLabelText("Confirm new password"), "NewPass2026");
    await user.click(within(sec).getByRole("button", { name: "Change password" }));
    expect(await within(sec).findByText(/Password changed/)).toBeTruthy();
    expect(backend.admin.password).toBe("NewPass2026");
    const stored = JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });
    expect(stored).not.toMatch(/NewPass2026|Admin@123/);
  });

  it("Log out ends the session and returns to the login page", async () => {
    const user = await openSettings("User");
    await user.click(within(section("Security")).getByRole("button", { name: /Log out/ }));
    expect(await screen.findByText("Welcome Back")).toBeTruthy();
    expect(sessionStorage.getItem("transportFinder.token")).toBeNull();
    expect(backend.sessions.size).toBe(0);
  });

  it("an expired session sends the user back to login", async () => {
    const user = await openSettings("Admin");
    backend.sessions.clear(); // e.g. expired, or signed out by a password change elsewhere
    const acct = section("Account");
    await user.type(within(acct).getByLabelText("New Admin ID"), "x_admin");
    await user.type(within(acct).getByLabelText("Current password"), "Admin@123");
    await user.click(within(acct).getByRole("button", { name: "Change Admin ID" }));
    expect(await screen.findByText("Welcome Back")).toBeTruthy();
  });
});

describe("Appearance", () => {
  it("Dark applies immediately and is kept after a browser restart", async () => {
    const user = await openSettings("User");
    await user.click(within(section("Appearance")).getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("transportFinder.theme")).toBe("dark");
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    const { applyTheme, loadTheme } = await import("../theme"); // what main.tsx runs on startup
    applyTheme(loadTheme());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("Light and System are selectable; System follows the device setting", async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes("dark"), addEventListener() {}, removeEventListener() {} })) as never;
    const user = await openSettings("Admin");
    const group = within(section("Appearance"));
    expect(group.getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true"); // the default
    await user.click(group.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await user.click(group.getByRole("radio", { name: "System" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("transportFinder.theme")).toBe("system");
  });
});

describe("Preferences", () => {
  it("Admin edits and saves them", async () => {
    const user = await openSettings("Admin");
    const prefs = section("Preferences");
    await user.type(within(prefs).getByLabelText("Default pincode"), "360003");
    await user.selectOptions(within(prefs).getByLabelText("Default search type"), "city");
    await user.selectOptions(within(prefs).getByLabelText("Results per page"), "25");
    await user.click(within(prefs).getByRole("button", { name: "Save preferences" }));
    expect(await within(prefs).findByText("Preferences saved.")).toBeTruthy();
    expect(backend.preferences).toEqual({ default_pincode: "360003", default_search_type: "city", results_per_page: 25 });
  });

  it("rejects a pincode that isn't 6 digits", async () => {
    const user = await openSettings("Admin");
    const prefs = section("Preferences");
    await user.type(within(prefs).getByLabelText("Default pincode"), "3600");
    await user.click(within(prefs).getByRole("button", { name: "Save preferences" }));
    expect(within(prefs).getByRole("alert").textContent).toContain("6 digits");
    expect(backend.calls("/api/settings/preferences").filter((c) => c.init?.method === "PUT")).toHaveLength(0);
  });

  it("User can view them but not change them", async () => {
    backend.preferences = { default_pincode: "360003", default_search_type: "city", results_per_page: 25 };
    await openSettings("User");
    const prefs = section("Preferences");
    expect(await within(prefs).findByText("360003")).toBeTruthy();
    expect(within(prefs).getByText("City")).toBeTruthy();
    expect(within(prefs).getByText("25")).toBeTruthy();
    expect(prefs.querySelector("input, select")).toBeNull();
    expect(within(prefs).queryByRole("button")).toBeNull();
  });

  it("are applied to Search: default pincode pre-filled, results per page and search type used", async () => {
    backend.preferences = { default_pincode: "360003", default_search_type: "city", results_per_page: 25 };
    render(<App />);
    const user = await loginAs("User");
    const box = screen.getByRole("combobox") as HTMLInputElement;
    await waitFor(() => expect(box.value).toBe("360003"));
    await user.clear(box);
    await user.type(box, "Rajkot{Enter}");
    await waitFor(() => expect(backend.calls("/api/transport/search").length).toBeGreaterThan(0));
    const first = new URL(backend.calls("/api/transport/search")[0].url, "http://x");
    expect(first.searchParams.get("city")).toBe("Rajkot");
    expect(first.searchParams.get("page_size")).toBe("25");
  });

  it("with the defaults, Search behaves exactly as before", async () => {
    render(<App />);
    const user = await loginAs("User");
    const box = screen.getByRole("combobox") as HTMLInputElement;
    expect(box.value).toBe("");
    await user.type(box, "Rajkot{Enter}");
    await waitFor(() => expect(backend.calls("/api/transport/search").length).toBeGreaterThan(0));
    expect(new URL(backend.calls("/api/transport/search")[0].url, "http://x").searchParams.get("page_size")).toBe("50");
  });
});
