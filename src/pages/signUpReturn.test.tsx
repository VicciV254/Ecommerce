import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Login from "./Login";
import Register from "./Register";
import VerifyEmail from "./VerifyEmail";

const mocks = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn(), verifyOtp: vi.fn() }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ register: mocks.register, login: mocks.login }) }));
vi.mock("../store/StorefrontContext", () => ({ useStorefront: () => ({ brandName: "Apex Cart" }) }));
vi.mock("../api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/auth")>();
  return { ...actual, authAPI: { ...actual.authAPI, verifyOtp: mocks.verifyOtp } };
});

const EMAIL = "new+shopper@example.test";
/** The route after the hash, decoded into its path and query values. */
const current = () => {
  const [path, query = ""] = window.location.hash.slice(1).split("?");
  return { path, params: Object.fromEntries(new URLSearchParams(query)) };
};

function fillRegistration() {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Nia" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Shopper" } });
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: EMAIL } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
}

function enterCode() {
  for (const [index, digit] of [..."123456"].entries()) {
    fireEvent.change(screen.getByLabelText(`Digit ${index + 1} of 6`), { target: { value: digit } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Verify OTP" }));
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.register.mockResolvedValue("verify");
  mocks.login.mockResolvedValue({ ok: true });
  mocks.verifyOtp.mockResolvedValue({ data: { message: "Verified" } });
});

describe("sign-up returns to the original intent", () => {
  it("carries checkout from registration through verification to sign-in, and sign-in returns there", async () => {
    window.location.hash = "#/register?returnTo=%2Fcheckout";
    const registration = render(<Register />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("#/login?returnTo=%2Fcheckout");
    fillRegistration();
    await waitFor(() => expect(current()).toEqual({ path: "/verify-email", params: { email: EMAIL, returnTo: "/checkout" } }));
    registration.unmount();

    const verification = render(<VerifyEmail />);
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe("#/login?returnTo=%2Fcheckout");
    enterCode();
    await waitFor(() => expect(current()).toEqual({ path: "/login", params: { verified: "1", email: EMAIL, returnTo: "/checkout" } }));
    expect(mocks.verifyOtp).toHaveBeenCalledWith(EMAIL, "123456");
    verification.unmount();

    render(<Login />);
    expect(screen.getByText("Email verified. Sign in to continue.")).toBeTruthy();
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe(EMAIL);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(window.location.hash).toBe("#/checkout"));
  });

  it("returns straight to the intent when the new account is signed in at once", async () => {
    window.location.hash = "#/register?returnTo=%2Fcheckout";
    mocks.register.mockResolvedValue("signed-in");
    render(<Register />);
    const entries = window.history.length;
    fillRegistration();
    await waitFor(() => expect(window.location.hash).toBe("#/checkout"));
    expect(window.history.length).toBe(entries);
  });

  it.each(["%2F%2Fevil.example%2Fcheckout", "https%3A%2F%2Fevil.example", "%2Fadmin", "%2Flogin"])(
    "drops returnTo=%s at registration and again at verification",
    async (target) => {
      window.location.hash = `#/register?returnTo=${target}`;
      const registration = render(<Register />);
      expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("#/login");
      fillRegistration();
      await waitFor(() => expect(current()).toEqual({ path: "/verify-email", params: { email: EMAIL } }));
      registration.unmount();

      // A verification link edited by hand is checked again before it is passed on.
      window.location.hash = `#/verify-email?email=${encodeURIComponent(EMAIL)}&returnTo=${target}`;
      render(<VerifyEmail />);
      enterCode();
      await waitFor(() => expect(current()).toEqual({ path: "/login", params: { verified: "1", email: EMAIL } }));
    },
  );

  it("sends an unverified sign-in to verification with the same intent, and offers registration with it", async () => {
    window.location.hash = "#/login?returnTo=%2Fcheckout";
    mocks.login.mockResolvedValue({ ok: false, requiresOtp: true, email: EMAIL });
    render(<Login />);
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe("#/register?returnTo=%2Fcheckout");
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(current()).toEqual({ path: "/verify-email", params: { email: EMAIL, returnTo: "/checkout" } }));
  });
});
