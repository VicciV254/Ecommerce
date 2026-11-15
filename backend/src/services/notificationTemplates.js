import { brandedEmail, emailPalette, escapeHtml, isHttpUrl } from './mailService.js';

const BRAND_NAME = 'Apex Cart';
const FOOTER_NOTE = `You are receiving this email because you placed an order with ${BRAND_NAME}.`;
const TIME_ZONE = 'Africa/Nairobi';
const TIME_ZONE_LABEL = 'EAT';
const CENTS_PER_SHILLING = 100;
const wholeShillings = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });
const shillingsWithCents = new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentNumber = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE });

const DELIVERY_METHOD_LABELS = Object.freeze({
  STANDARD: 'Standard delivery',
  SAME_DAY: 'Same-day delivery',
  STORE_PICKUP: 'Store pickup',
});
const RETURN_REASON_LABELS = Object.freeze({
  CHANGED_MIND: 'Changed my mind',
  FAULTY: 'Faulty item',
  DAMAGED: 'Damaged item',
  WRONG_ITEM: 'Wrong item',
  OTHER: 'Other',
});
const REFUND_SOURCE_NOTES = Object.freeze({
  CANCELLATION: 'This refund is for your cancelled order.',
  RETURN: 'This refund is for your returned items.',
  PAYMENT_REVIEW: 'This refund is for a payment our team reviewed on this order.',
});

const { navy, gold, panel, border, ink, muted } = emailPalette;
const CELL = `padding:8px 10px;border-bottom:1px solid ${border};font-size:14px;line-height:1.5;vertical-align:top;color:${ink};`;
const STYLE = Object.freeze({
  paragraph: `margin:0 0 16px;font-size:15px;line-height:1.6;color:${ink};`,
  notice: `margin:0 0 20px;padding:14px 16px;background:${panel};border:1px solid ${gold};border-radius:8px;font-size:15px;line-height:1.6;font-weight:700;color:${navy};`,
  note: `margin:0 0 20px;padding:14px 16px;background:${panel};border:1px solid ${border};border-radius:8px;font-size:15px;line-height:1.6;color:${ink};`,
  heading: `margin:24px 0 8px;font-size:17px;line-height:1.4;font-weight:700;color:${navy};`,
  table: 'width:100%;border-collapse:collapse;margin:0 0 20px;',
  headCell: `padding:8px 10px;border-bottom:2px solid ${navy};font-size:13px;line-height:1.4;font-weight:700;text-align:left;color:${navy};`,
  headCellEnd: `padding:8px 10px;border-bottom:2px solid ${navy};font-size:13px;line-height:1.4;font-weight:700;text-align:right;color:${navy};`,
  cell: `${CELL}text-align:left;`,
  cellEnd: `${CELL}text-align:right;white-space:nowrap;`,
  label: `${CELL}text-align:left;font-weight:700;`,
  amountLabel: `${CELL}text-align:left;font-weight:400;`,
  totalLabel: `${CELL}text-align:left;font-weight:800;color:${navy};`,
  totalValue: `${CELL}text-align:right;white-space:nowrap;font-weight:800;color:${navy};`,
  detail: `font-size:13px;line-height:1.5;color:${muted};`,
});

function contextError(path) {
  return Object.assign(new Error(`Notification context has a missing or invalid ${path}`), { code: 'INVALID_NOTIFICATION_CONTEXT' });
}

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requiredText(value, path) {
  const text = optionalText(value);
  if (!text) throw contextError(path);
  return text;
}

function formatKes(value, path) {
  const amount = Number(value);
  if (isBlank(value) || !Number.isFinite(amount)) throw contextError(path);
  const cents = Math.round(Math.abs(amount) * CENTS_PER_SHILLING);
  const shillings = cents / CENTS_PER_SHILLING;
  const formatted = cents % CENTS_PER_SHILLING === 0 ? wholeShillings.format(shillings) : shillingsWithCents.format(shillings);
  return `${amount < 0 && cents > 0 ? '-' : ''}KES ${formatted}`;
}

function optionalAmount(value, path) {
  if (isBlank(value)) return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw contextError(path);
  return amount;
}

function formatQuantity(value, path) {
  const quantity = Number(value);
  if (isBlank(value) || !Number.isInteger(quantity) || quantity < 0) throw contextError(path);
  return String(quantity);
}

function formatDateTime(value, path) {
  const date = new Date(value);
  if (isBlank(value) || Number.isNaN(date.getTime())) throw contextError(path);
  return `${dateTime.format(date)} ${TIME_ZONE_LABEL}`;
}

function optionalDateTime(value, path) {
  return isBlank(value) ? null : formatDateTime(value, path);
}

function vatLabel(rate) {
  if (isBlank(rate)) return 'VAT';
  const percent = Number(rate);
  if (!Number.isFinite(percent)) throw contextError('order.vatRate');
  return `VAT (${percentNumber.format(percent)}%)`;
}

function formatAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return '';
  return Object.entries(attributes)
    .filter(([, value]) => !isBlank(value))
    .map(([name, value]) => `${name}: ${value}`)
    .join(', ');
}

function labelFor(labels, value) {
  return typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : null;
}

function paragraph(text) {
  return { html: `<p style="${STYLE.paragraph}">${escapeHtml(text)}</p>`, text };
}

function notice(text) {
  return { html: `<p style="${STYLE.notice}">${escapeHtml(text)}</p>`, text };
}

function noteBlock(label, note) {
  return {
    html: `<div style="${STYLE.note}"><strong>${escapeHtml(label)}</strong><br>${escapeHtml(note).replace(/\r?\n/g, '<br>')}</div>`,
    text: `${label}:\n${note}`,
  };
}

function tableHtml(rowsHtml, headHtml = '') {
  return `<table cellspacing="0" cellpadding="0" style="${STYLE.table}">\n${headHtml}<tbody>\n${rowsHtml}\n</tbody>\n</table>`;
}

// Label/value rows; rows with a blank value are left out. `totals` right-aligns amounts and emphasises the last row.
function keyValueBlock(rows, { totals = false } = {}) {
  const present = rows.filter((row) => row && !isBlank(row[1]));
  if (present.length === 0) return null;
  const rowsHtml = present
    .map(([label, value], index) => {
      const emphasis = totals && index === present.length - 1;
      const labelStyle = emphasis ? STYLE.totalLabel : totals ? STYLE.amountLabel : STYLE.label;
      const valueStyle = emphasis ? STYLE.totalValue : totals ? STYLE.cellEnd : STYLE.cell;
      return `<tr><th scope="row" style="${labelStyle}">${escapeHtml(label)}</th><td style="${valueStyle}">${escapeHtml(value)}</td></tr>`;
    })
    .join('\n');
  return { html: tableHtml(rowsHtml), text: present.map(([label, value]) => `${label}: ${value}`).join('\n') };
}

// Columns after the first are right-aligned quantities or amounts; `detail` renders under the first cell.
function dataTableHtml(headings, rows) {
  const head = headings
    .map((heading, index) => `<th scope="col" style="${index === 0 ? STYLE.headCell : STYLE.headCellEnd}">${escapeHtml(heading)}</th>`)
    .join('');
  const rowsHtml = rows
    .map(({ cells: [first, ...rest], detail }) => {
      const detailHtml = detail ? `<br><span style="${STYLE.detail}">${escapeHtml(detail)}</span>` : '';
      const restHtml = rest.map((cell) => `<td style="${STYLE.cellEnd}">${escapeHtml(cell)}</td>`).join('');
      return `<tr><td style="${STYLE.cell}">${escapeHtml(first)}${detailHtml}</td>${restHtml}</tr>`;
    })
    .join('\n');
  return tableHtml(rowsHtml, `<thead><tr>${head}</tr></thead>\n`);
}

function sectionHeading(title) {
  return `<h2 style="${STYLE.heading}">${escapeHtml(title)}</h2>`;
}

function itemsBlock(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const rows = items.map((item, index) => {
    const path = `order.items[${index}]`;
    return {
      cells: [
        requiredText(item?.productName, `${path}.productName`),
        formatQuantity(item.quantity, `${path}.quantity`),
        formatKes(item.lineTotal, `${path}.lineTotal`),
      ],
      detail: formatAttributes(item.attributes),
    };
  });
  const lines = rows.map(({ cells: [name, quantity, amount], detail }) => `- ${name}${detail ? ` (${detail})` : ''} x ${quantity}: ${amount}`);
  return {
    html: `${sectionHeading('Items')}\n${dataTableHtml(['Item', 'Qty', 'Amount'], rows)}`,
    text: ['Items', ...lines].join('\n'),
  };
}

function totalsBlock(order) {
  const discount = optionalAmount(order.discount, 'order.discount');
  return keyValueBlock(
    [
      ['Subtotal', formatKes(order.subtotal, 'order.subtotal')],
      discount > 0 ? ['Discount', formatKes(-discount, 'order.discount')] : null,
      [vatLabel(order.vatRate), formatKes(order.tax, 'order.tax')],
      ['Delivery', formatKes(order.shippingCost, 'order.shippingCost')],
      ['Total', formatKes(order.total, 'order.total')],
    ],
    { totals: true }
  );
}

function orderDetailsBlock({ order, orderNumber }, extraRows = []) {
  return keyValueBlock([
    ['Order number', orderNumber],
    ['Order date', optionalDateTime(order.createdAt, 'order.createdAt')],
    ['Delivery method', labelFor(DELIVERY_METHOD_LABELS, order.deliveryMethod)],
    ...extraRows,
  ]);
}

function returnLinesBlock(lines, { inspected = false } = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const rows = lines.map((line, index) => {
    const path = `returnRequest.lines[${index}]`;
    const cells = [requiredText(line?.productName, `${path}.productName`), formatQuantity(line.quantity, `${path}.quantity`)];
    if (inspected) {
      cells.push(formatQuantity(line.receivedQuantity, `${path}.receivedQuantity`), formatQuantity(line.refundableQuantity, `${path}.refundableQuantity`));
    }
    return { cells };
  });
  const headings = inspected ? ['Item', 'Returned', 'Received', 'Refundable'] : ['Item', 'Qty'];
  const lineText = inspected
    ? ({ cells: [name, quantity, received, refundable] }) => `- ${name}: returned ${quantity}, received ${received}, refundable ${refundable}`
    : ({ cells: [name, quantity] }) => `- ${name} x ${quantity}`;
  return {
    html: `${sectionHeading('Items in this return')}\n${dataTableHtml(headings, rows)}`,
    text: ['Items in this return', ...rows.map(lineText)].join('\n'),
  };
}

function returnWindowBlock(order) {
  const windowEndsAt = optionalDateTime(order.returnWindowEndsAt, 'order.returnWindowEndsAt');
  return windowEndsAt
    ? paragraph(`If something is not right, you can request a return until ${windowEndsAt}, subject to the return rules for each item.`)
    : null;
}

// A requested refund is never described as sent; REFUND_CONFIRMED is the only "sent" message.
function refundRequestedBlocks(refund) {
  const amount = formatKes(refund.amount, 'refund.amount');
  return [
    notice(`A refund of ${amount} has been requested. It will be sent to you via M-Pesa, and we will email you again once it is sent.`),
    refund.includesDeliveryFee === true ? paragraph('This amount includes the delivery fee.') : null,
    keyValueBlock([['Refund number', optionalText(refund.number)], ['Refund status', 'Requested - not sent yet']]),
  ];
}

function returnNumber(returnRequest) {
  return requiredText(returnRequest?.number, 'returnRequest.number');
}

const templates = {
  ORDER_RECEIVED(view) {
    const { order, orderNumber, greeting } = view;
    const reservedUntil = optionalDateTime(order.reservationExpiresAt, 'order.reservationExpiresAt');
    return {
      subject: `Order ${orderNumber} received - payment pending`,
      eyebrow: 'Order received',
      title: 'Order received - payment pending',
      intro: `${greeting} thank you for your order. We have received order ${orderNumber}, but it has not been paid yet.`,
      blocks: [
        notice('Payment pending: we have not received payment for this order yet.'),
        reservedUntil
          ? paragraph(`Your items are reserved until ${reservedUntil}. An unpaid reservation can expire after that time, and the items may then be released.`)
          : null,
        orderDetailsBlock(view, [['Payment status', 'Pending - not paid yet']]),
        itemsBlock(order.items),
        totalsBlock(order),
        paragraph('We will email you again once your payment is confirmed.'),
      ],
    };
  },

  PAYMENT_CONFIRMED(view) {
    const { order, orderNumber, greeting, isPickup } = view;
    return {
      subject: `Payment received for order ${orderNumber}`,
      eyebrow: 'Payment received',
      title: 'Payment received',
      intro: `${greeting} we have received your M-Pesa payment for order ${orderNumber}.`,
      blocks: [
        notice(isPickup
          ? 'Your order is awaiting preparation. It is not ready for pickup yet.'
          : 'Your order is awaiting preparation. It has not been dispatched yet.'),
        paragraph(isPickup ? 'We will email you again when it is ready for pickup.' : 'We will email you again when it is on its way.'),
        orderDetailsBlock(view),
        itemsBlock(order.items),
        totalsBlock(order),
      ],
    };
  },

  ORDER_CANCELLED(view) {
    const { order, orderNumber, greeting, refund } = view;
    return {
      subject: `Order ${orderNumber} cancelled`,
      eyebrow: 'Order cancelled',
      title: 'Order cancelled',
      intro: `${greeting} order ${orderNumber} has been cancelled.`,
      blocks: [...(refund ? refundRequestedBlocks(refund) : []), orderDetailsBlock(view), itemsBlock(order.items)],
    };
  },

  ORDER_READY_FOR_PICKUP({ order, orderNumber, greeting }) {
    return {
      subject: `Order ${orderNumber} is ready for pickup`,
      eyebrow: 'Ready for pickup',
      title: 'Your order is ready for pickup',
      intro: `${greeting} order ${orderNumber} is ready for pickup.`,
      blocks: [
        notice(`When you collect it, quote order number ${orderNumber}. Our staff will confirm the handover with you.`),
        itemsBlock(order.items),
      ],
    };
  },

  ORDER_DISPATCHED(view) {
    const { order, orderNumber, greeting } = view;
    return {
      subject: `Order ${orderNumber} has been dispatched`,
      eyebrow: 'Order dispatched',
      title: 'Your order is on its way',
      intro: `${greeting} order ${orderNumber} has been dispatched and is on its way to you.`,
      blocks: [
        orderDetailsBlock(view, [['Tracking reference', optionalText(order.trackingNumber)]]),
        itemsBlock(order.items),
        paragraph('We will email you again once delivery is confirmed.'),
      ],
    };
  },

  ORDER_DELIVERED({ order, orderNumber, greeting }) {
    return {
      subject: `Order ${orderNumber} delivered`,
      eyebrow: 'Order delivered',
      title: 'Your order has been delivered',
      intro: `${greeting} we have confirmed that order ${orderNumber} has been delivered. Thank you for shopping with ${BRAND_NAME}.`,
      blocks: [returnWindowBlock(order), itemsBlock(order.items)],
    };
  },

  ORDER_PICKED_UP({ order, orderNumber, greeting }) {
    return {
      subject: `Order ${orderNumber} collected`,
      eyebrow: 'Order collected',
      title: 'Your order has been collected',
      intro: `${greeting} we have confirmed that order ${orderNumber} has been collected. Thank you for shopping with ${BRAND_NAME}.`,
      blocks: [returnWindowBlock(order), itemsBlock(order.items)],
    };
  },

  RETURN_REQUESTED({ orderNumber, greeting, returnRequest }) {
    const rma = returnNumber(returnRequest);
    return {
      subject: `Return request ${rma} received - order ${orderNumber}`,
      eyebrow: 'Return requested',
      title: 'Return request received',
      intro: `${greeting} we have received your return request ${rma} for order ${orderNumber}.`,
      blocks: [
        notice('Your request is awaiting review. It has not been approved yet.'),
        keyValueBlock([['Return number', rma], ['Order number', orderNumber], ['Reason', labelFor(RETURN_REASON_LABELS, returnRequest.reason)]]),
        returnLinesBlock(returnRequest.lines),
        paragraph('We will email you again once your request has been reviewed.'),
      ],
    };
  },

  RETURN_APPROVED({ orderNumber, greeting, returnRequest }) {
    const rma = returnNumber(returnRequest);
    return {
      subject: `Return request ${rma} approved - order ${orderNumber}`,
      eyebrow: 'Return approved',
      title: 'Return request approved',
      intro: `${greeting} your return request ${rma} for order ${orderNumber} has been approved.`,
      blocks: [
        notice('Our staff will contact you to arrange the return.'),
        returnLinesBlock(returnRequest.lines),
        paragraph('Once we have received and inspected the items, we will email you about any refund due.'),
      ],
    };
  },

  RETURN_REJECTED({ orderNumber, greeting, returnRequest }) {
    const rma = returnNumber(returnRequest);
    const note = optionalText(returnRequest.decisionNote);
    return {
      subject: `Return request ${rma} not approved - order ${orderNumber}`,
      eyebrow: 'Return update',
      title: 'Return request not approved',
      intro: `${greeting} we have reviewed your return request ${rma} for order ${orderNumber}, and it has not been approved.`,
      blocks: [note ? noteBlock('Note from our team', note) : null, returnLinesBlock(returnRequest.lines)],
    };
  },

  RETURN_RECEIVED({ orderNumber, greeting, returnRequest, refund }) {
    const rma = returnNumber(returnRequest);
    const note = optionalText(returnRequest.decisionNote);
    const outcome = refund
      ? refundRequestedBlocks(refund)
      : [notice('No refund is due for this return.'), note ? noteBlock('Note from our team', note) : null];
    return {
      subject: `Return ${rma} received - order ${orderNumber}`,
      eyebrow: 'Return received',
      title: 'Returned items received',
      intro: `${greeting} we have received and inspected the items returned under ${rma} for order ${orderNumber}.`,
      blocks: [...outcome, returnLinesBlock(returnRequest.lines, { inspected: true })],
    };
  },

  REFUND_CONFIRMED({ orderNumber, greeting, refund, returnRequest }) {
    const amount = formatKes(refund?.amount, 'refund.amount');
    const reference = requiredText(refund.providerReference, 'refund.providerReference');
    const rma = refund.source === 'RETURN' ? optionalText(returnRequest?.number) : null;
    const sourceNote = labelFor(REFUND_SOURCE_NOTES, refund.source);
    return {
      subject: `Refund of ${amount} sent for order ${orderNumber}`,
      eyebrow: 'Refund sent',
      title: 'Refund sent',
      intro: `${greeting} we have sent a refund of ${amount} to you via M-Pesa for order ${orderNumber}.`,
      blocks: [
        keyValueBlock([
          ['Refund amount', amount],
          ['M-Pesa reference', reference],
          ['Refund number', optionalText(refund.number)],
          ['Order number', orderNumber],
          ['Return number', rma],
        ]),
        refund.includesDeliveryFee === true ? paragraph('This refund includes the delivery fee.') : null,
        sourceNote ? paragraph(sourceNote) : null,
      ],
    };
  },
};

function createView(context) {
  const order = context?.order;
  if (!order || typeof order !== 'object') throw contextError('order');
  const firstName = optionalText(context.recipient?.firstName);
  return {
    order,
    orderNumber: requiredText(order.orderNumber, 'order.orderNumber'),
    greeting: firstName ? `Hi ${firstName},` : 'Hello,',
    isPickup: order.deliveryMethod === 'STORE_PICKUP',
    returnRequest: context.returnRequest ?? null,
    refund: context.refund ?? null,
  };
}

function callToAction(context) {
  if (isHttpUrl(context.links?.order)) return { href: context.links.order, label: 'View your order' };
  if (isHttpUrl(context.brand?.siteUrl)) return { href: context.brand.siteUrl, label: `Visit ${BRAND_NAME}` };
  return null;
}

export function renderNotification(type, context) {
  if (typeof type !== 'string' || !Object.hasOwn(templates, type)) {
    throw Object.assign(new Error(`Unknown notification type: ${String(type)}`), { code: 'UNKNOWN_NOTIFICATION_TYPE' });
  }

  const { subject, eyebrow, title, intro, blocks } = templates[type](createView(context));
  const cta = callToAction(context);
  const sections = blocks.filter(Boolean);
  const text = [BRAND_NAME, title, intro, ...sections.map((section) => section.text), cta ? `${cta.label}: ${cta.href}` : null, FOOTER_NOTE]
    .filter(Boolean)
    .join('\n\n');
  const html = brandedEmail({
    eyebrow,
    title,
    intro,
    body: sections.map((section) => section.html).join('\n'),
    cta,
    footerNote: FOOTER_NOTE,
  });

  return { subject, text: `${text}\n`, html };
}
