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
});
afterEach(cleanup);

async function login(role: "Admin" | "User", id: string, password: string) {
  const user = userEvent.setup();
  if (role === "User") await user.click(screen.getByRole("tab", { name: /User/ }));
  await user.type(screen.getByPlaceholderText(`Enter ${role} ID`), id);
  await user.type(screen.getByPlaceholderText("Enter Password"), password);
  await user.click(screen.getByRole("button", { name: new RegExp(`Login as ${role}`) }));
  return user;
}

async function openUserManagement() {
  render(<App />);
  const user = await login("Admin", "Admin_deodap@123", "Admin@123");
  await screen.findByText("Find Transporters Near You");
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const section = await screen.findByRole("region", { name: "User Management" });
  await within(section).findByRole("list", { name: "Users" });
  return { user, section };
}

const row = (section: HTMLElement, id: string) => within(section).getByRole("listitem", { name: `User ${id}` });

async function addUser(user: ReturnType<typeof userEvent.setup>, section: HTMLElement, id: string, pw = "Password1") {
  await user.click(within(section).getByRole("button", { name: /Add User/ }));
  const form = within(section).getByRole("form", { name: "Add User" });
  await user.type(within(form).getByLabelText("User ID"), id);
  await user.type(within(form).getByLabelText("Password"), pw);
  await user.type(within(form).getByLabelText("Confirm password"), pw);
  await user.click(within(form).getByRole("button", { name: "Add User" }));
  await within(section).findByText(`User "${id}" added.`);
}

async function logout(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  await user.click(within(document.querySelector(".account-menu") as HTMLElement).getByRole("button", { name: /Log out/ }));
  await screen.findByText("Welcome Back");
}

describe("User Management access", () => {
  it("is shown to the Admin, listing existing Users", async () => {
    const { section } = await openUserManagement();
    expect(row(section, "User_deodap@123")).toBeTruthy();
    expect(within(row(section, "User_deodap@123")).getByText("Active")).toBeTruthy();
  });

  it("is not shown to a User, and nothing asks the server for the user list", async () => {
    render(<App />);
    const user = await login("User", "User_deodap@123", "User@123");
    await screen.findByText("Find Transporters Near You");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    expect(screen.queryByRole("region", { name: "User Management" })).toBeNull();
    expect(screen.queryByText("User Management")).toBeNull();
    expect(backend.calls("/api/settings/users")).toHaveLength(0);
  });
});

describe("Adding Users", () => {
  it("adds several Users, and each can log in with their own ID and password", async () => {
    const { user, section } = await openUserManagement();
    await addUser(user, section, "ravi", "Ravi2026pw");
    await addUser(user, section, "priya", "Priya2026pw");
    expect(row(section, "ravi")).toBeTruthy();
    expect(row(section, "priya")).toBeTruthy();
    expect(within(section).getByText("3 users · 3 active")).toBeTruthy();

    for (const [id, pw] of [["ravi", "Ravi2026pw"], ["priya", "Priya2026pw"]]) {
      await logout(user);
      await login("User", id, pw);
      expect(await screen.findByText("Find Transporters Near You")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Manage Transporters" })).toBeNull(); // still User permissions
    }
  });

  it("refuses a duplicate ID (any letter case) and shows why", async () => {
    const { user, section } = await openUserManagement();
    await addUser(user, section, "ravi");
    await user.click(within(section).getByRole("button", { name: /Add User/ }));
    const form = within(section).getByRole("form", { name: "Add User" });
    await user.type(within(form).getByLabelText("User ID"), "RAVI");
    await user.type(within(form).getByLabelText("Password"), "Password1");
    await user.type(within(form).getByLabelText("Confirm password"), "Password1");
    await user.click(within(form).getByRole("button", { name: "Add User" }));
    expect((await within(section).findByText("That ID is already in use."))).toBeTruthy();
    expect(backend.users.filter((u) => u.login_id.toLowerCase() === "ravi")).toHaveLength(1);
  });

  it("checks the password before sending it", async () => {
    const { user, section } = await openUserManagement();
    await user.click(within(section).getByRole("button", { name: /Add User/ }));
    const form = within(section).getByRole("form", { name: "Add User" });
    await user.type(within(form).getByLabelText("User ID"), "ravi");
    await user.type(within(form).getByLabelText("Password"), "short");
    await user.type(within(form).getByLabelText("Confirm password"), "short");
    await user.click(within(form).getByRole("button", { name: "Add User" }));
    expect(within(form).getByRole("alert").textContent).toContain("at least 8 characters");
    expect(backend.calls("/api/settings/users").filter((c) => c.init?.method === "POST")).toHaveLength(0);
  });
});

describe("Editing Users", () => {
  it("changes a User's ID; the old ID stops working and the new one signs in", async () => {
    const { user, section } = await openUserManagement();
    await addUser(user, section, "ravi");
    await user.click(within(row(section, "ravi")).getByRole("button", { name: "Edit ID of ravi" }));
    const input = within(row(section, "ravi")).getByLabelText("New User ID");
    await user.clear(input);
    await user.type(input, "ravi.k");
    await user.click(within(row(section, "ravi")).getByRole("button", { name: "Save ID" }));
    expect(await within(section).findByText('User ID changed to "ravi.k".')).toBeTruthy();
    expect(row(section, "ravi.k")).toBeTruthy();

    await logout(user);
    await login("User", "ravi", "Password1");
    expect(await screen.findByText("Invalid ID or password")).toBeTruthy();
    cleanup();
    render(<App />);
    await login("User", "ravi.k", "Password1");
    expect(await screen.findByText("Find Transporters Near You")).toBeTruthy();
  });

  it("resets a User's password without needing the old one", async () => {
    const { user, section } = await openUserManagement();
    await addUser(user, section, "ravi");
    await user.click(within(row(section, "ravi")).getByRole("button", { name: "Reset password of ravi" }));
    const panel = within(row(section, "ravi"));
    await user.type(panel.getByLabelText("New password"), "Fresh2026x");
    await user.type(panel.getByLabelText("Confirm new password"), "Fresh2026x");
    await user.click(panel.getByRole("button", { name: "Reset password" }));
    expect(await within(section).findByText(/Password reset for "ravi"/)).toBeTruthy();
    expect(backend.user("ravi")?.password).toBe("Fresh2026x");
    const stored = JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });
    expect(stored).not.toContain("Fresh2026x");
  });
});

describe("Activating, deactivating and deleting", () => {
  it("a deactivated User can't log in (with a clear message) until reactivated", async () => {
    const { user, section } = await openUserManagement();
    await addUser(user, section, "ravi");
    await user.click(within(row(section, "ravi")).getByRole("button", { name: "Deactivate" }));
    expect(await within(section).findByText('"ravi" deactivated and signed out.')).toBeTruthy();
    expect(within(row(section, "ravi")).getByText("Inactive")).toBeTruthy();

    await logout(user);
    await login("User", "ravi", "Password1");
    expect(await screen.findByText(/deactivated/)).toBeTruthy();
    expect(screen.queryByText("Find Transporters Near You")).toBeNull();

    cleanup();
    await openUserManagement().then(async ({ user: u, section: s }) => {
      await u.click(within(row(s, "ravi")).getByRole("button", { name: "Activate" }));
      await within(s).findByText('"ravi" activated.');
      await logout(u);
    });
    await login("User", "ravi", "Password1");
    expect(await screen.findByText("Find Transporters Near You")).toBeTruthy();
  });

  it("deleting asks for confirmation, then removes the User so they can't log in", async () => {
    const { user, section } = await openUserManagement();
    await addUser(user, section, "ravi");
    await user.click(within(row(section, "ravi")).getByRole("button", { name: "Delete ravi" }));
    const confirm = within(row(section, "ravi")).getByRole("group", { name: "Confirm delete ravi" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(backend.user("ravi")).toBeTruthy(); // nothing deleted on Cancel

    await user.click(within(row(section, "ravi")).getByRole("button", { name: "Delete ravi" }));
    await user.click(within(row(section, "ravi")).getByRole("button", { name: /Delete User/ }));
    expect(await within(section).findByText('User "ravi" deleted.')).toBeTruthy();
    await waitFor(() => expect(within(section).queryByRole("listitem", { name: "User ravi" })).toBeNull());
    expect(backend.user("ravi")).toBeUndefined();

    await logout(user);
    await login("User", "ravi", "Password1");
    expect(await screen.findByText("Invalid ID or password")).toBeTruthy();
  });
});

describe("A User's own account", () => {
  it("a User changes only their own ID from Settings > Account", async () => {
    backend.users.push({ id: 7, login_id: "priya", password: "Priya2026pw", active: true });
    render(<App />);
    const user = await login("User", "priya", "Priya2026pw");
    await screen.findByText("Find Transporters Near You");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const acct = await screen.findByRole("region", { name: "Account" });
    expect(await within(acct).findByText("priya")).toBeTruthy(); // their own ID, not another User's
    await user.type(within(acct).getByLabelText("New User ID"), "priya.s");
    await user.type(within(acct).getByLabelText("Current password"), "Priya2026pw");
    await user.click(within(acct).getByRole("button", { name: "Change User ID" }));
    await within(acct).findByText(/User ID changed/);
    expect(backend.user("priya.s")).toBeTruthy();
    expect(backend.user("User_deodap@123")).toBeTruthy(); // the other User untouched
    expect(backend.admin.login_id).toBe("Admin_deodap@123");
  });
});

describe("Reset Password (Admin)", () => {
  it("every User shows their User ID and a Reset Password button -- never a password", async () => {
    const { user, section } = await openUserManagement();
    await addUser(user, section, "ravi", "Secret2026x");
    for (const id of ["ravi", "User_deodap@123"]) {
      const r = row(section, id);
      expect(within(r).getByText(id)).toBeTruthy();
      expect(within(r).getByRole("button", { name: `Reset password of ${id}` }).textContent).toContain("Reset Password");
    }
    expect(section.textContent).not.toContain("Secret2026x");
    expect(section.textContent).not.toContain("User@123");
    expect(section.querySelector('input[type="password"], input[type="text"]')).toBeNull(); // no password fields until asked
  });

  it("the new password is hidden by default, and Show/Hide toggles it while typing", async () => {
    const { user, section } = await openUserManagement();
    await user.click(within(section).getByRole("button", { name: "Reset password of User_deodap@123" }));
    const r = within(row(section, "User_deodap@123"));
    const pw = r.getByLabelText("New password") as HTMLInputElement;
    const confirm = r.getByLabelText("Confirm new password") as HTMLInputElement;
    expect(pw.value).toBe(""); // the current password is never filled in
    expect([pw.type, confirm.type]).toEqual(["password", "password"]);
    await user.type(pw, "Fresh2026x");
    await user.click(r.getByRole("button", { name: /Show password/ }));
    expect([pw.type, confirm.type]).toEqual(["text", "text"]);
    expect(r.getByRole("button", { name: /Hide password/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(r.getByRole("button", { name: /Hide password/ }));
    expect([pw.type, confirm.type]).toEqual(["password", "password"]);
  });

  it("after saving, the password isn't kept or shown anywhere -- reopening starts empty and hidden", async () => {
    const { user, section } = await openUserManagement();
    await user.click(within(section).getByRole("button", { name: "Reset password of User_deodap@123" }));
    let r = within(row(section, "User_deodap@123"));
    await user.type(r.getByLabelText("New password"), "Fresh2026x");
    await user.type(r.getByLabelText("Confirm new password"), "Fresh2026x");
    await user.click(r.getByRole("button", { name: /Show password/ }));
    await user.click(r.getByRole("button", { name: "Reset password" }));
    await within(section).findByText(/Password reset for "User_deodap@123"/);
    expect(backend.user("User_deodap@123")?.password).toBe("Fresh2026x"); // sent to the API (which stores a hash)
    expect(section.textContent).not.toContain("Fresh2026x");
    expect(section.querySelector("input")).toBeNull();

    await user.click(within(section).getByRole("button", { name: "Reset password of User_deodap@123" }));
    r = within(row(section, "User_deodap@123"));
    expect((r.getByLabelText("New password") as HTMLInputElement).value).toBe("");
    expect((r.getByLabelText("New password") as HTMLInputElement).type).toBe("password");
  });

  it("Cancel discards what was typed", async () => {
    const { user, section } = await openUserManagement();
    await user.click(within(section).getByRole("button", { name: "Reset password of User_deodap@123" }));
    let r = within(row(section, "User_deodap@123"));
    await user.type(r.getByLabelText("New password"), "Typed2026x");
    await user.click(r.getByRole("button", { name: "Cancel" }));
    expect(backend.user("User_deodap@123")?.password).toBe("User@123"); // nothing saved
    await user.click(within(section).getByRole("button", { name: "Reset password of User_deodap@123" }));
    r = within(row(section, "User_deodap@123"));
    expect((r.getByLabelText("New password") as HTMLInputElement).value).toBe("");
  });

  it("the User can still change their own password in Security", async () => {
    render(<App />);
    const user = await login("User", "User_deodap@123", "User@123");
    await screen.findByText("Find Transporters Near You");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const sec = await screen.findByRole("region", { name: "Security" });
    await user.type(within(sec).getByLabelText("Current password"), "User@123");
    await user.type(within(sec).getByLabelText("New password"), "Mine2026x");
    await user.type(within(sec).getByLabelText("Confirm new password"), "Mine2026x");
    await user.click(within(sec).getByRole("button", { name: "Change password" }));
    await within(sec).findByText(/Password changed/);
    expect(backend.user("User_deodap@123")?.password).toBe("Mine2026x");
  });
});
