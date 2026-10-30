import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { installFakeBackend } from "../test/fakeBackend";

afterEach(cleanup);

beforeEach(() => {
  installFakeBackend();
  sessionStorage.clear();
});

async function signIn() {
  render(<App />);
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("Enter your login ID"), "Admin_deodap@123");
  await user.type(screen.getByPlaceholderText("Enter password"), "Admin@123");
  await user.click(screen.getByRole("button", { name: /^Sign in/ }));
  await screen.findByText("Search to see transporters");
  return user;
}

describe("Back to search", () => {
  it("isn't shown before searching", async () => {
    await signIn();
    expect(screen.queryByRole("button", { name: /Back to search/ })).toBeNull();
    expect(screen.getByText("ORDER HISTORY DATA")).toBeTruthy();
  });

  it("appears at the top once you search, and takes you back to an empty search", async () => {
    const user = await signIn();
    await user.type(screen.getByRole("combobox"), "380009");
    await user.click(screen.getByRole("button", { name: /Search results/ }));
    await screen.findByText("No transporters found"); // the fake backend has no data

    const back = screen.getByRole("button", { name: /Back to search/ }); // exactly one
    expect(back.closest(".pagehead")).not.toBeNull();
    await user.click(back);

    expect(await screen.findByText("Search to see transporters")).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: /Back to search/ })).toBeNull();
  });
});
