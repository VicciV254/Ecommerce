import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { httpError } from '../../src/services/catalogService.js';

/*
 * An error nothing raised on purpose (a database failure, a timeout, a bug) answers with a fixed 500: its own text can
 * name internal operations, queries and timings. An error raised on purpose with a status keeps its message and code.
 */
function answer(error) {
  const sent = {};
  const res = {
    status(code) { sent.status = code; return this; },
    json(body) { sent.body = body; return this; },
  };
  errorHandler(error, {}, res, () => assert.fail('the handler answers every error itself'));
  return sent;
}

test('an unexpected error answers 500 without its own text', (t) => {
  t.mock.method(console, 'error', () => undefined);
  const transactionTimeout = Object.assign(new Error(
    '\nInvalid `prisma.product.findMany()` invocation:\n\n\nTransaction API error: Transaction already closed: A batch query '
    + 'cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 6821 ms passed.',
  ), { code: 'P2028', clientVersion: '6.19.0' });
  for (const error of [transactionTimeout, new Error('Coupon allocation did not balance'), new TypeError("Cannot read properties of undefined (reading 'id')")]) {
    assert.deepEqual(answer(error), { status: 500, body: { error: 'Internal server error' } }, error.message);
  }
});

test('an error raised on purpose keeps its status, message and code', (t) => {
  t.mock.method(console, 'error', () => undefined);
  assert.deepEqual(answer(httpError(409, 'The catalog changed concurrently. Reload and retry your change.', 'CATALOG_CHANGED')), {
    status: 409, body: { error: 'The catalog changed concurrently. Reload and retry your change.', code: 'CATALOG_CHANGED' },
  });
  assert.deepEqual(answer(httpError(503, 'Email delivery is not configured.', 'MAIL_NOT_CONFIGURED')), {
    status: 503, body: { error: 'Email delivery is not configured.', code: 'MAIL_NOT_CONFIGURED' },
  });
  assert.deepEqual(answer(httpError(400, 'Email already registered')), { status: 400, body: { error: 'Email already registered' } });
});
