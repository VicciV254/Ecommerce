import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../../api/admin";
import { activityLink, activitySentence, parseActivityPage } from "./activityModel";

const entry = (action: string, details = "", overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: `entry-${action}`, at: "2026-11-17T11:05:00.000Z", action, targetType: null, targetId: null, details,
  staff: { username: "alice", role: "ADMIN" }, ...overrides,
});

/** Every action the API records, read from its activity service. */
function recordedActions() {
  const source = readFileSync(resolve(__dirname, "../../../backend/src/services/activityService.js"), "utf8");
  const block = /export const ACTIVITY = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/^\s*([A-Z_]+): '([A-Z_]+)',$/gm)].map((match) => match[2]);
}

describe("activity sentences", () => {
  it("says what happened, then the details when there are any", () => {
    expect(activitySentence(entry("PRODUCT_UPDATED", "Linen Shirt"))).toBe("Edited a product: Linen Shirt");
    expect(activitySentence(entry("STOREFRONT_PUBLISHED", "version 6"))).toBe("Published the storefront: version 6");
    expect(activitySentence(entry("STOREFRONT_RESTORED", "version 4"))).toBe("Restored an earlier storefront version to the draft: version 4");
    expect(activitySentence(entry("CATEGORIES_REORDERED", "departments"))).toBe("Reordered categories: departments");
    expect(activitySentence(entry("CUSTOMER_VERIFICATION_SENT", "2 customers"))).toBe("Sent verification emails: 2 customers");
    expect(activitySentence(entry("CUSTOMER_ENABLED"))).toBe("Re-enabled a customer account");
    expect(activitySentence(entry("SUBSCRIBER_REMOVED", "   "))).toBe("Removed a newsletter subscriber");
  });

  it("reads a sign-in only as Signed in, and an unknown action as it was recorded", () => {
    expect(activitySentence(entry("LOGIN", "Admin logged in"))).toBe("Signed in");
    expect(activitySentence(entry("LEGACY_IMPORT", "3 orders"))).toBe("LEGACY_IMPORT: 3 orders");
    expect(activitySentence(entry("constructor"))).toBe("constructor");
  });

  it("has a plain sentence for every action the API records", () => {
    const actions = recordedActions();
    expect(actions.length).toBeGreaterThan(20);
    expect(actions.filter((action) => activitySentence(entry(action)) === action)).toEqual([]);
  });
});

describe("activity links", () => {
  it("opens a product that still exists in the product editor, named with the product", () => {
    expect(activityLink(entry("PRODUCT_UPDATED", "Linen Shirt", { targetType: "product", targetId: "prod-linen-shirt" }))).toEqual({
      to: "/admin/catalog/products?product=prod-linen-shirt", text: "Open product", name: "Open product Linen Shirt",
    });
    expect(activityLink(entry("PRODUCT_CREATED", "Wool Coat", { targetType: "product", targetId: "prod-wool" }))?.to).toBe("/admin/catalog/products?product=prod-wool");
    expect(activityLink(entry("PRODUCT_DELETED", "Old Coat", { targetType: "product", targetId: "prod-old" }))).toBeNull();
  });

  it("opens the storefront editor for storefront entries, and the Discounts list, named as such, for discount entries", () => {
    for (const action of ["STOREFRONT_PUBLISHED", "STOREFRONT_RESTORED"]) {
      expect(activityLink(entry(action, "version 6", { targetType: "storefront", targetId: "6" }))).toEqual({
        to: "/admin/storefront/editor", text: "Open storefront editor", name: "Open storefront editor",
      });
    }
    // Discounts has no address for one discount (and a deleted one is gone), so the link names the list it opens.
    for (const action of ["DISCOUNT_CREATED", "DISCOUNT_UPDATED", "DISCOUNT_STOPPED", "DISCOUNT_DELETED"]) {
      expect(activityLink(entry(action, "Linen week", { targetType: "discount", targetId: "disc-1" }))).toEqual({
        to: "/admin/customers/discounts", text: "Open discounts", name: "Open discounts",
      });
    }
  });

  it("gives customer, subscriber, category, designer and sign-in entries no link", () => {
    for (const action of ["CUSTOMER_DISABLED", "CUSTOMER_DELETED", "CUSTOMER_VERIFICATION_SENT", "PROMOTION_SENT", "SUBSCRIBER_REMOVED",
      "CATEGORY_UPDATED", "CATEGORIES_REORDERED", "DESIGNER_CREATED", "LOGIN"]) {
      expect(activityLink(entry(action, "", { targetType: "customer", targetId: "user-1" })), action).toBeNull();
    }
  });
});

describe("activity pages", () => {
  const page = (entries: unknown[]) => ({ entries, pagination: { page: 1, limit: 25, pages: 1, total: entries.length } });

  it("accepts the API's page", () => {
    const listed = [entry("LOGIN", "Admin logged in"), entry("PRODUCT_UPDATED", "Linen Shirt", { targetType: "product", targetId: "prod-1" })];
    expect(parseActivityPage(page(listed))).toEqual(page(listed));
  });

  it.each([
    ["no staff", { ...entry("LOGIN"), staff: undefined }],
    ["an impossible time", entry("LOGIN", "", { at: "yesterday" })],
    ["a missing action", entry("", "")],
    ["numeric details", { ...entry("LOGIN"), details: 3 }],
  ])("refuses an entry with %s", (_label, item) => {
    expect(parseActivityPage(page([item]))).toBeNull();
  });

  it("refuses a page without its pagination", () => {
    expect(parseActivityPage({ entries: [] })).toBeNull();
  });
});
