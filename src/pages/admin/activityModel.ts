import type { ActivityEntry, ActivityPage } from "../../api/admin";
import { isPagination } from "../../store/orderModel";
import { isRecord } from "../../utils/storage";
import { adminModuleRoute, productsRoute } from "./adminRoutes";

const isString = (value: unknown): value is string => typeof value === "string";
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);

function isEntry(value: unknown): value is ActivityEntry {
  return isRecord(value) && isString(value.id) && value.id !== "" && isString(value.at) && !Number.isNaN(Date.parse(value.at)) &&
    isString(value.action) && value.action !== "" && isNullableString(value.targetType) && isNullableString(value.targetId) &&
    isString(value.details) && isRecord(value.staff) && isString(value.staff.username) && isString(value.staff.role);
}

/** A page of staff activity as the API sends it, or null when it is not in that shape. */
export function parseActivityPage(data: unknown): ActivityPage | null {
  if (!isRecord(data) || !Array.isArray(data.entries) || !data.entries.every(isEntry) || !isPagination(data.pagination)) return null;
  return { entries: data.entries, pagination: data.pagination };
}

/** What each recorded action says happened; a sign-in reads only "Signed in". */
const VERB_PHRASES = new Map<string, string>([
  ["STOREFRONT_PUBLISHED", "Published the storefront"],
  ["STOREFRONT_RESTORED", "Restored an earlier storefront version to the draft"],
  ["PRODUCT_CREATED", "Added a product"],
  ["PRODUCT_UPDATED", "Edited a product"],
  ["PRODUCT_DELETED", "Deleted a product"],
  ["CATEGORY_CREATED", "Added a category"],
  ["CATEGORY_UPDATED", "Edited a category"],
  ["CATEGORY_DELETED", "Deleted a category"],
  ["CATEGORIES_REORDERED", "Reordered categories"],
  ["DESIGNER_CREATED", "Added a designer"],
  ["DESIGNER_UPDATED", "Edited a designer"],
  ["DESIGNER_DELETED", "Deleted a designer"],
  ["DISCOUNT_CREATED", "Added a discount"],
  ["DISCOUNT_UPDATED", "Edited a discount"],
  ["DISCOUNT_STOPPED", "Stopped a discount"],
  ["DISCOUNT_DELETED", "Deleted a discount"],
  ["CUSTOMER_DISABLED", "Disabled a customer account"],
  ["CUSTOMER_ENABLED", "Re-enabled a customer account"],
  ["CUSTOMER_DELETED", "Deleted a customer account"],
  ["CUSTOMER_VERIFICATION_SENT", "Sent verification emails"],
  ["PROMOTION_SENT", "Sent a promotional email"],
  ["SUBSCRIBER_REMOVED", "Removed a newsletter subscriber"],
]);

/** "Edited a product: Linen Shirt": the verb phrase (an unknown action as recorded), then any details. */
export function activitySentence(entry: ActivityEntry): string {
  if (entry.action === "LOGIN") return "Signed in";
  const phrase = VERB_PHRASES.get(entry.action) ?? entry.action;
  return entry.details.trim() ? `${phrase}: ${entry.details}` : phrase;
}

/** Where an entry leads: its visible text, and an accessible name that includes it and names the subject. */
export type ActivityLink = { to: string; text: string; name: string };

const OPENS_PRODUCT = ["PRODUCT_CREATED", "PRODUCT_UPDATED"];
const OPENS_STOREFRONT = ["STOREFRONT_PUBLISHED", "STOREFRONT_RESTORED"];
const OPENS_DISCOUNTS = ["DISCOUNT_CREATED", "DISCOUNT_UPDATED", "DISCOUNT_STOPPED", "DISCOUNT_DELETED"];

/**
 * Products (not deleted ones) open in the product editor, storefront entries in the storefront editor, and discount
 * entries on the Discounts list (it has no address for one discount, so the link names the list). Customer and
 * subscriber entries, and everything else, have no link.
 */
export function activityLink(entry: ActivityEntry): ActivityLink | null {
  const subject = entry.details.trim();
  if (OPENS_PRODUCT.includes(entry.action) && entry.targetId) {
    return { to: productsRoute(entry.targetId), text: "Open product", name: subject ? `Open product ${subject}` : "Open product" };
  }
  if (OPENS_STOREFRONT.includes(entry.action)) {
    return { to: adminModuleRoute("storefront"), text: "Open storefront editor", name: "Open storefront editor" };
  }
  if (OPENS_DISCOUNTS.includes(entry.action)) {
    return { to: adminModuleRoute("discounts"), text: "Open discounts", name: "Open discounts" };
  }
  return null;
}
