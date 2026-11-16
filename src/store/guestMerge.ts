import { STORAGE_KEYS } from "../utils/storage";

/*
 * A per-tab note (session storage) that this tab signed a guest in, so the guest cart joins that account once the
 * catalog has loaded. Other tabs learn of the sign-in through shared storage but never see this note, so they never
 * merge. Storage failures leave the guest cart untouched for the next sign-in made here.
 */

export function markGuestMerge(owner: string) {
  try {
    sessionStorage.setItem(STORAGE_KEYS.pendingGuestMerge, owner);
  } catch {
    // Unsaved: nothing merges, and the guest cart stays as it is.
  }
}

/** `owner` when this tab signed a guest in as `owner` and the merge has not run yet; otherwise `null`. */
export function pendingGuestMerge(owner: string | null): string | null {
  if (owner === null) return null;
  try {
    return sessionStorage.getItem(STORAGE_KEYS.pendingGuestMerge) === owner ? owner : null;
  } catch {
    return null;
  }
}

/** Forgets the note, or only a note for `owner` when one is given. */
export function clearGuestMerge(owner?: string) {
  try {
    if (owner === undefined || sessionStorage.getItem(STORAGE_KEYS.pendingGuestMerge) === owner) {
      sessionStorage.removeItem(STORAGE_KEYS.pendingGuestMerge);
    }
  } catch {
    // Nothing to forget when session storage is unavailable.
  }
}
