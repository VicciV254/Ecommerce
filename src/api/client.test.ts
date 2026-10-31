import axios, { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "./client";

const originalAdapter = api.defaults.adapter;

function response(config: InternalAxiosRequestConfig, status = 200, data: unknown = {}): AxiosResponse {
  return { config, status, data, statusText: String(status), headers: new AxiosHeaders() };
}

function unauthorized(config: InternalAxiosRequestConfig, status = 401) {
  return new AxiosError("Request rejected", "ERR_BAD_REQUEST", config, undefined, response(config, status));
}

function session(token: string) {
  localStorage.setItem("token", token);
  localStorage.setItem("refreshToken", `${token}-refresh`);
}

beforeEach(() => session("old-access"));
afterEach(() => {
  api.defaults.adapter = originalAdapter;
  vi.unstubAllGlobals();
});

describe("customer authentication transport", () => {
  it("shares one refresh for concurrent requests without leaving a global Authorization header", async () => {
    const refresh = vi.spyOn(axios, "post").mockResolvedValue({ data: { token: "new-access", refreshToken: "new-refresh" } });
    api.defaults.adapter = async (config) => {
      if (config.headers.get("Authorization") === "Bearer old-access") throw unauthorized(config);
      return response(config);
    };
    const results = await Promise.all([api.get("/auth/me"), api.get("/orders")]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.config.headers.get("Authorization") === "Bearer new-access")).toBe(true);
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    const guest = await api.get("/products");
    expect(guest.config.headers.has("Authorization")).toBe(false);
  });

  it("never refreshes staff, login or explicitly authenticated requests as the customer", async () => {
    const refresh = vi.spyOn(axios, "post");
    api.defaults.adapter = async (config) => { throw unauthorized(config); };
    await expect(api.get("/orders/admin/all", { headers: { Authorization: "Bearer staff" } })).rejects.toBeInstanceOf(AxiosError);
    await expect(api.post("/auth/login", { email: "test@example.test", password: "invalid" })).rejects.toBeInstanceOf(AxiosError);
    await expect(api.get("/products", { headers: { Authorization: "Bearer other-actor" } })).rejects.toBeInstanceOf(AxiosError);
    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem("token")).toBe("old-access");
  });

  it("does not overwrite a newly signed-in account or replay the old request after refresh", async () => {
    let finish!: (value: { data: { token: string; refreshToken: string } }) => void;
    const refresh = vi.spyOn(axios, "post").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => { throw unauthorized(config); });
    api.defaults.adapter = adapter;
    const pending = api.get("/auth/me");
    const rejected = expect(pending).rejects.toMatchObject({ code: "ERR_CANCELED" });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    session("other-account");
    finish({ data: { token: "stale-account", refreshToken: "stale-refresh" } });
    await rejected;
    expect(localStorage.getItem("token")).toBe("other-account");
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale successful response after the account changes", async () => {
    let finish!: () => void;
    api.defaults.adapter = (config) => new Promise((resolve) => { finish = () => resolve(response(config)); });
    const pending = api.get("/auth/me");
    const rejected = expect(pending).rejects.toMatchObject({ code: "ERR_CANCELED" });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    session("new-account");
    finish();
    await rejected;
  });

  it("cancels a rejected refresh from an old account instead of propagating its auth failure", async () => {
    let deny!: (error: AxiosError) => void;
    const refresh = vi.spyOn(axios, "post").mockImplementation(() => new Promise((_resolve, reject) => { deny = reject; }));
    api.defaults.adapter = async (config) => { throw unauthorized(config); };
    const pending = api.get("/auth/me");
    const rejected = expect(pending).rejects.toMatchObject({ code: "ERR_CANCELED" });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    session("new-account");
    deny(new AxiosError("Disabled account", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 403, statusText: "Forbidden", data: {}, headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() },
    }));
    await rejected;
    expect(localStorage.getItem("token")).toBe("new-account");
  });

  it("does not restore a logged-out account when its pending refresh succeeds", async () => {
    let finish!: (value: { data: { token: string; refreshToken: string } }) => void;
    const refresh = vi.spyOn(axios, "post").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    api.defaults.adapter = async (config) => { throw unauthorized(config); };
    const pending = api.get("/orders");
    const rejected = expect(pending).rejects.toMatchObject({ code: "ERR_CANCELED" });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    localStorage.clear();
    finish({ data: { token: "revived-account", refreshToken: "revived-refresh" } });
    await rejected;
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("surfaces an invalid refresh response without storing malformed tokens", async () => {
    const refresh = vi.spyOn(axios, "post").mockResolvedValue({ data: { token: "incomplete" } });
    api.defaults.adapter = async (config) => { throw unauthorized(config); };
    await expect(api.get("/auth/me")).rejects.toThrow("Invalid token refresh response");
    expect(refresh).toHaveBeenCalledWith(
      expect.stringContaining("/auth/refresh"),
      { refreshToken: "old-access-refresh" },
      expect.objectContaining({ timeout: 30_000 }),
    );
    expect(localStorage.getItem("token")).toBe("old-access");
  });

  it("retries a request only once if the refreshed token is rejected too", async () => {
    const refresh = vi.spyOn(axios, "post").mockResolvedValue({ data: { token: "new-access", refreshToken: "new-refresh" } });
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => { throw unauthorized(config); });
    api.defaults.adapter = adapter;
    await expect(api.get("/auth/me")).rejects.toMatchObject({ response: { status: 401 } });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it("passes through a transport error without request metadata", async () => {
    const failure = new AxiosError("No request configuration", "ERR_NETWORK");
    api.defaults.adapter = async () => { throw failure; };
    await expect(api.get("/auth/me")).rejects.toBe(failure);
  });

  it("does not copy refresh credentials into ordinary request error metadata", async () => {
    let serialized = "";
    api.defaults.adapter = async (config) => {
      const failure = unauthorized(config, 503);
      serialized = JSON.stringify(failure.toJSON());
      throw failure;
    };
    await expect(api.get("/auth/me")).rejects.toMatchObject({ response: { status: 503 } });
    expect(serialized.includes("old-access-refresh")).toBe(false);
  });

  it("clears only the rejected customer session when refresh is denied", async () => {
    const location = { href: "" };
    vi.stubGlobal("window", { location });
    localStorage.setItem("adminToken", "staff-token");
    api.defaults.adapter = async (config) => { throw unauthorized(config); };
    vi.spyOn(axios, "post").mockRejectedValue(new AxiosError(
      "Disabled account", "ERR_BAD_REQUEST", undefined, undefined,
      { status: 403, statusText: "Forbidden", data: {}, headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } },
    ));
    await expect(api.get("/auth/me")).rejects.toMatchObject({ response: { status: 403 } });
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("adminToken")).toBe("staff-token");
    expect(location.href).toBe("/#/login");
  });

  it("does not log out a customer just because refresh is temporarily unavailable", async () => {
    api.defaults.adapter = async (config) => { throw unauthorized(config); };
    vi.spyOn(axios, "post").mockRejectedValue(new AxiosError("Offline", "ERR_NETWORK"));
    await expect(api.get("/auth/me")).rejects.toMatchObject({ code: "ERR_NETWORK" });
    expect(localStorage.getItem("token")).toBe("old-access");
  });
});
