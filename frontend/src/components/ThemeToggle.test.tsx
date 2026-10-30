import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { installFakeBackend } from "../test/fakeBackend";
import { applyTheme, loadTheme } from "../theme";
import ThemeToggle from "./ThemeToggle";

const setSystemDark = (dark: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: dark && q.includes("dark"), addEventListener() {}, removeEventListener() {} })) as never;
};

beforeEach(() => {
  installFakeBackend();
  sessionStorage.clear();
  localStorage.clear();
  setSystemDark(false);
  applyTheme(loadTheme()); // as main.tsx does on startup with nothing saved (Dark is the default)
});
afterEach(cleanup);

const theme = () => document.documentElement.getAttribute("data-theme");
const renderSidebar = () => render(<ThemeToggle />);

describe("Top bar Light/Dark toggle", () => {
  it("starts in Dark (the default) with a Sun, and switches the whole app to Light", async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(theme()).toBe("dark");
    const btn = screen.getByRole("button", { name: "Switch to light theme" });
    expect(btn.textContent).toContain("Light mode");
    await user.click(btn);
    expect(theme()).toBe("light");
    expect(localStorage.getItem("transportFinder.theme")).toBe("light");
    expect(screen.getByRole("button", { name: "Switch to dark theme" }).textContent).toContain("Dark mode"); // Moon now
  });

  it("switches back to Dark", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(theme()).toBe("dark");
    expect(localStorage.getItem("transportFinder.theme")).toBe("dark");
  });

  it("the choice survives a refresh/restart", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSidebar();
    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    unmount();
    document.documentElement.removeAttribute("data-theme");
    applyTheme(loadTheme()); // startup
    renderSidebar();
    expect(theme()).toBe("light");
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeTruthy();
  });

  it("with System on a dark device, it shows the Sun and switches to Light", async () => {
    setSystemDark(true);
    applyTheme("system");
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(theme()).toBe("light");
  });

  it.each(["Admin", "User"] as const)("is in the top bar for %s, and doesn't change the page you're on", async (role) => {
    render(<App />);
    const user = userEvent.setup();
    if (role === "User") await user.click(screen.getByRole("tab", { name: /User/ }));
    await user.type(screen.getByPlaceholderText("Enter your login ID"), `${role}_deodap@123`);
    await user.type(screen.getByPlaceholderText("Enter password"), `${role}@123`);
    await user.click(screen.getByRole("button", { name: new RegExp(`Sign in as ${role}`) }));
    await screen.findByText("Find the right transporter.");
    const topbar = document.querySelector(".topbar") as HTMLElement;
    await user.click(within(topbar).getByRole("button", { name: "Switch to light theme" }));
    expect(theme()).toBe("light");
    expect(screen.getByText("Find the right transporter.")).toBeTruthy();
  });
});

describe("Toggle and Settings > Appearance stay in sync", () => {
  async function openSettings() {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Enter your login ID"), "Admin_deodap@123");
    await user.type(screen.getByPlaceholderText("Enter password"), "Admin@123");
    await user.click(screen.getByRole("button", { name: /Sign in as Admin/ }));
    await screen.findByText("Find the right transporter.");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(await screen.findByRole("tab", { name: "Appearance" }));
    return { user, appearance: await screen.findByRole("tabpanel", { name: "Appearance" }) };
  }

  it("the toggle updates the Settings selection (Dark is the default)", async () => {
    const { user, appearance } = await openSettings();
    expect(within(appearance).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(within(appearance).getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");
    expect(within(appearance).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("false");
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
