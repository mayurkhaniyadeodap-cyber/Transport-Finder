import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSession, loadSession, saveSession } from "./session";

beforeEach(() => sessionStorage.clear());
afterEach(() => sessionStorage.clear());

describe("session", () => {
  it("loadSession returns null when nothing has been saved", () => {
    expect(loadSession()).toBeNull();
  });

  it("saveSession then loadSession round-trips the role and token", () => {
    saveSession({ role: "admin", token: "t1" });
    expect(loadSession()).toEqual({ role: "admin", token: "t1" });
    saveSession({ role: "user", token: "t2" });
    expect(loadSession()).toEqual({ role: "user", token: "t2" });
  });

  it("ignores garbage roles instead of trusting them", () => {
    sessionStorage.setItem("transportFinder.role", "superadmin");
    sessionStorage.setItem("transportFinder.token", "t");
    expect(loadSession()).toBeNull();
  });

  it("a role without a session token (an older sign-in) isn't a valid session", () => {
    sessionStorage.setItem("transportFinder.role", "admin");
    expect(loadSession()).toBeNull();
  });

  it("clearSession removes the saved role and token", () => {
    saveSession({ role: "admin", token: "t" });
    clearSession();
    expect(loadSession()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("uses sessionStorage, not localStorage, and never stores a password", () => {
    saveSession({ role: "admin", token: "t" });
    expect(sessionStorage.getItem("transportFinder.role")).toBe("admin");
    expect(localStorage.getItem("transportFinder.role")).toBeNull();
    const stored = Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)).join(" ");
    expect(stored).not.toMatch(/Admin@123|password/i);
  });
});
