import { STORAGE_NAMESPACE, readStoredJson, writeStoredJson } from "../utils/storage";

/** Scroll positions of recently seen listings, by route, so Back from a product returns to the same place. */
const LISTING_SCROLL_KEY = `${STORAGE_NAMESPACE}:listing-scroll`;
/** Only the most recent listings are kept. */
export const LISTING_SCROLL_LIMIT = 20;

type Entry = [route: string, top: number];

const isEntry = (value: unknown): value is Entry =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isFinite(value[1]) && value[1] >= 0;

// Storage can be unavailable (private browsing, disabled storage); the position is a convenience, so failures are dropped.
function readEntries(): Entry[] {
  try {
    const stored = readStoredJson(LISTING_SCROLL_KEY, sessionStorage);
    return Array.isArray(stored) ? stored.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export function rememberListingScroll(route: string, top: number) {
  const entries = readEntries().filter(([saved]) => saved !== route);
  entries.push([route, Math.max(0, Math.round(top))]);
  try {
    writeStoredJson(LISTING_SCROLL_KEY, entries.slice(-LISTING_SCROLL_LIMIT), sessionStorage);
  } catch {
    // Not stored: returning to this listing starts at the top, as it would without the memory.
  }
}

export function recallListingScroll(route: string): number | null {
  return readEntries().find(([saved]) => saved === route)?.[1] ?? null;
}
