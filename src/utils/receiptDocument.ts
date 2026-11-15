import type { User } from "../api/auth";
import type { CustomerOrder } from "../api/orders";
import { describeVariant } from "../store/catalogModel";
import { DELIVERY_LABELS } from "../store/checkoutModel";
import { customerName, deliveryAddress, orderStatusLabel, paymentLabel } from "../store/orderCopy";
import { BRAND_NAVY, brandMarkSvg } from "./brandMark";
import { formatDateTime, formatKES } from "./format";

/** At least 9mm on paper, so the printed mark stays recognisable. */
const PRINTED_MARK_SIZE = "12mm";
const FONT_STYLESHEET = "https://fonts.googleapis.com/css2?family=Marcellus&family=Jost:wght@400;500;600;700&display=swap";

/** Escapes text for HTML content and double-quoted attributes. */
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** One escaped `<br>`-separated block, skipping empty lines. */
const lines = (...values: (string | null | undefined)[]) => values.filter(Boolean).map((value) => escapeHtml(value ?? "")).join("<br>");

function fact(label: string, valueHtml: string) {
  return `<div><div class="label">${escapeHtml(label)}</div><div class="value">${valueHtml}</div></div>`;
}

const STYLES = `
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #253044; font: 400 10.5pt/1.5 Jost, "Segoe UI", Arial, sans-serif; }
  .receipt { max-width: 180mm; margin: 0 auto; padding: 10mm 6mm; }
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; padding-bottom: 12px; border-bottom: 2px solid ${BRAND_NAVY}; }
  .lockup { display: flex; align-items: center; gap: 10px; color: ${BRAND_NAVY}; }
  .lockup svg { flex: none; }
  .name { font-family: Marcellus, Georgia, "Times New Roman", serif; font-weight: 400; font-size: 18pt; letter-spacing: .14em; text-transform: uppercase; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 15pt; font-weight: 600; color: ${BRAND_NAVY}; }
  .title p { margin: 2px 0 0; color: #475569; }
  .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; margin: 18px 0 20px; overflow-wrap: anywhere; }
  .label { font-size: 8pt; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #475569; }
  .value { margin-top: 2px; color: ${BRAND_NAVY}; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { padding: 6px 8px; border-bottom: 1.5px solid ${BRAND_NAVY}; text-align: left; font-size: 8pt; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #475569; }
  td { padding: 8px; border-bottom: 1px solid #D8DEE7; vertical-align: top; overflow-wrap: anywhere; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  .variant { display: block; font-size: 9pt; color: #475569; }
  .totals { width: 72mm; max-width: 100%; margin: 14px 0 0 auto; font-variant-numeric: tabular-nums; }
  .totals p { display: flex; justify-content: space-between; gap: 16px; margin: 4px 0; }
  .totals .grand { margin-top: 8px; padding-top: 8px; border-top: 2px solid ${BRAND_NAVY}; font-size: 13pt; font-weight: 700; color: ${BRAND_NAVY}; }
  .thanks { margin-top: 24px; padding-top: 10px; border-top: 1px solid #D8DEE7; font-size: 9pt; color: #475569; }
  @media print { .receipt { max-width: none; padding: 0; } }
`;

/**
 * The printable receipt as a standalone HTML document. Every value from the order, the customer or the
 * published brand name is escaped: the document is written into a same-origin window.
 */
export function receiptDocument(order: CustomerOrder, user: User | null, brandName: string) {
  const brand = escapeHtml(brandName);
  const orderNumber = escapeHtml(order.orderNumber);
  const items = order.items.map((item) => {
    const variant = item.variantAttributes && Object.keys(item.variantAttributes).length
      ? `<span class="variant">${escapeHtml(describeVariant({ attributes: item.variantAttributes }))}</span>` : "";
    return `<tr><td>${escapeHtml(item.productName)}${variant}</td><td class="num">${escapeHtml(String(item.quantity))}</td>` +
      `<td class="num">${escapeHtml(formatKES(item.productPrice))}</td><td class="num">${escapeHtml(formatKES(item.subtotal))}</td></tr>`;
  }).join("");
  const taxLabel = order.pricingSnapshot ? `VAT (${order.pricingSnapshot.vatRate}%)` : "Tax";
  const total = (label: string, amount: string) => `<p><span>${escapeHtml(label)}</span><span>${escapeHtml(amount)}</span></p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Receipt ${orderNumber} · ${brand}</title>
    <link rel="stylesheet" href="${FONT_STYLESHEET}">
    <style>${STYLES}</style>
  </head>
  <body>
    <main class="receipt">
      <header class="head">
        <div class="lockup">${brandMarkSvg(BRAND_NAVY, PRINTED_MARK_SIZE)}<span class="name">${brand}</span></div>
        <div class="title"><h1>Receipt</h1><p>Order ${orderNumber}</p></div>
      </header>
      <section class="facts">
        ${fact("Date", escapeHtml(formatDateTime(order.createdAt)))}
        ${fact("Status", escapeHtml(orderStatusLabel(order)))}
        ${fact("Payment", escapeHtml(paymentLabel(order)))}
        ${fact("Customer", lines(customerName(user), user?.email, user?.phone))}
        ${fact("Delivery", lines(DELIVERY_LABELS[order.deliveryMethod], deliveryAddress(order)))}
      </section>
      <table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
      <div class="totals">
        ${total("Subtotal", formatKES(order.subtotal))}
        ${total("Discount", `-${formatKES(order.discount)}`)}
        ${total(taxLabel, formatKES(order.tax))}
        ${total("Delivery", formatKES(order.shippingCost))}
        <p class="grand"><span>Total</span><span>${escapeHtml(formatKES(order.total))}</span></p>
      </div>
      <p class="thanks">Thank you for shopping with ${brand}.</p>
    </main>
  </body>
</html>`;
}
