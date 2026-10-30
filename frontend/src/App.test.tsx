import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import TransportFinder from "./pages/TransportFinder";
import { installFakeBackend } from "./test/fakeBackend";

afterEach(cleanup);

beforeEach(() => {
  // Sign-in and Settings go to the backend; this in-memory fake answers them (and resolves every
  // other request quietly) in this network-less test environment.
  installFakeBackend();
  // Each test starts logged out -- otherwise a previous test's saved session (sessionStorage
  // persists across tests within the same jsdom instance) leaks into the next one.
  sessionStorage.clear();
});

const DEMO_CREDENTIALS = {
  Admin: { id: "Admin_deodap@123", password: "Admin@123" },
  User: { id: "User_deodap@123", password: "User@123" },
};

async function loginAs(role: "Admin" | "User") {
  const user = userEvent.setup();
  if (role === "User") await user.click(screen.getByRole("tab", { name: /User/ }));
  await user.type(screen.getByPlaceholderText("Enter your login ID"), DEMO_CREDENTIALS[role].id);
  await user.type(screen.getByPlaceholderText("Enter password"), DEMO_CREDENTIALS[role].password);
  await user.click(screen.getByRole("button", { name: new RegExp(`Sign in as ${role}`) }));
}

describe("post-login landing page", () => {
  it("shows the Login page first, before any credentials are entered", () => {
    render(<App />);
    expect(screen.getByText("Welcome back")).toBeTruthy();
  });

  it("Admin login opens the Search page (not Manage Transporters, not a dashboard)", async () => {
    render(<App />);
    await loginAs("Admin");
    expect(await screen.findByText("Find the right transporter.")).toBeTruthy();
    expect(screen.queryByText("Welcome back")).toBeNull();
    expect(screen.queryByText("Transporter directory")).toBeNull();
  });

  it("User login opens the Search page", async () => {
    render(<App />);
    await loginAs("User");
    expect(await screen.findByText("Find the right transporter.")).toBeTruthy();
  });
});

describe("Manage Transporters access is Admin-only", () => {
  it("Admin sees the Manage Transporters nav item", async () => {
    render(<App />);
    await loginAs("Admin");
    await screen.findByText("Find the right transporter.");
    expect(screen.getByRole("button", { name: "Manage transporters" })).toBeTruthy();
  });

  it("User does not see the Manage Transporters nav item", async () => {
    render(<App />);
    await loginAs("User");
    await screen.findByText("Find the right transporter.");
    expect(screen.queryByText("Manage transporters")).toBeNull();
  });

  it("Admin can open Manage Transporters via the nav, and return to Search", async () => {
    const user = userEvent.setup();
    render(<App />);
    await loginAs("Admin");
    await screen.findByText("Find the right transporter."); // lands on Search first
    await user.click(screen.getByRole("button", { name: "Manage transporters" }));
    await screen.findByText("Transporter directory");
    await user.click(screen.getByRole("button", { name: "Find transport" })); // and back
    expect(await screen.findByText("Find the right transporter.")).toBeTruthy();
  });

  it("a User role that somehow ends up on the Manage Transporters view is redirected to Search", async () => {
    // Simulates the "direct URL access" case: this app has no router (view is plain React state),
    // so the equivalent scenario is the role becoming non-admin while the view is still "manage".
    const user = userEvent.setup();
    const { rerender } = render(<TransportFinder role="admin" token="t" onLogout={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Manage transporters" }));
    await screen.findByText("Transporter directory");
    rerender(<TransportFinder role="user" token="t" onLogout={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("Transporter directory")).toBeNull());
    expect(await screen.findByText("Find the right transporter.")).toBeTruthy();
    expect(screen.queryByText("Manage transporters")).toBeNull();
  });
});

describe("session persists across a page refresh (sessionStorage), logout clears it", () => {
  it("Admin session survives a simulated refresh: lands on Search, still has Manage Transporters", async () => {
    const { unmount } = render(<App />);
    await loginAs("Admin");
    await screen.findByText("Find the right transporter.");
    unmount(); // a refresh discards the whole React tree and re-mounts from scratch

    render(<App />);
    expect(screen.queryByText("Welcome back")).toBeNull(); // not sent back to Login
    expect(await screen.findByText("Find the right transporter.")).toBeTruthy(); // Search, not Manage
    expect(screen.getByRole("button", { name: "Manage transporters" })).toBeTruthy();
  });

  it("User session survives a simulated refresh: lands on Search, no Manage Transporters", async () => {
    const { unmount } = render(<App />);
    await loginAs("User");
    await screen.findByText("Find the right transporter.");
    unmount();

    render(<App />);
    expect(screen.queryByText("Welcome back")).toBeNull();
    expect(await screen.findByText("Find the right transporter.")).toBeTruthy();
    expect(screen.queryByText("Manage transporters")).toBeNull();
  });

  it("the password is never written to storage, only the role and a session token", async () => {
    render(<App />);
    await loginAs("Admin");
    await screen.findByText("Find the right transporter.");
    const stored = JSON.stringify(sessionStorage);
    expect(stored).not.toContain("Admin@123");
    expect(sessionStorage.getItem("transportFinder.role")).toBe("admin");
  });

  it("logout clears the saved session, so a refresh afterwards returns to Login", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await loginAs("Admin");
    await screen.findByText("Find the right transporter.");

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByText("Welcome back")).toBeTruthy();
    unmount(); // simulate the refresh that would follow

    render(<App />);
    expect(await screen.findByText("Welcome back")).toBeTruthy(); // back to Login, not Search
    expect(sessionStorage.getItem("transportFinder.role")).toBeNull();
  });
});
