import type { Address } from "../api/auth";
import { STORAGE_KEYS, isRecord, readStoredJson, writeStoredJson } from "../utils/storage";

/**
 * Delivery address entry shared by checkout and the account's address book: the server's rules, so mistakes are
 * caught before sending, and a draft of what was typed at checkout, kept for this tab and one account until it is
 * saved, the account signs out or another account signs in.
 */

export type AddressField = "street" | "city" | "county" | "postalCode";
export type AddressDraft = Record<AddressField, string>;
export type AddressProblems = Partial<Record<AddressField, string>>;

export const ADDRESS_FIELDS: readonly AddressField[] = ["street", "city", "county", "postalCode"];
export const EMPTY_ADDRESS: AddressDraft = { street: "", city: "", county: "", postalCode: "" };

/** Longest value each field takes; the server's own minimums are checked by `addressProblems`. */
export const ADDRESS_MAX_LENGTH: Record<AddressField, number> = { street: 200, city: 100, county: 100, postalCode: 20 };
const MIN_LENGTH: Partial<Record<AddressField, number>> = { street: 5, city: 2, county: 2 };

export const ADDRESS_LABELS: Record<AddressField, string> = {
  street: "Street address",
  city: "Town or city",
  county: "County",
  postalCode: "Postal code (optional)",
};

const PROBLEMS: Partial<Record<AddressField, { missing: string; short: string }>> = {
  street: { missing: "Enter the street address.", short: "Enter at least 5 characters for the street address." },
  city: { missing: "Enter the town or city.", short: "Enter at least 2 characters for the town or city." },
  county: { missing: "Enter the county.", short: "Enter at least 2 characters for the county." },
};

/** Field-by-field problems, in form order; an empty object means the address can be sent. */
export function addressProblems(draft: AddressDraft): AddressProblems {
  const problems: AddressProblems = {};
  for (const field of ADDRESS_FIELDS) {
    const min = MIN_LENGTH[field];
    const words = PROBLEMS[field];
    if (min === undefined || !words) continue;
    const value = draft[field].trim();
    if (!value) problems[field] = words.missing;
    else if (value.length < min) problems[field] = words.short;
  }
  return problems;
}

/** The request body for a new address: trimmed, with an empty postal code left out. */
export function addressInput(draft: AddressDraft, isDefault: boolean): Omit<Address, "id"> {
  const postalCode = draft.postalCode.trim();
  return {
    street: draft.street.trim(), city: draft.city.trim(), county: draft.county.trim(),
    ...(postalCode ? { postalCode } : {}), isDefault,
  };
}

const isBlank = (draft: AddressDraft) => ADDRESS_FIELDS.every((field) => !draft[field].trim());

function isDraft(value: unknown): value is AddressDraft {
  return isRecord(value) && ADDRESS_FIELDS.every((field) => typeof value[field] === "string" && value[field].length <= ADDRESS_MAX_LENGTH[field]);
}

/*
 * The draft lives in session storage (one tab) and names its account. A draft found under another account is removed,
 * never shown. Storage failures only lose the convenience: the form starts empty.
 */

/** The address `owner` typed at checkout in this tab and has not saved, or `null`. */
export function readAddressDraft(owner: string): AddressDraft | null {
  try {
    if (sessionStorage.getItem(STORAGE_KEYS.checkoutAddressDraft) === null) return null;
    const stored = readStoredJson(STORAGE_KEYS.checkoutAddressDraft, sessionStorage);
    if (isRecord(stored) && stored.owner === owner && isDraft(stored.draft)) return stored.draft;
    // Another account's draft, or a damaged one: removed rather than shown.
    sessionStorage.removeItem(STORAGE_KEYS.checkoutAddressDraft);
  } catch {
    // Unavailable storage: nothing was kept.
  }
  return null;
}

/** Keeps what `owner` has typed so far; an empty form leaves no draft behind. */
export function saveAddressDraft(owner: string, draft: AddressDraft) {
  try {
    if (isBlank(draft)) sessionStorage.removeItem(STORAGE_KEYS.checkoutAddressDraft);
    else writeStoredJson(STORAGE_KEYS.checkoutAddressDraft, { owner, draft }, sessionStorage);
  } catch {
    // Not kept: a reload starts the form empty, as it would without the draft.
  }
}

/** Forgets the draft: after it is saved, on sign-out and when another account signs in. */
export function clearAddressDraft() {
  try {
    sessionStorage.removeItem(STORAGE_KEYS.checkoutAddressDraft);
  } catch {
    // Nothing to forget when session storage is unavailable.
  }
}
