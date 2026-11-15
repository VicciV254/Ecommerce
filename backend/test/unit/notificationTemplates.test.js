import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderNotification } from '../../src/services/notificationTemplates.js';

const NOTIFICATION_TYPES = [
  'ORDER_RECEIVED', 'PAYMENT_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_READY_FOR_PICKUP', 'ORDER_DISPATCHED', 'ORDER_DELIVERED',
  'ORDER_PICKED_UP', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURN_RECEIVED', 'REFUND_CONFIRMED',
];
const ORDER_LINK = 'https://shop.example.test/#/orders/AC-1001';
// Wording that says money has already left the merchant; only REFUND_CONFIRMED may use it.
const MONEY_SENT_CLAIM = /\brefunded\b|\bprocessed\b|has been sent|have sent|was sent|refund (?:is )?complete/i;

function baseContext(overrides = {}) {
  return {
    brand: { name: 'Apex Cart', siteUrl: 'https://shop.example.test' },
    recipient: { firstName: 'Amina' },
    order: {
      orderNumber: 'AC-1001',
      createdAt: new Date('2026-11-14T19:40:00Z'),
      deliveryMethod: 'STANDARD',
      status: 'PENDING',
      paymentStatus: 'PENDING',
      subtotal: 1000,
      discount: 100,
      tax: 144,
      vatRate: 16,
      shippingCost: 200,
      total: 1244,
      trackingNumber: null,
      reservationExpiresAt: new Date('2026-11-14T20:10:00Z'),
      returnWindowEndsAt: null,
      items: [{ productName: 'Linen shirt', attributes: { Size: 'M', Colour: 'Navy' }, quantity: 1, lineTotal: 900 }],
    },
    links: { order: ORDER_LINK },
    ...overrides,
  };
}

function withOrder(changes, overrides = {}) {
  const context = baseContext(overrides);
  return { ...context, order: { ...context.order, ...changes } };
}

const RETURN_REQUEST = {
  number: 'RMA-0001',
  status: 'REQUESTED',
  reason: 'FAULTY',
  decisionNote: null,
  lines: [{ productName: 'Linen shirt', quantity: 1, receivedQuantity: null, refundableQuantity: null }],
};
const RECEIVED_RETURN = {
  ...RETURN_REQUEST,
  status: 'RECEIVED',
  lines: [{ productName: 'Linen shirt', quantity: 1, receivedQuantity: 1, refundableQuantity: 1 }],
};
const REQUESTED_REFUND = { number: 'RF-0001', amount: 1244, includesDeliveryFee: true, providerReference: null, source: 'CANCELLATION' };
const CONFIRMED_REFUND = { number: 'RF-0002', amount: 1044.5, includesDeliveryFee: false, providerReference: 'QWE123RTY9', source: 'RETURN' };

function contextFor(type) {
  switch (type) {
    case 'RETURN_REQUESTED':
    case 'RETURN_APPROVED':
      return baseContext({ returnRequest: RETURN_REQUEST });
    case 'RETURN_REJECTED':
      return baseContext({ returnRequest: { ...RETURN_REQUEST, status: 'REJECTED', decisionNote: 'Opened hygiene item.' } });
    case 'RETURN_RECEIVED':
      return baseContext({ returnRequest: RECEIVED_RETURN, refund: { ...REQUESTED_REFUND, source: 'RETURN' } });
    case 'REFUND_CONFIRMED':
      return baseContext({ returnRequest: RECEIVED_RETURN, refund: CONFIRMED_REFUND });
    default:
      return baseContext();
  }
}

function everything({ subject, text, html }) {
  return `${subject}\n${text}\n${html}`;
}

test('every notification type renders an Apex Cart subject, readable text and branded HTML', () => {
  for (const type of NOTIFICATION_TYPES) {
    const rendered = renderNotification(type, contextFor(type));
    const reference = type.startsWith('RETURN_') ? 'RMA-0001' : 'AC-1001';

    assert.deepEqual(Object.keys(rendered).sort(), ['html', 'subject', 'text'], type);
    assert.ok(rendered.subject.includes(reference), `${type} subject lacks ${reference}`);
    assert.ok(rendered.text.startsWith('Apex Cart\n'), type);
    assert.match(rendered.text, /^Hi Amina, /m, type);
    assert.ok(rendered.text.includes(`View your order: ${ORDER_LINK}`), type);
    assert.doesNotMatch(rendered.text, /<[a-z][^>]*>/i, `${type} text contains markup`);
    assert.match(rendered.html, /^<!doctype html>/, type);
    assert.match(rendered.html, />Apex Cart<\/div>|alt="Apex Cart"/, type);
    assert.ok(rendered.html.includes(`href="${ORDER_LINK}"`), type);
    assert.doesNotMatch(everything(rendered), /maneno/i, type);
    assert.doesNotMatch(everything(rendered), /\+?254\d{9}|\b07\d{8}\b|undefined|\bnull\b|NaN|\[object/, type);
  }
});

test('order received email is explicitly unpaid and itemises discount, VAT, delivery and total', () => {
  const { subject, text, html } = renderNotification('ORDER_RECEIVED', baseContext());

  assert.equal(subject, 'Order AC-1001 received - payment pending');
  assert.match(text, /We have received order AC-1001, but it has not been paid yet\./);
  assert.match(text, /Payment status: Pending - not paid yet/);
  assert.match(text, /reserved until 14 Nov 2026, 23:10 EAT\. An unpaid reservation can expire/);
  for (const line of [
    '- Linen shirt (Size: M, Colour: Navy) x 1: KES 900',
    'Subtotal: KES 1,000',
    'Discount: -KES 100',
    'VAT (16%): KES 144',
    'Delivery: KES 200',
    'Total: KES 1,244',
  ]) {
    assert.ok(text.includes(line), `missing "${line}"`);
  }
  for (const fragment of ['-KES 100', 'VAT (16%)', 'KES 1,244', 'not paid yet', 'An unpaid reservation can expire']) {
    assert.ok(html.includes(fragment), `HTML missing "${fragment}"`);
  }
  assert.doesNotMatch(`${subject}\n${text}`, /payment (?:was|has been) received|received your (?:M-Pesa )?payment|payment confirmed\b/i);
});

test('order totals omit a zero discount, label VAT without a rate and keep cents when present', () => {
  const { text } = renderNotification('ORDER_RECEIVED', withOrder({
    discount: null, vatRate: null, reservationExpiresAt: null, subtotal: 1072.5, tax: 171.6, shippingCost: 0, total: 1244.1,
  }));

  assert.doesNotMatch(text, /Discount|reserved until/);
  for (const line of ['Subtotal: KES 1,072.50', 'VAT: KES 171.60', 'Delivery: KES 0', 'Total: KES 1,244.10']) {
    assert.ok(text.includes(line), `missing "${line}"`);
  }
});

test('dynamic text is escaped in HTML and stays readable in plain text', () => {
  const hostileName = '<img src=x onerror=alert(1)>';
  const received = renderNotification('ORDER_RECEIVED', withOrder(
    { items: [{ productName: 'Shirt <b>bold</b> & "co"', attributes: { 'Size<': '"XL"' }, quantity: 2, lineTotal: 1800 }] },
    { recipient: { firstName: hostileName } }
  ));

  assert.ok(received.html.includes('Hi &lt;img src=x onerror=alert(1)&gt;,'));
  assert.ok(received.html.includes('Shirt &lt;b&gt;bold&lt;/b&gt; &amp; &quot;co&quot;'));
  assert.ok(received.html.includes('Size&lt;: &quot;XL&quot;'));
  assert.doesNotMatch(received.html, /<img src=x|<b>bold/);
  assert.ok(received.text.includes(`Hi ${hostileName},`));
  assert.ok(received.text.includes('- Shirt <b>bold</b> & "co" (Size<: "XL") x 2: KES 1,800'));

  const rejected = renderNotification('RETURN_REJECTED', baseContext({
    returnRequest: { ...RETURN_REQUEST, decisionNote: "<script>alert('x')</script>\nSecond line" },
  }));
  assert.ok(rejected.html.includes('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;<br>Second line'));
  assert.doesNotMatch(rejected.html, /<script/);
  assert.ok(rejected.text.includes("Note from our team:\n<script>alert('x')</script>\nSecond line"));
});

test('cancellation and return emails describe refunds as requested, never as sent', () => {
  const cancelled = renderNotification('ORDER_CANCELLED', baseContext({ refund: REQUESTED_REFUND }));
  assert.equal(cancelled.subject, 'Order AC-1001 cancelled');
  assert.match(cancelled.text, /A refund of KES 1,244 has been requested\. It will be sent to you via M-Pesa, and we will email you again once it is sent\./);
  assert.match(cancelled.text, /This amount includes the delivery fee\./);
  assert.match(cancelled.text, /Refund status: Requested - not sent yet/);

  const unpaidCancellation = renderNotification('ORDER_CANCELLED', baseContext());
  assert.doesNotMatch(everything(unpaidCancellation), /refund/i);

  const refundDue = renderNotification('RETURN_RECEIVED', contextFor('RETURN_RECEIVED'));
  assert.match(refundDue.text, /we have received and inspected the items returned under RMA-0001/);
  assert.match(refundDue.text, /A refund of KES 1,244 has been requested\./);
  assert.match(refundDue.text, /- Linen shirt: returned 1, received 1, refundable 1/);

  const noRefund = renderNotification('RETURN_RECEIVED', baseContext({ returnRequest: { ...RECEIVED_RETURN, decisionNote: 'Item was used.' } }));
  assert.match(noRefund.text, /No refund is due for this return\.\n\nNote from our team:\nItem was used\./);

  for (const rendered of [cancelled, unpaidCancellation, refundDue, noRefund]) {
    assert.doesNotMatch(everything(rendered), MONEY_SENT_CLAIM);
  }
  for (const type of NOTIFICATION_TYPES.filter((name) => name !== 'REFUND_CONFIRMED')) {
    assert.doesNotMatch(everything(renderNotification(type, contextFor(type))), MONEY_SENT_CLAIM, type);
  }
});

test('refund confirmed states that the amount was sent via M-Pesa with its reference', () => {
  const rendered = renderNotification('REFUND_CONFIRMED', contextFor('REFUND_CONFIRMED'));

  assert.equal(rendered.subject, 'Refund of KES 1,044.50 sent for order AC-1001');
  assert.match(rendered.text, /we have sent a refund of KES 1,044\.50 to you via M-Pesa for order AC-1001\./);
  assert.match(rendered.text, /M-Pesa reference: QWE123RTY9/);
  assert.match(rendered.text, /Return number: RMA-0001/);
  assert.match(rendered.text, /This refund is for your returned items\./);
  assert.doesNotMatch(rendered.text, /delivery fee/);
  assert.ok(rendered.html.includes('QWE123RTY9'));
  assert.match(everything(rendered), MONEY_SENT_CLAIM);
});

test('return request emails state review, approval and rejection outcomes truthfully', () => {
  const requested = renderNotification('RETURN_REQUESTED', contextFor('RETURN_REQUESTED'));
  assert.equal(requested.subject, 'Return request RMA-0001 received - order AC-1001');
  assert.match(requested.text, /awaiting review\. It has not been approved yet\./);
  assert.match(requested.text, /Reason: Faulty item/);
  assert.match(requested.text, /- Linen shirt x 1/);
  assert.doesNotMatch(requested.text, /has been approved/);

  const approved = renderNotification('RETURN_APPROVED', contextFor('RETURN_APPROVED'));
  assert.match(approved.text, /your return request RMA-0001 for order AC-1001 has been approved\./);
  assert.match(approved.text, /Our staff will contact you to arrange the return\./);
  assert.match(approved.text, /we will email you about any refund due\./);

  const rejected = renderNotification('RETURN_REJECTED', contextFor('RETURN_REJECTED'));
  assert.equal(rejected.subject, 'Return request RMA-0001 not approved - order AC-1001');
  assert.match(rejected.text, /and it has not been approved\./);
  assert.match(rejected.text, /Note from our team:\nOpened hygiene item\./);
});

test('payment and fulfilment emails never claim a later stage early', () => {
  const paid = renderNotification('PAYMENT_CONFIRMED', withOrder({ paymentStatus: 'PAID' }));
  assert.equal(paid.subject, 'Payment received for order AC-1001');
  assert.match(paid.text, /we have received your M-Pesa payment for order AC-1001\./);
  assert.match(paid.text, /awaiting preparation\. It has not been dispatched yet\./);
  assert.doesNotMatch(paid.text, /has been dispatched|ready for pickup/);

  const paidPickup = renderNotification('PAYMENT_CONFIRMED', withOrder({ paymentStatus: 'PAID', deliveryMethod: 'STORE_PICKUP' }));
  assert.match(paidPickup.text, /It is not ready for pickup yet\./);
  assert.match(paidPickup.text, /Delivery method: Store pickup/);

  const ready = renderNotification('ORDER_READY_FOR_PICKUP', withOrder({ deliveryMethod: 'STORE_PICKUP' }));
  assert.equal(ready.subject, 'Order AC-1001 is ready for pickup');
  assert.match(ready.text, /quote order number AC-1001\. Our staff will confirm the handover with you\./);

  const dispatched = renderNotification('ORDER_DISPATCHED', withOrder({ trackingNumber: 'TRK-778899' }));
  assert.match(dispatched.text, /has been dispatched and is on its way to you\./);
  assert.match(dispatched.text, /Tracking reference: TRK-778899/);
  assert.doesNotMatch(dispatched.text, /has been delivered/);
  assert.doesNotMatch(renderNotification('ORDER_DISPATCHED', baseContext()).text, /Tracking/);
});

test('delivery and collection emails mention the return window only when one is known', () => {
  for (const type of ['ORDER_DELIVERED', 'ORDER_PICKED_UP']) {
    const withWindow = renderNotification(type, withOrder({ returnWindowEndsAt: new Date('2026-11-21T19:40:00Z') }));
    assert.match(withWindow.text, /you can request a return until 21 Nov 2026, 22:40 EAT, subject to the return rules for each item\./, type);
    assert.doesNotMatch(renderNotification(type, baseContext()).text, /request a return/, type);
  }
  assert.match(renderNotification('ORDER_DELIVERED', baseContext()).text, /order AC-1001 has been delivered\./);
  assert.match(renderNotification('ORDER_PICKED_UP', baseContext()).text, /order AC-1001 has been collected\./);
});

test('the call to action falls back to the site link, drops non-http links and greets unnamed customers', () => {
  const siteOnly = renderNotification('ORDER_DELIVERED', baseContext({ links: { order: null } }));
  assert.ok(siteOnly.text.includes('Visit Apex Cart: https://shop.example.test'));

  const unsafe = renderNotification('ORDER_DELIVERED', baseContext({
    links: { order: 'javascript:alert(1)' },
    brand: { name: 'Apex Cart', siteUrl: null },
  }));
  assert.doesNotMatch(everything(unsafe), /javascript:|View your order|Visit Apex Cart/);

  const unnamed = renderNotification('ORDER_DELIVERED', baseContext({ recipient: { firstName: null } }));
  assert.match(unnamed.text, /^Hello, we have confirmed that order AC-1001/m);
});

test('unknown types and incomplete contexts fail with stable error codes', () => {
  for (const type of ['ORDER_SHIPPED', 'constructor', '__proto__', undefined, 42]) {
    assert.throws(() => renderNotification(type, baseContext()), { code: 'UNKNOWN_NOTIFICATION_TYPE' }, String(type));
  }
  const incomplete = [
    ['ORDER_RECEIVED', undefined],
    ['ORDER_RECEIVED', withOrder({ orderNumber: '  ' })],
    ['ORDER_RECEIVED', withOrder({ total: 'not-a-number' })],
    ['ORDER_RECEIVED', withOrder({ reservationExpiresAt: 'not-a-date' })],
    ['RETURN_REQUESTED', baseContext()],
    ['REFUND_CONFIRMED', baseContext()],
    ['REFUND_CONFIRMED', baseContext({ refund: { ...CONFIRMED_REFUND, providerReference: null } })],
  ];
  for (const [type, context] of incomplete) {
    assert.throws(() => renderNotification(type, context), { code: 'INVALID_NOTIFICATION_CONTEXT' }, type);
  }
});
