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
  it("is one form for everyone: Login ID, Password and Sign in, with no Admin/User choice", () => {
    render(<LoginPage onLogin={vi.fn()} />);
    expect(screen.getByLabelText("Login ID")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter your login ID")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Sign in/ })).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
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
    await user.click(screen.getByRole("button", { name: /^Sign in/ }));
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter both your ID and password/)).toBeTruthy();
  });

  it("rejects a made-up ID/password with 'Invalid ID or password'", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLogin={onLogin} />);
    await user.type(screen.getByPlaceholderText("Enter your login ID"), "someone");
    await user.type(screen.getByPlaceholderText("Enter password"), "anything");
    await user.click(screen.getByRole("button", { name: /^Sign in/ }));
    expect(await screen.findByText("Invalid ID or password")).toBeTruthy();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("rejects the right ID with the wrong password", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLogin={onLogin} />);
    await user.type(screen.getByPlaceholderText("Enter your login ID"), "User_deodap@123");
    await user.type(screen.getByPlaceholderText("Enter password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: /^Sign in/ }));
    expect(await screen.findByText("Invalid ID or password")).toBeTruthy();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("calls onLogin('user') for the exact demo User credentials", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLogin={onLogin} />);
    await user.type(screen.getByPlaceholderText("Enter your login ID"), "User_deodap@123");
    await user.type(screen.getByPlaceholderText("Enter password"), "User@123");
    await user.click(screen.getByRole("button", { name: /^Sign in/ }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith("user", expect.any(String)));
  });

  it("calls onLogin('admin') for the exact demo Admin credentials", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLogin={onLogin} />);
    await user.type(screen.getByPlaceholderText("Enter your login ID"), "Admin_deodap@123");
    await user.type(screen.getByPlaceholderText("Enter password"), "Admin@123");
    await user.click(screen.getByRole("button", { name: /^Sign in/ }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith("admin", expect.any(String)));
  });

  it("the left side is the India map with a truck leaving Gujarat, on top of which sit the project's text and map credit", () => {
    render(<LoginPage onLogin={vi.fn()} />);
    const side = screen.getByRole("region", { name: "About Transport Finder" });
    const map = side.querySelector("svg.loginmap")!;
    expect(map.getAttribute("aria-hidden")).toBe("true"); // a picture: nothing for a screen reader to read out
    expect(map.querySelectorAll("animateMotion").length).toBeGreaterThan(0);
    expect(side.textContent).toContain("The right transporter for every pincode.");
    expect(side.textContent).toContain("CC BY 4.0");
  });

  it("the truck stays parked for people who ask their device to reduce motion", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce") })) as never;
    render(<LoginPage onLogin={vi.fn()} />);
    expect(document.querySelector("svg.loginmap animateMotion")).toBeNull();
    window.matchMedia = original;
  });
});
