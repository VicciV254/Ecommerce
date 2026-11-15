import { AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it } from "vitest";
import api from "./client";
import { UploadIntentFormatError, requestMediaUpload, type UploadIntent } from "./catalog";
import { StaffSessionRequiredError, saveAdminSession } from "./staffSession";
import { STORAGE_KEYS } from "../utils/storage";

const originalAdapter = api.defaults.adapter;
const staff = { id: "staff-1", email: "staff@example.test", username: "Staff", role: "ADMIN" };
const intent: UploadIntent = {
  uploadUrl: "https://api.cloudinary.com/v1_1/apex-test/image/upload",
  fields: { api_key: "123456789012345", timestamp: "1763200000", signature: "a".repeat(40), public_id: "apex-cart/products/20261115-abc" },
  maxBytes: 10_485_760,
  acceptedTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
  expiresAt: "2026-11-15T10:50:00.000Z",
};

type Seen = { method?: string; url?: string; data: unknown; authorization: string | null };

function respondWith(data: unknown) {
  const seen: Seen[] = [];
  api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    seen.push({
      method: config.method, url: config.url, data: JSON.parse(String(config.data)),
      authorization: (config.headers.get("Authorization") as string | null) ?? null,
    });
    return { config, status: 200, statusText: "OK", data, headers: new AxiosHeaders() };
  };
  return seen;
}

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe("requestMediaUpload", () => {
  it("asks for one signed product upload with only the staff credential and returns the intent unchanged", async () => {
    localStorage.setItem(STORAGE_KEYS.customerToken, "customer-token");
    saveAdminSession(staff, "staff-token", "staff-refresh");
    const seen = respondWith(intent);
    await expect(requestMediaUpload("PRODUCT")).resolves.toEqual(intent);
    expect(seen).toEqual([{ method: "post", url: "/media/uploads", data: { purpose: "PRODUCT" }, authorization: "Bearer staff-token" }]);
  });

  it.each([
    ["an upload address outside Cloudinary's API", { ...intent, uploadUrl: "https://uploads.example.test/v1_1/apex-test/image/upload" }],
    ["an insecure upload address", { ...intent, uploadUrl: "http://api.cloudinary.com/v1_1/apex-test/image/upload" }],
    ["an upload address with credentials", { ...intent, uploadUrl: "https://user:pass@api.cloudinary.com/v1_1/apex-test/image/upload" }],
    ["non-text fields", { ...intent, fields: { ...intent.fields, timestamp: 1763200000 } }],
    ["a missing size limit", { ...intent, maxBytes: undefined }],
  ])("refuses %s", async (_label, data) => {
    saveAdminSession(staff, "staff-token", "staff-refresh");
    respondWith(data);
    await expect(requestMediaUpload("STOREFRONT")).rejects.toBeInstanceOf(UploadIntentFormatError);
  });

  it("never sends the request without a staff session", async () => {
    const seen = respondWith(intent);
    await expect(requestMediaUpload("PRODUCT")).rejects.toBeInstanceOf(StaffSessionRequiredError);
    expect(seen).toEqual([]);
  });
});
