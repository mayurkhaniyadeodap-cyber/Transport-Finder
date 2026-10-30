import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeBackend } from "../test/fakeBackend";
import LoginPage from "./LoginPage";

afterEach(cleanup);
beforeEach(() => {
  installFakeBackend(); // the ID and password are checked by the backend
});

describe("LoginPage", () => {
  it("defaults to the Admin tab with a Login ID field and Sign in as Admin", () => {
    render(<LoginPage onLogin={vi.fn()} />);
    expect(screen.getByRole("tab", { name: /Admin/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Login ID")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sign in as Admin/ })).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter your login ID")).toBeTruthy();
  });

  it("switching to the User tab changes the button to User", async () => {
    const user = userEvent.setup();
    render(<LoginPage onLogin={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: /User/ }));
    expect(screen.getByRole("tab", { name: /User/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: /Sign in as User/ })).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter your login ID")).toBeTruthy();
  });

  it("password is hidden by default and the eye button toggles it to plain text", async () => {
    const user = userEvent.setup();
    render(<LoginPage onLogin={vi.fn()} />);
    const password = screen.getByPlaceholderText("Enter password") as HTMLInputElement;
    expect(password.type).toBe("password");
    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(password.type).toBe("text");
    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(password.type).toBe("password");
  });

  it("blocks submission and shows an error when either field is blank", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLogin={onLogin} />);
    await user.click(screen.getByRole("button", { name: /Sign in as Admin/ }));
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter both your ID and password/)).toBeTruthy();
  });

  it("rejects a made-up ID/password with 'Invalid ID or password'", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLogin={onLogin} />);
    await user.type(screen.getByPlaceholderText("Enter your login ID"), "someone");
    await user.type(screen.getByPlaceholderText("Enter password"), "anything");
    await user.click(screen.getByRole("button", { name: /Sign in as Admin/ }));
    expect(await screen.findByText("Invalid ID or password")).toBeTruthy();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("rejects the User credentials while the Admin tab is selected", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLogin={onLogin} />);
    await user.type(screen.getByPlaceholderText("Enter your login ID"), "User_deodap@123");
    await user.type(screen.getByPlaceholderText("Enter password"), "User@123");
    await user.click(screen.getByRole("button", { name: /Sign in as Admin/ }));
    expect(await screen.findByText("Invalid ID or password")).toBeTruthy();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("calls onLogin('user') for the exact demo User credentials", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLogin={onLogin} />);
    await user.click(screen.getByRole("tab", { name: /User/ }));
    await user.type(screen.getByPlaceholderText("Enter your login ID"), "User_deodap@123");
    await user.type(screen.getByPlaceholderText("Enter password"), "User@123");
    await user.click(screen.getByRole("button", { name: /Sign in as User/ }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith("user", expect.any(String)));
  });

  it("calls onLogin('admin') for the exact demo Admin credentials", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLogin={onLogin} />);
    await user.type(screen.getByPlaceholderText("Enter your login ID"), "Admin_deodap@123");
    await user.type(screen.getByPlaceholderText("Enter password"), "Admin@123");
    await user.click(screen.getByRole("button", { name: /Sign in as Admin/ }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith("admin", expect.any(String)));
  });
});
