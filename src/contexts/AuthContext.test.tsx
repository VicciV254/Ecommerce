import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { fromAnotherTab } from "../test-support/otherTab";
import { STORAGE_KEYS } from "../utils/storage";

const api = vi.hoisted(() => ({ getMe: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn() }));
vi.mock("../api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/auth")>();
  return { ...actual, authAPI: { ...actual.authAPI, ...api } };
});

const account = { id: "customer-v2", email: "v2@example.test", firstName: "Version", lastName: "Two" };
const other = { id: "customer-other", email: "other@example.test", firstName: "Other", lastName: "Shopper" };

function Probe() {
  const { user, loading } = useAuth();
  return <p>{loading ? "loading" : user ? `signed-in:${user.id}` : "signed-out"}</p>;
}

let auth: ReturnType<typeof useAuth>;
function Capture() {
  auth = useAuth();
  return null;
}

/** The session keys another tab writes when it signs in as `user`. */
const sessionOf = (user: typeof account, token: string) => ({
  [STORAGE_KEYS.customerUser]: JSON.stringify(user),
  [STORAGE_KEYS.customerToken]: token,
  [STORAGE_KEYS.customerRefreshToken]: `refresh-${token}`,
});
const signedOut = { [STORAGE_KEYS.customerUser]: null, [STORAGE_KEYS.customerToken]: null, [STORAGE_KEYS.customerRefreshToken]: null };

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.logout.mockResolvedValue({ data: { message: "Signed out" } });
  sessionStorage.clear();
});

describe("customer session storage", () => {
  it("rejects legacy unscoped sessions without calling the API or clearing them", async () => {
    localStorage.setItem("token", "legacy-token");
    localStorage.setItem("refreshToken", "legacy-refresh");
    localStorage.setItem("user", JSON.stringify({ ...account, id: "legacy-user" }));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText("signed-out")).toBeTruthy();
    expect(api.getMe).not.toHaveBeenCalled();
    expect(localStorage.getItem("token")).toBe("legacy-token");
    expect(localStorage.getItem("user")).not.toBeNull();
  });

  it("restores a versioned session and refreshes the profile", async () => {
    localStorage.setItem(STORAGE_KEYS.customerToken, "v2-token");
    localStorage.setItem(STORAGE_KEYS.customerUser, JSON.stringify(account));
    api.getMe.mockResolvedValue({ data: { ...account, firstName: "Updated" } });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText("loading")).toBeTruthy();
    expect(await screen.findByText("signed-in:customer-v2")).toBeTruthy();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.customerUser)!).firstName).toBe("Updated"));
  });

  it("ignores a corrupted stored profile", async () => {
    localStorage.setItem(STORAGE_KEYS.customerToken, "v2-token");
    localStorage.setItem(STORAGE_KEYS.customerUser, "{not json");
    api.getMe.mockReturnValue(new Promise(() => undefined));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText("loading")).toBeTruthy();
    expect(screen.queryByText(/signed-in/)).toBeNull();
  });
});

describe("sessions across tabs", () => {
  it("follows a sign-in, a sign-out and an account switch made in another tab", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText("signed-out")).toBeTruthy();

    act(() => fromAnotherTab(sessionOf(account, "token-v2")));
    expect(screen.getByText("signed-in:customer-v2")).toBeTruthy();

    act(() => fromAnotherTab(signedOut));
    expect(screen.getByText("signed-out")).toBeTruthy();

    act(() => fromAnotherTab(sessionOf(other, "token-other")));
    expect(screen.getByText("signed-in:customer-other")).toBeTruthy();
    // Another tab only learning of a sign-in never marks this tab's guest cart for merging.
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingGuestMerge)).toBeNull();
  });

  it("marks this tab's guest cart for merging only when this tab signs a guest in", async () => {
    render(<AuthProvider><Capture /></AuthProvider>);
    api.login.mockResolvedValue({ data: { user: account, token: "token-v2", refreshToken: "refresh-v2" } });
    await act(async () => { await auth.login(account.email, "password"); });
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingGuestMerge)).toBe("customer-v2");

    // Signing in as someone else while signed in is an account switch: nothing merges.
    sessionStorage.clear();
    api.login.mockResolvedValue({ data: { user: other, token: "token-other", refreshToken: "refresh-other" } });
    await act(async () => { await auth.login(other.email, "password"); });
    expect(auth.user?.id).toBe("customer-other");
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingGuestMerge)).toBeNull();

    // A registration that signs in at once brings the guest cart along; one waiting for verification does not.
    act(() => auth.logout());
    const verified = { ...account, id: "customer-new", emailVerified: true };
    api.register.mockResolvedValue({ data: { user: verified, token: "token-new", refreshToken: "refresh-new" } });
    await act(async () => { await auth.register({ email: verified.email, password: "password", firstName: "New", lastName: "Shopper" }); });
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingGuestMerge)).toBe("customer-new");

    act(() => auth.logout());
    sessionStorage.clear();
    api.register.mockResolvedValue({ data: { user: { ...verified, emailVerified: false }, token: "token-new", refreshToken: "refresh-new" } });
    await act(async () => { await auth.register({ email: verified.email, password: "password", firstName: "New", lastName: "Shopper" }); });
    expect(auth.user).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingGuestMerge)).toBeNull();
  });
});
