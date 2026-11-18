import type { CatalogDelivery } from "../api/catalog";
import type { DeliveryMethod } from "../api/orders";

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
