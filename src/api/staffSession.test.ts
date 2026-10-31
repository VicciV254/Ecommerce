import { AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import api from "./client";
import { catalogAdminAPI } from "./catalog";
import { StaffSessionRequiredError, clearAdminSession, readAdminSession, saveAdminSession } from "./staffSession";
import { STORAGE_KEYS } from "../utils/storage";

const originalAdapter = api.defaults.adapter;
const staff = { id: "staff-1", email: "staff@example.test", username: "Staff", role: "ADMIN" };

function ok(config: InternalAxiosRequestConfig, data: unknown = {}): AxiosResponse {
  return { config, status: 200, statusText: "OK", data, headers: new AxiosHeaders() };
}

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe("staff requests", () => {
  it("refuses staff mutations locally when no staff session exists, even with a customer session", async () => {
    localStorage.setItem(STORAGE_KEYS.customerToken, "customer-token");
    localStorage.setItem("adminToken", "legacy-staff-token");
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ok(config));
    api.defaults.adapter = adapter;
    await expect(catalogAdminAPI.deleteProduct("prod-1")).rejects.toBeInstanceOf(StaffSessionRequiredError);
    await expect(catalogAdminAPI.getSnapshot()).rejects.toBeInstanceOf(StaffSessionRequiredError);
    expect(adapter).not.toHaveBeenCalled();
    expect(readAdminSession()).toBeNull();
  });

  it("sends only the staff credential on catalog mutations", async () => {
    localStorage.setItem(STORAGE_KEYS.customerToken, "customer-token");
    saveAdminSession(staff, "staff-token", "staff-refresh");
    const seen: string[] = [];
    api.defaults.adapter = async (config) => {
      seen.push(String(config.headers.get("Authorization")));
      return ok(config, { success: true });
    };
    await catalogAdminAPI.deleteProduct("prod-1");
    await catalogAdminAPI.updateStock("var-1", { quantity: 4 });
    expect(seen).toEqual(["Bearer staff-token", "Bearer staff-token"]);
    expect(readAdminSession()).toEqual(staff);
  });

  it("clears only the versioned staff keys on sign-out", () => {
    saveAdminSession(staff, "staff-token", "staff-refresh");
    localStorage.setItem(STORAGE_KEYS.customerToken, "customer-token");
    localStorage.setItem("adminToken", "legacy-staff-token");
    clearAdminSession();
    expect(localStorage.getItem(STORAGE_KEYS.adminToken)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.adminUser)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.customerToken)).toBe("customer-token");
    expect(localStorage.getItem("adminToken")).toBe("legacy-staff-token");
  });
});
