/**
 * Server-shaped quote and pending-order fixtures shared by unit and browser tests. Every amount is
 * written out as the server returns it; nothing here prices anything.
 */
import type { Address } from "../api/auth";
import type { Order, Quote, QuoteLine } from "../api/orders";
import { linenShirt, poloShirt } from "./catalogFixtures";

/** Fixture quotes and holds stay valid this long from when they are built. */
const QUOTE_LIFETIME_MS = 10 * 60 * 1000;
const RESERVATION_LIFETIME_MS = 15 * 60 * 1000;

export const homeAddress: Address = {
  id: "addr-home", street: "1 Test Lane", city: "Nairobi", county: "Nairobi", isDefault: true,
};
export const officeAddress: Address = {
  id: "addr-office", street: "2 Office Road", city: "Mombasa", county: "Mombasa", isDefault: false,
};

/** One linen shirt, M/White: KES 1,000 less the 10% offer. */
export const linenLine: QuoteLine = {
  productId: linenShirt.id, variantId: "var-linen-m-white", productName: linenShirt.name, sku: "VAR-LINEN-M-WHITE",
  attributes: { size: "M", color: "White" }, quantity: 1, productImage: "https://media.example.test/linen-front.jpg",
  originalUnitPrice: 1000, unitPrice: 900, total: 900, couponDiscount: 0, discount: 100, discountId: "disc-linen",
};

export const poloLine: QuoteLine = {
  productId: poloShirt.id, variantId: "var-polo", productName: poloShirt.name, sku: "VAR-POLO",
  attributes: {}, quantity: 1, productImage: "https://media.example.test/polo.jpg",
  originalUnitPrice: 2200, unitPrice: 2200, total: 2200, couponDiscount: 0, discount: 0, discountId: null,
};

/** Two of the same shirt: KES 1,800 with KES 288 VAT and KES 200 delivery, KES 2,288. Pass to `fixtureQuote`. */
export const linenPair: Partial<Quote> = {
  lines: [{ ...linenLine, quantity: 2, total: 1800, discount: 200 }],
  subtotal: 2000, discount: 200, discountedSubtotal: 1800, tax: 288, total: 2288,
};

/** One linen shirt (KES 900) with KES 144 VAT at 16% and KES 200 standard delivery: KES 1,244. */
export function fixtureQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "quote-1", version: 1, currency: "KES", policyVersion: 1, policyHash: "test-policy-hash", vatRate: 16, mode: "live",
    address: { id: homeAddress.id, street: homeAddress.street, city: homeAddress.city, county: homeAddress.county, postalCode: null },
    notes: null, couponCode: null, couponApplied: false, couponMessage: null, deliveryMethod: "STANDARD",
    lines: [linenLine], subtotal: 1000, discount: 100, discountedSubtotal: 900, tax: 144, shippingCost: 200, total: 1244,
    expiresAt: new Date(Date.now() + QUOTE_LIFETIME_MS).toISOString(), expired: false, consumed: false, orderId: null,
    reservationsEnabled: true,
    ...overrides,
  };
}

/** The unpaid pending order a quote creates, with its items held and totals copied from the quote. */
export function fixturePendingOrder(quote: Quote, overrides: Partial<Order> = {}): Order {
  const createdAt = new Date().toISOString();
  return {
    id: `order-${quote.id}`, orderNumber: `APX-${quote.id.toUpperCase()}`, quoteId: quote.id,
    items: quote.lines.map((line, index) => ({
      id: `item-${index + 1}`, productId: line.productId, variantId: line.variantId, sku: line.sku,
      variantAttributes: line.attributes, productName: line.productName, productPrice: line.unitPrice,
      quantity: line.quantity, subtotal: line.total, productImage: line.productImage, pricingSnapshot: line,
    })),
    subtotal: quote.subtotal, discount: quote.discount, tax: quote.tax, shippingCost: quote.shippingCost, total: quote.total,
    status: "PENDING", paymentStatus: "PENDING", paymentMethod: "MPESA", deliveryMethod: quote.deliveryMethod,
    address: quote.address, trackingHistory: [], createdAt, updatedAt: createdAt,
    reservationStatus: "HELD", reservationExpiresAt: new Date(Date.now() + RESERVATION_LIFETIME_MS).toISOString(),
    pricingSnapshot: {
      currency: quote.currency, policyVersion: quote.policyVersion, policyHash: quote.policyHash, vatRate: quote.vatRate,
      couponCode: quote.couponCode, couponApplied: quote.couponApplied, discountedSubtotal: quote.discountedSubtotal,
    },
    isDemo: false,
    ...overrides,
  };
}
