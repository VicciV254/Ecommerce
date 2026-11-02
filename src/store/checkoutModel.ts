import { isAxiosError, isCancel } from "axios";
import type { CatalogProduct, CatalogVariant } from "../api/catalog";
import {
  MAX_QUOTE_ITEMS,
  type DeliveryMethod,
  type Order,
  type OrderItem,
  type OrderStatus,
  type PaymentStatus,
  type Quote,
  type QuoteAddress,
  type QuoteLine,
  type QuoteRequest,
  type ReservationStatus,
} from "../api/orders";
import { apiErrorCode, apiStatus, describeApiError } from "../api/errors";
import { isRecord } from "../utils/storage";
import { isMoney } from "./catalogModel";

/* ------------------------------------------------------------------ */
/* Boundary validation: a malformed quote or order is never trusted   */
/* ------------------------------------------------------------------ */

export class CheckoutFormatError extends Error {
  constructor(detail: string) {
    super(`The checkout response was not in the expected format (${detail}).`);
    this.name = "CheckoutFormatError";
  }
}

const isString = (value: unknown): value is string => typeof value === "string";
const isId = (value: unknown): value is string => isString(value) && value !== "";
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every(isString);
const isQuantity = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0;
const isTimestamp = (value: unknown): value is string => isString(value) && !Number.isNaN(Date.parse(value));
const MAX_RATE = 100;

export const DELIVERY_METHODS: readonly DeliveryMethod[] = ["STANDARD", "SAME_DAY", "STORE_PICKUP"];
export const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  STANDARD: "Standard delivery",
  SAME_DAY: "Same-day delivery",
  STORE_PICKUP: "Store pickup",
};
const ORDER_STATUSES: readonly OrderStatus[] = [
  "PENDING", "PROCESSING", "SHIPPED", "READY_FOR_PICKUP", "DELIVERED", "CANCELLED", "AWAITING_REFUND", "RETURNED",
];
const PAYMENT_STATUSES: readonly PaymentStatus[] = ["PENDING", "PAID", "FAILED", "REFUNDED"];
const RESERVATION_STATUSES: readonly ReservationStatus[] = ["HELD", "COMMITTED", "RELEASED", "EXPIRED"];

export const isDeliveryMethod = (value: unknown): value is DeliveryMethod =>
  DELIVERY_METHODS.some((method) => method === value);
export const isOrderStatus = (value: unknown): value is OrderStatus => ORDER_STATUSES.some((status) => status === value);
export const isPaymentStatus = (value: unknown): value is PaymentStatus => PAYMENT_STATUSES.some((status) => status === value);
export const isReservationStatus = (value: unknown): value is ReservationStatus =>
  RESERVATION_STATUSES.some((status) => status === value);

function isQuoteLine(value: unknown): value is QuoteLine {
  return isRecord(value) && isId(value.productId) && isId(value.variantId) && isString(value.productName) &&
    isString(value.sku) && isStringRecord(value.attributes) && isQuantity(value.quantity) &&
    isNullableString(value.productImage) && isMoney(value.originalUnitPrice) && isMoney(value.unitPrice) &&
    isMoney(value.total) && isMoney(value.couponDiscount) && isMoney(value.discount) && isNullableString(value.discountId);
}

function isQuoteAddress(value: unknown): value is QuoteAddress {
  return isRecord(value) && isId(value.id) && isString(value.street) && isString(value.city) &&
    isString(value.county) && isNullableString(value.postalCode);
}

/** Validates a quote from `POST /orders/quotes` or `GET /orders/quotes/:id`; throws rather than guessing totals. */
export function parseQuote(data: unknown): Quote {
  if (!isRecord(data) || data.version !== 1 || !isId(data.id)) throw new CheckoutFormatError("quote");
  if (data.currency !== "KES" || typeof data.vatRate !== "number" || !(data.vatRate >= 0 && data.vatRate <= MAX_RATE) ||
    !Number.isInteger(data.policyVersion) || !isString(data.policyHash) || (data.mode !== "live" && data.mode !== "demo")) {
    throw new CheckoutFormatError("quote policy");
  }
  if (!isQuoteAddress(data.address) || !isDeliveryMethod(data.deliveryMethod) || !isNullableString(data.notes)) {
    throw new CheckoutFormatError("quote delivery");
  }
  if (!isNullableString(data.couponCode) || typeof data.couponApplied !== "boolean" || !isNullableString(data.couponMessage)) {
    throw new CheckoutFormatError("quote coupon");
  }
  if (!Array.isArray(data.lines) || !data.lines.length || !data.lines.every(isQuoteLine)) throw new CheckoutFormatError("quote lines");
  const amounts = [data.subtotal, data.discount, data.discountedSubtotal, data.tax, data.shippingCost, data.total];
  if (!amounts.every(isMoney)) throw new CheckoutFormatError("quote totals");
  if (!isTimestamp(data.expiresAt) || typeof data.expired !== "boolean" || typeof data.consumed !== "boolean" ||
    !(data.orderId === null || isId(data.orderId)) || typeof data.reservationsEnabled !== "boolean") {
    throw new CheckoutFormatError("quote status");
  }
  return data as unknown as Quote;
}

function isOrderItem(value: unknown): value is OrderItem {
  return isRecord(value) && isId(value.id) && isId(value.productId) && isId(value.variantId) &&
    isString(value.productName) && isQuantity(value.quantity) && isMoney(value.productPrice) && isMoney(value.subtotal);
}

/** Validates a quote-based order (creation, replay or `GET /orders/:id`) before it changes the cart. */
export function parseOrder(data: unknown): Order {
  if (!isRecord(data) || !isId(data.id) || !isId(data.orderNumber) || !isId(data.quoteId)) throw new CheckoutFormatError("order");
  if (!isOrderStatus(data.status) || !isPaymentStatus(data.paymentStatus) || !isReservationStatus(data.reservationStatus) ||
    !(data.reservationExpiresAt === null || isTimestamp(data.reservationExpiresAt))) {
    throw new CheckoutFormatError("order status");
  }
  if (!Array.isArray(data.items) || !data.items.length || !data.items.every(isOrderItem)) throw new CheckoutFormatError("order items");
  if (![data.subtotal, data.discount, data.tax, data.shippingCost, data.total].every(isMoney)) throw new CheckoutFormatError("order totals");
  return data as unknown as Order;
}

/** Whether a resolved order still holds its items, so its lines may leave the cart. */
export function orderHoldsItems(order: Order): boolean {
  return order.status !== "CANCELLED" && (order.reservationStatus === "HELD" || order.reservationStatus === "COMMITTED");
}

/* ------------------------------------------------------------------ */
/* Requests, signatures and comparisons                               */
/* ------------------------------------------------------------------ */

type OrderedLine = { productId: string; variantId: string; quantity: number };

const COUPON_CODE = /^[A-Z0-9_-]{3,40}$/;

/** The server's coupon form (trimmed, upper case), or `null` when the text cannot be a coupon code. */
export function normalizeCouponCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return COUPON_CODE.test(code) ? code : null;
}

export function quoteRequestFor(
  cart: readonly OrderedLine[],
  options: { addressId: string; deliveryMethod: DeliveryMethod; couponCode: string | null },
): QuoteRequest {
  const items = cart
    .map(({ productId, variantId, quantity }) => ({ productId, variantId, quantity }))
    .sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
  return { items, addressId: options.addressId, deliveryMethod: options.deliveryMethod, couponCode: options.couponCode, notes: null };
}

/** Stable identity of a quote request; equal signatures price the same cart and choices. */
export function requestSignature(request: QuoteRequest): string {
  return JSON.stringify(request);
}

/** Whether the server priced exactly the requested lines, address, delivery and coupon. */
export function quoteMatchesRequest(quote: Quote, request: QuoteRequest): boolean {
  const lines = new Map(quote.lines.map((line) => [line.variantId, line]));
  return quote.lines.length === request.items.length &&
    request.items.every((item) => lines.get(item.variantId)?.productId === item.productId && lines.get(item.variantId)?.quantity === item.quantity) &&
    quote.address.id === request.addressId && quote.deliveryMethod === request.deliveryMethod &&
    quote.couponCode === request.couponCode;
}

/** True when two quotes charge the same amounts for the same lines and choices. */
export function samePricing(a: Quote, b: Quote): boolean {
  const priced = (quote: Quote) => JSON.stringify([
    quote.subtotal, quote.discount, quote.discountedSubtotal, quote.tax, quote.shippingCost, quote.total,
    quote.deliveryMethod, quote.address, quote.couponCode, quote.couponApplied,
    quote.lines.map((line) => [line.variantId, line.quantity, line.unitPrice, line.total]),
  ]);
  return priced(a) === priced(b);
}

/** Milliseconds until a quote expires by this browser's clock; the server still decides acceptance. */
export function quoteTimeLeft(quote: Pick<Quote, "expiresAt">, now = Date.now()) {
  return Date.parse(quote.expiresAt) - now;
}

/** Removes ordered quantities from matching cart lines, keeping anything added or increased since. */
export function subtractOrderedItems<Line extends OrderedLine>(cart: readonly Line[], ordered: readonly OrderedLine[]): Line[] {
  const remaining = new Map<string, number>();
  const key = (line: OrderedLine) => `${line.productId}\u0000${line.variantId}`;
  for (const item of ordered) remaining.set(key(item), (remaining.get(key(item)) ?? 0) + item.quantity);
  return cart.flatMap((line) => {
    const taken = Math.min(line.quantity, remaining.get(key(line)) ?? 0);
    if (!taken) return [line];
    remaining.set(key(line), (remaining.get(key(line)) ?? 0) - taken);
    return line.quantity > taken ? [{ ...line, quantity: line.quantity - taken }] : [];
  });
}

/** The server's ordered SKUs and quantities, used to remove exactly those units from the cart. */
export function orderedLines(order: Order): OrderedLine[] {
  return order.items.flatMap((item) =>
    item.variantId ? [{ productId: item.productId, variantId: item.variantId, quantity: item.quantity }] : []);
}

export type CartLineReview<Line extends OrderedLine> = {
  line: Line;
  index: number;
  product?: CatalogProduct;
  variant?: CatalogVariant;
  problem: "unavailable" | "out-of-stock" | "over-stock" | null;
};

export type CartReview<Line extends OrderedLine> = {
  lines: CartLineReview<Line>[];
  /** Why no quote is requested: the whole cart is quoted or nothing is, never a silent subset. */
  blocker: "unavailable" | "stock" | "too-many" | null;
};

/** Checks every cart line against the catalog before quoting; the server re-checks on every quote. */
export function reviewCart<Line extends OrderedLine>(
  cart: readonly Line[], productsById: ReadonlyMap<string, CatalogProduct>,
): CartReview<Line> {
  const lines = cart.map((line, index): CartLineReview<Line> => {
    const product = productsById.get(line.productId);
    const variant = product?.variants.find((item) => item.id === line.variantId && item.isActive);
    if (!product || !variant) return { line, index, product, variant, problem: "unavailable" };
    const problem = variant.stock <= 0 ? "out-of-stock" : line.quantity > variant.stock ? "over-stock" : null;
    return { line, index, product, variant, problem };
  });
  const blocker = lines.some((entry) => entry.problem === "unavailable") ? "unavailable"
    : lines.some((entry) => entry.problem !== null) ? "stock"
    : cart.length > MAX_QUOTE_ITEMS ? "too-many"
    : null;
  return { lines, blocker };
}

/* ------------------------------------------------------------------ */
/* Pending order intent                                               */
/* ------------------------------------------------------------------ */

/** One submission per customer, persisted before it is sent so an unknown outcome is resolved, not repeated. */
export type OrderIntent = {
  quoteId: string;
  idempotencyKey: string;
  /** Request signature of the reviewed quote. */
  signature: string;
  /** Total the customer reviewed, shown while the outcome is resolved. */
  total: number;
  createdAt: string;
};

const IDEMPOTENCY_KEY = /^[A-Za-z0-9:_-]{16,128}$/;

/** The server's accepted request-key form for order and payment requests. */
export const isIdempotencyKey = (value: unknown): value is string => isString(value) && IDEMPOTENCY_KEY.test(value);

export function isOrderIntent(value: unknown): value is OrderIntent {
  return isRecord(value) && isId(value.quoteId) && isIdempotencyKey(value.idempotencyKey) &&
    isString(value.signature) && isMoney(value.total) && isTimestamp(value.createdAt);
}

const KEY_BYTES = 16;

/** A fresh random request key; a retry of the same intent always reuses its key. */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(KEY_BYTES)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* Failure classification                                             */
/* ------------------------------------------------------------------ */

const SERVER_ERROR = 500;

/** Rejections the customer resolves by reviewing a fresh quote; other codes keep the server's wording. */
const REVIEW_MESSAGES: Record<string, string> = {
  QUOTE_CHANGED: "Prices, delivery or your address changed since you reviewed this order. Nothing was reserved.",
  QUOTE_EXPIRED: "The prices you reviewed expired before the order was placed. Nothing was reserved.",
  QUOTE_NOT_FOUND: "The prices you reviewed are no longer available. Nothing was reserved.",
  IDEMPOTENCY_CONFLICT: "This order request could not be matched safely, so nothing was reserved.",
};

export type OrderFailure =
  /** The customer session changed; the result belongs to nobody on screen. */
  | { kind: "cancelled" }
  /** No reliable answer: the order may exist. Keep the intent and resolve or retry the same key. */
  | { kind: "unknown"; message: string }
  /** Transient conflict the server asks to retry with the same key. */
  | { kind: "retry"; message: string }
  /** This quote already created an order; find it rather than create another. */
  | { kind: "used"; message: string }
  /** The server refused; nothing was created. A new quote and review are required. */
  | { kind: "rejected"; code?: string; message: string };

export function classifyOrderFailure(error: unknown): OrderFailure {
  if (isCancel(error)) return { kind: "cancelled" };
  const unknown = "We could not confirm whether your order was placed. Nothing will be submitted twice; check its status or retry the same request.";
  if (error instanceof CheckoutFormatError) return { kind: "unknown", message: unknown };
  if (!isAxiosError(error)) return { kind: "unknown", message: unknown };
  const status = apiStatus(error);
  const code = apiErrorCode(error);
  if (status === undefined || (status >= SERVER_ERROR && code !== "ORDERING_UNAVAILABLE")) return { kind: "unknown", message: unknown };
  const message = describeApiError(error, "The order could not be placed.");
  if (code === "ORDER_RETRY") return { kind: "retry", message };
  if (code === "QUOTE_USED") return { kind: "used", message };
  return { kind: "rejected", code, message: (code && REVIEW_MESSAGES[code]) || message };
}

/** Customer-facing explanation of a failed quote, with the code that decides where it is shown. */
export function describeQuoteFailure(error: unknown): { code?: string; message: string } {
  if (error instanceof CheckoutFormatError) return { message: `${error.message} Try again shortly.` };
  const code = apiErrorCode(error);
  if (code === "DEMO_ORDER_UNAVAILABLE") {
    return { code, message: "Demo listings are samples and cannot be ordered. Remove them from your cart to continue." };
  }
  return { code, message: describeApiError(error, "Prices for your cart could not be calculated.") };
}
