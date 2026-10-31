import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { STORAGE_KEYS } from "../utils/storage";

const api = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("../api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/auth")>();
  return { ...actual, authAPI: { ...actual.authAPI, getMe: api.getMe } };
});

const account = { id: "customer-v2", email: "v2@example.test", firstName: "Version", lastName: "Two" };

function Probe() {
  const { user, loading } = useAuth();
  return <p>{loading ? "loading" : user ? `signed-in:${user.id}` : "signed-out"}</p>;
}

beforeEach(() => {
  api.getMe.mockReset();
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
