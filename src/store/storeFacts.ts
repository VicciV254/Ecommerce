import type { CatalogDelivery } from "../api/catalog";
import type { DeliveryMethod } from "../api/orders";

const OPERATOR = "Apex Cart";

/**
 * The store's own facts, as the merchant approved them (2026-11-18), worded only here: every page that states a
 * contact, the hours or the demonstration notice imports them, so no copy can drift.
 */
export const STORE_FACTS = {
  /** A trading name only. */
  operator: OPERATOR,
  email: "vicmutua254@gmail.com",
  phone: { display: "+254 729 125 144", tel: "+254729125144" },
  hours: "Monday to Friday, 08:00–18:00 EAT",
  /** When the Terms of use last changed (ISO date). */
  policiesUpdated: "2026-11-18",
  /** When the Privacy notice last changed (ISO date): the welcome message's sign-up and its browser mark. */
  privacyUpdated: "2026-11-21",
  demonstration: `${OPERATOR} is a demonstration store: its products are samples, and nothing is sold or delivered.`,
} as const;

/**
 * The delivery promises Apex Cart states, worded only here. Where a method delivers comes from the catalog's delivery
 * facts instead, so it always matches what checkout offers.
 */
export const DELIVERY_PROMISES: Partial<Record<DeliveryMethod, string>> = {
  STANDARD: "2–5 working days",
  SAME_DAY: "Paid by 12:00 EAT on a working day: arrives that day; otherwise the next working day",
};

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Where a method delivers, as a card line: "Anywhere in Kenya" or "Nairobi only". */
export function deliveryCoverage(counties: readonly string[]) {
  return counties.length ? `${joinNames(counties)} only` : "Anywhere in Kenya";
}

/** The line under a delivery choice: where the method delivers, then when, if a promise is stated for it. */
export function deliveryDescription({ method, counties }: Pick<CatalogDelivery, "method" | "counties">) {
  const promise = DELIVERY_PROMISES[method];
  return promise ? `${deliveryCoverage(counties)} · ${promise}` : deliveryCoverage(counties);
}
