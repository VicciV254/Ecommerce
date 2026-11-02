import { AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import api from "./client";
import { paymentsAPI, staffPaymentsAPI } from "./mpesa";
import { StaffSessionRequiredError, saveAdminSession } from "./staffSession";
import { STORAGE_KEYS } from "../utils/storage";

const originalAdapter = api.defaults.adapter;
const staff = { id: "staff-1", email: "staff@example.test", username: "Staff", role: "VIEWER" };

type Seen = { method?: string; url?: string; data: unknown; authorization: string | null; key: string | null };

function capture() {
  const seen: Seen[] = [];
  api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    seen.push({
      method: config.method, url: config.url, data: config.data === undefined ? undefined : JSON.parse(String(config.data)),
      authorization: (config.headers.get("Authorization") as string | null) ?? null,
      key: (config.headers.get("Idempotency-Key") as string | null) ?? null,
    });
    return { config, status: 200, statusText: "OK", data: {}, headers: new AxiosHeaders() };
  };
  return seen;
}

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe("customer payment calls", () => {
  it("requests a prompt with only the order and phone, the request key and the customer credential", async () => {
    localStorage.setItem(STORAGE_KEYS.customerToken, "customer-token");
    saveAdminSession(staff, "staff-token", "staff-refresh");
    const seen = capture();
    await paymentsAPI.requestPrompt("order/1", "254712345678", "key-0123456789abcdef");
    expect(seen).toEqual([{
      method: "post", url: "/mpesa/stk-push", data: { orderId: "order/1", phone: "254712345678" },
      authorization: "Bearer customer-token", key: "key-0123456789abcdef",
    }]);
  });

  it("reads the overview and asks for a check with no body, never with staff credentials", async () => {
    localStorage.setItem(STORAGE_KEYS.customerToken, "customer-token");
    saveAdminSession(staff, "staff-token", "staff-refresh");
    const seen = capture();
    await paymentsAPI.getOverview("order/1");
    await paymentsAPI.checkAttempt("attempt 1");
    expect(seen.map(({ method, url, data, authorization }) => ({ method, url, data, authorization }))).toEqual([
      { method: "get", url: "/mpesa/orders/order%2F1/payments", data: undefined, authorization: "Bearer customer-token" },
      { method: "post", url: "/mpesa/payments/attempt%201/query", data: undefined, authorization: "Bearer customer-token" },
    ]);
  });
});

describe("staff payment calls", () => {
  it("send only the staff credential even while a customer is signed in", async () => {
    localStorage.setItem(STORAGE_KEYS.customerToken, "customer-token");
    saveAdminSession(staff, "staff-token", "staff-refresh");
    const seen = capture();
    await staffPaymentsAPI.getOverview("order-1");
    await staffPaymentsAPI.checkAttempt("attempt-1");
    expect(seen.map(({ method, url, data, authorization }) => ({ method, url, data, authorization }))).toEqual([
      { method: "get", url: "/mpesa/admin/orders/order-1/payments", data: undefined, authorization: "Bearer staff-token" },
      { method: "post", url: "/mpesa/admin/payments/attempt-1/query", data: undefined, authorization: "Bearer staff-token" },
    ]);
  });

  it("are refused locally without a staff session, never falling back to customer or legacy credentials", async () => {
    localStorage.setItem(STORAGE_KEYS.customerToken, "customer-token");
    localStorage.setItem("adminToken", "legacy-staff-token");
    const adapter = vi.fn();
    api.defaults.adapter = adapter;
    await expect(staffPaymentsAPI.getOverview("order-1")).rejects.toBeInstanceOf(StaffSessionRequiredError);
    await expect(staffPaymentsAPI.checkAttempt("attempt-1")).rejects.toBeInstanceOf(StaffSessionRequiredError);
    expect(adapter).not.toHaveBeenCalled();
  });
});
