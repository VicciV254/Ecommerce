import type { Order, Quote } from "../api/orders";
import { DELIVERY_LABELS } from "./checkoutModel";

/**
 * The checkout summary's figures. Until a current server quote exists only the browser's estimate of the items is
 * shown, labelled as one, and delivery, VAT and the total read "Pending" with the reason: an unknown fee is never 0 or
 * free. With a current quote, or once an order is reserved, only the server's figures are shown.
 */

/** The approved VAT rate, named before a quote states it. */
export const VAT_RATE_LABEL = "VAT (16%)";

export type SummaryRow = {
  label: string;
  /** `null` while the amount is not known yet. */
  amount: number | null;
  /** Savings read as a deduction; the total closes the list. */
  tone?: "saving" | "total";
};

export type CheckoutFigures =
  /** No current quote: the items are estimated in the browser and every fee waits for the server. */
  | { kind: "pending"; estimate: number; excluded: number; reason: string }
  | { kind: "quote"; quote: Quote }
  /** A reserved order's stored amounts. */
  | { kind: "order"; order: Pick<Order, "subtotal" | "discount" | "tax" | "shippingCost" | "total" | "deliveryMethod" | "pricingSnapshot"> };

export const PENDING_REASONS = {
  address: "Choose a delivery address to see delivery, VAT and your total.",
  calculating: "Calculating delivery, VAT and your total with current prices…",
  failed: "Your total could not be calculated yet.",
  expired: "These prices expired. Refresh prices to see your total.",
  settling: "Your total returns once your earlier order request is settled.",
} as const;

/** Why there is no current total, in the order the checks apply; `blocker` explains a cart that cannot be quoted. */
export function pendingReason({ settling, addressChosen, blocker, status, expired }: {
  settling: boolean;
  addressChosen: boolean;
  blocker: string | null;
  status: "idle" | "loading" | "ready" | "error";
  expired: boolean;
}): string {
  if (settling) return PENDING_REASONS.settling;
  if (!addressChosen) return PENDING_REASONS.address;
  if (blocker) return blocker;
  if (status === "error") return PENDING_REASONS.failed;
  if (expired) return PENDING_REASONS.expired;
  return PENDING_REASONS.calculating;
}

/** The rows to show, top to bottom; the last row is always the total. */
export function summaryRows(figures: CheckoutFigures): SummaryRow[] {
  if (figures.kind === "pending") {
    return [
      { label: "Items (estimate, excl. VAT)", amount: figures.estimate },
      { label: "Delivery", amount: null },
      { label: VAT_RATE_LABEL, amount: null },
      { label: "Total", amount: null, tone: "total" },
    ];
  }
  if (figures.kind === "quote") {
    const { quote } = figures;
    return [
      { label: "Items subtotal", amount: quote.subtotal },
      ...(quote.discount > 0 ? [
        { label: quote.couponApplied ? `Savings (incl. coupon ${quote.couponCode})` : "Savings", amount: quote.discount, tone: "saving" as const },
        { label: "Subtotal after savings", amount: quote.discountedSubtotal },
      ] : []),
      { label: `VAT (${quote.vatRate}%)`, amount: quote.tax },
      { label: DELIVERY_LABELS[quote.deliveryMethod], amount: quote.shippingCost },
      { label: "Total", amount: quote.total, tone: "total" },
    ];
  }
  const { order } = figures;
  const snapshot = order.pricingSnapshot ?? null;
  return [
    { label: "Items subtotal", amount: order.subtotal },
    ...(order.discount > 0 ? [
      { label: snapshot?.couponApplied ? `Savings (incl. coupon ${snapshot.couponCode})` : "Savings", amount: order.discount, tone: "saving" as const },
      ...(snapshot ? [{ label: "Subtotal after savings", amount: snapshot.discountedSubtotal }] : []),
    ] : []),
    { label: snapshot ? `VAT (${snapshot.vatRate}%)` : "Tax", amount: order.tax },
    { label: DELIVERY_LABELS[order.deliveryMethod], amount: order.shippingCost },
    { label: "Total", amount: order.total, tone: "total" },
  ];
}

/** The total, or `null` while it is pending. */
export function summaryTotal(figures: CheckoutFigures): number | null {
  if (figures.kind === "pending") return null;
  return figures.kind === "quote" ? figures.quote.total : figures.order.total;
}
