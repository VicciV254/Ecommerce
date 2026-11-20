import type { CatalogCategory, CatalogDelivery } from "../api/catalog";
import { DELIVERY_LABELS } from "./checkoutModel";
import { returnRuleGroups, type RestrictedReturnRule } from "./returnRules";
import { joinNames } from "./storeFacts";

/**
 * Plain statements of how buying works, shared by About, the footer and product pages so their wording cannot drift.
 * They describe the approved policy only; the store's contacts and hours are in `storeFacts.ts`.
 */
export const SHOPPING_FACTS = {
  vat: "Prices are shown excluding VAT; 16% VAT is added at checkout.",
  payment: "Pay by M-Pesa, approving the payment in the prompt on your phone.",
} as const;

/**
 * Payment, by the catalog's `demonstrationOrders`: where sample orders take demonstration payments, that, otherwise
 * (or until the catalog has loaded) the store's M-Pesa set-up.
 */
export const paymentFact = (demonstrationOrders: boolean | null) =>
  demonstrationOrders === true ? "Sample orders are paid with a demonstration payment; no money is taken." : SHOPPING_FACTS.payment;

/** Delivery, from the methods checkout offers once the catalog has loaded them. */
export function deliveryFact(delivery: readonly CatalogDelivery[] | null) {
  if (!delivery?.length) return "Delivery fees appear in your total before you reserve the order.";
  const methods = delivery.map(({ method, counties }) => {
    const label = DELIVERY_LABELS[method];
    const coverage = counties.length ? `in ${joinNames(counties)} only` : "anywhere in Kenya";
    return `${label.charAt(0).toLowerCase()}${label.slice(1)} ${coverage}`;
  }).join("; ");
  return `${methods.charAt(0).toUpperCase()}${methods.slice(1)}. The fee appears in your total before you reserve the order.`;
}

const RESTRICTIONS: Record<RestrictedReturnRule, string> = {
  UNOPENED_OR_FAULT: "only if unopened, or if faulty, damaged or wrong",
  FAULT_ONLY: "only if faulty, damaged or wrong",
};

/** The restricted return rules that some category shoppers can see sets, in the Returns page's order. */
export function returnRestrictions(categories: readonly CatalogCategory[]): RestrictedReturnRule[] {
  const groups = returnRuleGroups(categories);
  return (["UNOPENED_OR_FAULT", "FAULT_ONLY"] as const).filter((rule) => groups[rule].length > 0);
}

/**
 * The return window, naming only the restrictions that exist: "Most items can be returned within 7 days of delivery;
 * some only if …", or just the window when no category restricts returns. `returned` is the verb phrase after the
 * subject (the FAQ answers without one).
 */
export function returnsWindow(windowDays: number, restrictions: readonly RestrictedReturnRule[], returned = " can be returned") {
  const limits = restrictions.map((rule, index) => `; ${index ? "others" : "some"} ${RESTRICTIONS[rule]}`).join("");
  return `${restrictions.length ? "Most items" : "Items"}${returned} within ${windowDays} days of delivery${limits}.`;
}

/** Returns, using the window from the published return policy and the category rules once the catalog has loaded them. */
export function returnsFact(windowDays: number | null, demonstrationOrders: boolean | null, restrictions: readonly RestrictedReturnRule[]) {
  const refunds = demonstrationOrders === true ? "Refunds of demonstration payments move no money." : "Refunds are sent by M-Pesa.";
  return windowDays === null
    ? `Each product page shows its return rule and window. ${refunds}`
    : `${returnsWindow(windowDays, restrictions)} ${refunds}`;
}
