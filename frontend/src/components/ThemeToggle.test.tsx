import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { installFakeBackend } from "../test/fakeBackend";
import { applyTheme, loadTheme } from "../theme";
import Sidebar from "./Sidebar";

const setSystemDark = (dark: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: dark && q.includes("dark"), addEventListener() {}, removeEventListener() {} })) as never;
};

beforeEach(() => {
  installFakeBackend();
  sessionStorage.clear();
  localStorage.clear();
  setSystemDark(false);
  applyTheme("system"); // as main.tsx does on startup with nothing saved
});
afterEach(cleanup);

const theme = () => document.documentElement.getAttribute("data-theme");
const renderSidebar = () => render(<Sidebar view="search" isAdmin={false} onNavigate={() => {}} />);

describe("Sidebar Light/Dark toggle", () => {
  it("shows a Moon (Dark mode) in Light mode and switches the whole app to Dark", async () => {
    const user = userEvent.setup();
    renderSidebar();
    const btn = screen.getByRole("button", { name: "Switch to dark theme" });
    expect(btn.textContent).toContain("Dark mode");
    await user.click(btn);
    expect(theme()).toBe("dark");
    expect(localStorage.getItem("transportFinder.theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" }).textContent).toContain("Light mode"); // Sun now
  });

  it("switches back to Light", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(theme()).toBe("light");
    expect(localStorage.getItem("transportFinder.theme")).toBe("light");
  });

  it("the choice survives a refresh/restart", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSidebar();
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    unmount();
    document.documentElement.removeAttribute("data-theme");
    applyTheme(loadTheme()); // startup
    renderSidebar();
    expect(theme()).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeTruthy();
  });

  it("with System on a dark device, it shows the Sun and switches to Light", async () => {
    setSystemDark(true);
    applyTheme("system");
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(theme()).toBe("light");
  });

  it("is in the navigation for both roles, next to the destinations (the phone bottom bar too)", () => {
    render(<Sidebar view="search" isAdmin onNavigate={() => {}} />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("button", { name: "Switch to dark theme" })).toBeTruthy();
    cleanup();
    renderSidebar();
    expect(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("button", { name: "Switch to dark theme" })).toBeTruthy();
  });

  it("doesn't change the page you're on", async () => {
    const user = userEvent.setup();
    let navigated = false;
    render(<Sidebar view="search" isAdmin onNavigate={() => { navigated = true; }} />);
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(navigated).toBe(false);
  });
});

describe("Toggle and Settings > Appearance stay in sync", () => {
  async function openSettings() {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Enter Admin ID"), "Admin_deodap@123");
    await user.type(screen.getByPlaceholderText("Enter Password"), "Admin@123");
    await user.click(screen.getByRole("button", { name: /Login as Admin/ }));
    await screen.findByText("Find Transporters Near You");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    return { user, appearance: await screen.findByRole("region", { name: "Appearance" }) };
  }

  it("the toggle updates the Settings selection", async () => {
    const { user, appearance } = await openSettings();
    expect(within(appearance).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(within(appearance).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(within(appearance).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("false");
  });

  it("Settings choices (including System) update the toggle", async () => {
    const { user, appearance } = await openSettings();
    await user.click(within(appearance).getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeTruthy();
    setSystemDark(false);
    await user.click(within(appearance).getByRole("radio", { name: "System" }));
    expect(theme()).toBe("light");
    expect(localStorage.getItem("transportFinder.theme")).toBe("system");
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeTruthy();
  });
});
