/**
 * Versioned browser-state namespace. Unscoped legacy keys (`token`, `user`,
 * `adminToken`, ...) and `nmb-*` caches are never read, migrated or cleared.
 */
export const STORAGE_NAMESPACE = "apex-cart:v2";

export const STORAGE_KEYS = {
  customerToken: `${STORAGE_NAMESPACE}:customer:token`,
  customerRefreshToken: `${STORAGE_NAMESPACE}:customer:refresh-token`,
  customerUser: `${STORAGE_NAMESPACE}:customer:user`,
  adminToken: `${STORAGE_NAMESPACE}:admin:token`,
  adminRefreshToken: `${STORAGE_NAMESPACE}:admin:refresh-token`,
  adminUser: `${STORAGE_NAMESPACE}:admin:user`,
  accountReturnPath: `${STORAGE_NAMESPACE}:account:return-path`,
} as const;

export const CUSTOMER_SESSION_KEYS = [
  STORAGE_KEYS.customerToken,
  STORAGE_KEYS.customerRefreshToken,
  STORAGE_KEYS.customerUser,
] as const;

export const ADMIN_SESSION_KEYS = [
  STORAGE_KEYS.adminToken,
  STORAGE_KEYS.adminRefreshToken,
  STORAGE_KEYS.adminUser,
] as const;

/** Cart and wishlist state for one signed-in customer, or the guest browser. */
export function shopperStateKey(ownerId: string | null) {
  return `${STORAGE_NAMESPACE}:shopper:${ownerId ?? "guest"}`;
}

/** Parsed JSON for a key; a missing or corrupted entry reads as `undefined`. */
export function readStoredJson(key: string, storage: Storage = localStorage): unknown {
  const raw = storage.getItem(key);
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeStoredJson(key: string, value: unknown, storage: Storage = localStorage) {
  storage.setItem(key, JSON.stringify(value));
}

export function removeStoredKeys(keys: readonly string[], storage: Storage = localStorage) {
  for (const key of keys) storage.removeItem(key);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
