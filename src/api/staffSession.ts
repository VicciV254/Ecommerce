import type { AxiosRequestConfig } from "axios";
import {
  ADMIN_SESSION_KEYS,
  STORAGE_KEYS,
  isRecord,
  readStoredJson,
  removeStoredKeys,
  writeStoredJson,
} from "../utils/storage";

export type AdminSession = {
  id: string;
  email: string;
  username: string;
  role: string;
};

export class StaffSessionRequiredError extends Error {
  constructor() {
    super("Staff sign-in is required for this action.");
    this.name = "StaffSessionRequiredError";
  }
}

function isAdminSession(value: unknown): value is AdminSession {
  return isRecord(value) && ["id", "email", "username", "role"].every((key) => typeof value[key] === "string");
}

/** The signed-in staff member, only when both the token and a valid profile are stored. */
export function readAdminSession(): AdminSession | null {
  if (!localStorage.getItem(STORAGE_KEYS.adminToken)) return null;
  const stored = readStoredJson(STORAGE_KEYS.adminUser);
  return isAdminSession(stored) ? stored : null;
}

export function saveAdminSession(admin: AdminSession, token: string, refreshToken: string) {
  localStorage.setItem(STORAGE_KEYS.adminToken, token);
  localStorage.setItem(STORAGE_KEYS.adminRefreshToken, refreshToken);
  writeStoredJson(STORAGE_KEYS.adminUser, admin);
}

export function clearAdminSession() {
  removeStoredKeys(ADMIN_SESSION_KEYS);
}

/**
 * Explicit staff credentials for one request. Without a staff token the request is
 * refused locally, so it can never fall back to customer or anonymous credentials.
 */
export function staffRequest(params?: object): AxiosRequestConfig {
  const token = localStorage.getItem(STORAGE_KEYS.adminToken);
  if (!token) throw new StaffSessionRequiredError();
  return { params, headers: { Authorization: `Bearer ${token}` } };
}
