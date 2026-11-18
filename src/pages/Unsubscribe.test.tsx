import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorefrontProvider } from "../store/StorefrontContext";
import Unsubscribe from "./Unsubscribe";

const mocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  getStorefront: vi.fn(),
  auth: {
    user: null as { id: string; email: string } | null,
    refreshUser: vi.fn(),
    updateProfile: vi.fn(),
    updatePromotionalEmails: vi.fn(),
  },
}));
vi.mock("../api/subscriptions", () => ({ subscriptionsAPI: { unsubscribe: mocks.unsubscribe } }));
vi.mock("../api/catalog", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/catalog")>(),
  catalogAPI: { getStorefront: mocks.getStorefront },
}));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));

const TOKEN = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
const INTRO = "You'll stop receiving offers and news by email. Emails about your orders and account aren't affected.";
const CONSOLE = ["log", "info", "warn", "error", "debug"] as const;

function apiError(status: number | undefined) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined
    ? undefined
    : { status, statusText: String(status), data: { error: "This unsubscribe link isn't valid.", code: "UNSUBSCRIBE_LINK_INVALID" }, headers: new AxiosHeaders(), config };
  return new AxiosError("Request failed", status === undefined ? "ERR_NETWORK" : "ERR_BAD_REQUEST", config, undefined, response);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function open(route: string) {
  window.history.replaceState(null, "", `#${route}`);
  return render(<StorefrontProvider><Unsubscribe /></StorefrontProvider>);
}
const button = () => screen.getByRole("button", { name: "Unsubscribe" });
const logged = () => CONSOLE.flatMap((level) => vi.mocked(console[level]).mock.calls.flat().map(String));

beforeEach(() => {
  mocks.unsubscribe.mockReset();
  mocks.getStorefront.mockReset().mockReturnValue(new Promise(() => undefined));
  mocks.auth = { user: null, refreshUser: vi.fn().mockResolvedValue(undefined), updateProfile: vi.fn(), updatePromotionalEmails: vi.fn() };
  for (const level of CONSOLE) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => {
  // The token is the link's capability: it is never shown on the page or written to the console.
  expect(document.body.innerHTML).not.toContain(TOKEN);
  expect(logged().some((text) => text.includes(TOKEN))).toBe(false);
  vi.restoreAllMocks();
});

describe("Unsubscribe page", () => {
  it("explains what stops and waits for the button: opening the link sends nothing", async () => {
    open(`/unsubscribe?token=${TOKEN}`);
    expect(screen.getByRole("heading", { level: 1, name: "Unsubscribe from Apex Cart emails" })).toBeTruthy();
    expect(screen.getByText(INTRO)).toBeTruthy();
    expect(button().hasAttribute("disabled")).toBe(false);
    await waitFor(() => expect(document.title).toBe("Unsubscribe · Apex Cart"));
    await act(async () => { await new Promise((done) => setTimeout(done, 50)); });
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });

  it("offers no button for a link without its token, and points to Contact", () => {
    for (const route of ["/unsubscribe", "/unsubscribe?token="]) {
      const view = open(route);
      expect(screen.getByText("This unsubscribe link is incomplete. Open it from the email again, or contact us.")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Contact us" }).getAttribute("href")).toBe("#/contact");
      expect(screen.queryByRole("button")).toBeNull();
      view.unmount();
    }
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });

  it("shows the request under way, then confirms in place and moves focus to the confirmation", async () => {
    const sent = deferred<{ data: { message: string } }>();
    mocks.unsubscribe.mockReturnValue(sent.promise);
    open(`/unsubscribe?token=${TOKEN}`);
    fireEvent.click(button());
    const sending = screen.getByRole("button", { name: "Unsubscribing…" });
    expect(sending.hasAttribute("disabled")).toBe(true);
    expect(mocks.unsubscribe).toHaveBeenCalledWith({ token: TOKEN });
    await act(async () => sent.resolve({ data: { message: "Unsubscribed." } }));
    const confirmation = await screen.findByRole("heading", { name: "You're unsubscribed" });
    await waitFor(() => expect(document.activeElement).toBe(confirmation));
    expect(screen.getByRole("status").textContent).toContain(
      "You won't receive promotional emails from Apex Cart. If you have an account, its email preference is now off.",
    );
    expect(screen.getByRole("link", { name: "Continue shopping" }).getAttribute("href")).toBe("#/shop");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(INTRO)).toBeNull();
    expect(mocks.auth.refreshUser).not.toHaveBeenCalled();
  });

  it("refreshes a signed-in account from the server, and never edits it here, whoever's link it was", async () => {
    for (const [label, email] of [["the account's own link", "amina@example.test"], ["another address's link", "someone.else@example.test"]]) {
      mocks.auth = { user: { id: "user-1", email }, refreshUser: vi.fn().mockResolvedValue(undefined), updateProfile: vi.fn(), updatePromotionalEmails: vi.fn() };
      mocks.unsubscribe.mockResolvedValue({ data: { message: "Unsubscribed." } });
      const view = open(`/unsubscribe?token=${TOKEN}`);
      fireEvent.click(button());
      await screen.findByRole("heading", { name: "You're unsubscribed" });
      expect(mocks.auth.refreshUser, label).toHaveBeenCalledTimes(1);
      expect(mocks.auth.updateProfile, label).not.toHaveBeenCalled();
      expect(mocks.auth.updatePromotionalEmails, label).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it.each([400, 404])("explains a refused link (%i) with a Contact link, moves focus to it and offers no retry", async (status) => {
    mocks.unsubscribe.mockRejectedValue(apiError(status));
    open(`/unsubscribe?token=${TOKEN}`);
    fireEvent.click(button());
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("p")?.textContent).toBe("This unsubscribe link isn't valid. It may have been copied incompletely.");
    expect(screen.getByRole("link", { name: "Contact us" }).getAttribute("href")).toBe("#/contact");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(screen.queryByRole("button")).toBeNull();
    expect(mocks.auth.refreshUser).not.toHaveBeenCalled();
  });

  it.each([["a network failure", undefined], ["a server failure", 503], ["rate limiting", 429]])(
    "keeps the button after %s, says to try again, and a retry can succeed",
    async (_label, status) => {
      mocks.unsubscribe.mockRejectedValueOnce(apiError(status)).mockResolvedValueOnce({ data: { message: "Unsubscribed." } });
      open(`/unsubscribe?token=${TOKEN}`);
      fireEvent.click(button());
      expect((await screen.findByRole("alert")).textContent).toBe("We couldn't unsubscribe you just now. Try again.");
      await waitFor(() => expect(document.activeElement).toBe(button()));
      expect(button().hasAttribute("disabled")).toBe(false);
      fireEvent.click(button());
      expect(await screen.findByRole("heading", { name: "You're unsubscribed" })).toBeTruthy();
      expect(mocks.unsubscribe).toHaveBeenCalledTimes(2);
    },
  );
});
