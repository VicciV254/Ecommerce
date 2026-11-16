import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Login from "./Login";

const mocks = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ login: mocks.login }) }));
vi.mock("../store/StorefrontContext", () => ({ useStorefront: () => ({ brandName: "Apex Cart" }) }));

async function signIn(hash: string) {
  window.location.hash = hash;
  render(<Login />);
  const entries = window.history.length;
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "shopper@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(mocks.login).toHaveBeenCalled());
  return entries;
}

beforeEach(() => {
  mocks.login.mockReset();
  mocks.login.mockResolvedValue({ ok: true });
});

describe("sign-in return", () => {
  it("replaces the sign-in entry with the requested internal route", async () => {
    const entries = await signIn("#/login?returnTo=%2Fcheckout");
    await waitFor(() => expect(window.location.hash).toBe("#/checkout"));
    expect(window.history.length).toBe(entries);
  });

  it.each(["%2F%2Fevil.example", "https%3A%2F%2Fevil.example", "%2Fadmin", "%2Flogin"])("goes home instead of returnTo=%s", async (target) => {
    await signIn(`#/login?returnTo=${target}`);
    await waitFor(() => expect(window.location.hash).toBe("#/"));
  });
});

describe("sign-in errors", () => {
  it("shows the error alone: a wrong password is not answered with a new verification code", async () => {
    mocks.login.mockResolvedValue({ ok: false, error: "Invalid email or password." });
    await signIn("#/login");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Invalid email or password.");
    // Unverified accounts are sent to the verification page, which owns sending a new code.
    expect(screen.queryByRole("button", { name: /new code/i })).toBeNull();
  });
});
