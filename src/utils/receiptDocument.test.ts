import { describe, expect, it } from "vitest";
import type { User } from "../api/auth";
import { fixtureQuote, fixturePendingOrder } from "../test-support/checkoutFixtures";
import { fixtureCustomerOrder } from "../test-support/orderFixtures";
import { BRAND_MARK_PATHS } from "./brandMark";
import { receiptDocument } from "./receiptDocument";

const MARKUP = '<img src=x onerror="alert(1)">';
const CLOSE_TITLE = "</title><script>alert(2)</script>";
const ATTRIBUTE_BREAK = '"><svg onload=alert(3)>';
const QUOTE_BREAK = "' onmouseover='alert(4)";

const customer: User = {
  id: "customer-1", firstName: MARKUP, lastName: QUOTE_BREAK, email: `buyer${ATTRIBUTE_BREAK}@example.test`, phone: "<b>0700</b>",
};

function hostileOrder() {
  const order = fixtureCustomerOrder(fixturePendingOrder(fixtureQuote()));
  const [line] = order.items;
  return {
    ...order,
    orderNumber: CLOSE_TITLE,
    paymentMethod: `CARD${ATTRIBUTE_BREAK}`,
    createdAt: `not-a-date${MARKUP}`,
    address: { id: "address-1", street: MARKUP, city: CLOSE_TITLE, county: QUOTE_BREAK, isDefault: true },
    items: [{ ...line, productName: `${MARKUP} shirt`, variantAttributes: { size: ATTRIBUTE_BREAK, [MARKUP]: "red" } }],
  };
}

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("printed receipt document", () => {
  it("escapes every order, customer and brand value instead of interpreting it as markup", () => {
    const document = parse(receiptDocument(hostileOrder(), customer, `Apex ${MARKUP}`));
    expect(document.querySelectorAll("script, img, iframe, object, embed, a, form")).toHaveLength(0);
    expect(document.querySelectorAll("svg")).toHaveLength(1);
    expect(document.querySelectorAll("b")).toHaveLength(0);
    for (const element of document.querySelectorAll("*")) {
      for (const attribute of element.attributes) expect(attribute.name).not.toMatch(/^on/i);
    }
    expect(document.title).toBe(`Receipt ${CLOSE_TITLE} · Apex ${MARKUP}`);
    const text = document.body.textContent ?? "";
    for (const value of [`${MARKUP} shirt`, MARKUP, QUOTE_BREAK, ATTRIBUTE_BREAK, CLOSE_TITLE, "<b>0700</b>", `not-a-date${MARKUP}`]) {
      expect(text).toContain(value);
    }
    expect(document.querySelector(".name")?.textContent).toBe(`Apex ${MARKUP}`);
  });

  it("prints the navy mark at no less than 9mm beside the brand name on white paper", () => {
    const html = receiptDocument(fixtureCustomerOrder(fixturePendingOrder(fixtureQuote())), customer, "Apex Cart");
    const document = parse(html);
    const mark = document.querySelector(".lockup svg");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(Number.parseFloat(mark?.getAttribute("width") ?? "0")).toBeGreaterThanOrEqual(9);
    expect(mark?.getAttribute("width")).toMatch(/mm$/);
    expect(mark?.querySelector("g")?.getAttribute("fill")).toBe("#14213D");
    expect([...(mark?.querySelectorAll("path") ?? [])].map((path) => path.getAttribute("d"))).toEqual([...BRAND_MARK_PATHS]);
    expect(document.querySelector(".lockup .name")?.textContent).toBe("Apex Cart");

    const styles = document.querySelector("style")?.textContent ?? "";
    expect(styles).toContain('font: 400 10.5pt/1.5 Jost, "Segoe UI", Arial, sans-serif');
    expect(styles).toMatch(/\.name \{ font-family: Marcellus, [^;]*serif; font-weight: 400;/);
    expect(styles).toContain("background: #fff");
    expect(styles).not.toMatch(/border-left/);
  });

  it("keeps the order's stored facts: items, discount, VAT, delivery, total, status and payment", () => {
    // Stored amounts are printed as recorded, never recalculated.
    const order = fixtureCustomerOrder(fixturePendingOrder(fixtureQuote()), {
      subtotal: 1000, discount: 150, tax: 136, shippingCost: 200, total: 1186, paymentStatus: "PAID",
    });
    const document = parse(receiptDocument(order, customer, "Apex Cart"));
    const row = document.querySelector("tbody tr");
    expect([...(row?.querySelectorAll("td") ?? [])].map((cell) => cell.textContent)).toEqual([
      "Linen Short-Sleeve ShirtSize: M · Color: White", "1", "KES 900", "KES 900",
    ]);
    const totals = [...document.querySelectorAll(".totals p")].map((line) => [...line.children].map((cell) => cell.textContent));
    expect(totals).toEqual([
      ["Subtotal", "KES 1,000"], ["Discount", "-KES 150"], ["VAT (16%)", "KES 136"], ["Delivery", "KES 200"], ["Total", "KES 1,186"],
    ]);
    expect(document.querySelector(".totals .grand")?.textContent).toBe("TotalKES 1,186");
    const facts = Object.fromEntries([...document.querySelectorAll(".facts > div")].map((fact) =>
      [fact.querySelector(".label")?.textContent, fact.querySelector(".value")?.textContent]));
    // A paid order still awaiting fulfilment says so, never just "Pending" beside "M-Pesa (paid)".
    expect(facts["Order status"]).toBe("Waiting to be prepared");
    expect(facts.Status).toBeUndefined();
    expect(facts.Payment).toBe("M-Pesa (paid)");
    expect(facts.Delivery).toContain("Standard delivery");
    expect(document.querySelector(".title p")?.textContent).toBe(`Order ${order.orderNumber}`);
  });

  it("names the fact \"Order status\" and prints an unpaid order as awaiting payment", () => {
    const document = parse(receiptDocument(fixtureCustomerOrder(fixturePendingOrder(fixtureQuote())), customer, "Apex Cart"));
    const labels = [...document.querySelectorAll(".facts .label")].map((label) => label.textContent);
    expect(labels).toEqual(["Date", "Order status", "Payment", "Customer", "Delivery"]);
    const status = [...document.querySelectorAll(".facts > div")].find((fact) => fact.querySelector(".label")?.textContent === "Order status");
    expect(status?.querySelector(".value")?.textContent).toBe("Awaiting payment");
  });
});
