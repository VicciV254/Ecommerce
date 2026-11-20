import type { CatalogCategory, CatalogDelivery } from "../api/catalog";
import type { DeliveryMethod } from "../api/orders";
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

/*
 * Short forms for the home page's shopping facts strip: a title and one line each, worded from the same inputs as the
 * long forms above. While the catalog is unknown (loading or failed), payment and refunds name no method at all.
 */
type ShortFact = { title: string; text: string };

export const VAT_SHORT_FACT: ShortFact = { title: "Prices and VAT", text: "Shown excluding VAT; 16% VAT is added at checkout." };

/** How the short delivery fact names a method; standard delivery is the plain case. */
const SHORT_METHODS: Record<DeliveryMethod, string> = { STANDARD: "", SAME_DAY: "same-day ", STORE_PICKUP: "store pickup " };

/** Where each method checkout offers delivers; until the catalog has loaded them, that the fee is shown first. */
export function deliveryShortFact(delivery: readonly CatalogDelivery[] | null): ShortFact {
  if (!delivery?.length) return { title: "Delivery", text: "The fee shows in your total before you reserve." };
  const places = delivery.map(({ method, counties }) =>
    `${SHORT_METHODS[method]}${counties.length ? `in ${joinNames(counties)} only` : "anywhere in Kenya"}`).join("; ");
  return { title: "Delivery", text: `${places.charAt(0).toUpperCase()}${places.slice(1)}.` };
}

export function paymentShortFact(demonstrationOrders: boolean | null): ShortFact {
  if (demonstrationOrders === null) return { title: "Payment", text: "See how payment works." };
  return {
    title: "Payment",
    text: demonstrationOrders ? "Sample orders use a demonstration payment; no money is taken." : "By M-Pesa: approve the prompt on your phone.",
  };
}

export function returnsShortFact(windowDays: number | null, demonstrationOrders: boolean | null, restrictions: readonly RestrictedReturnRule[]): ShortFact {
  const window = windowDays === null
    ? "Each product page shows its rule."
    : `Return ${restrictions.length ? "most items" : "items"} within ${windowDays} days of delivery.`;
  const refunds = demonstrationOrders === null ? ""
    : demonstrationOrders ? " Refunds of demonstration payments move no money." : " Refunds by M-Pesa.";
  return { title: "Returns", text: `${window}${refunds}` };
}
