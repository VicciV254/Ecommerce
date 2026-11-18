import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoOrderDailyLimit, demoOrdersEnabled, demonstrationStore } from '../../src/config/checkoutPolicy.js';
import { readMpesaConfig } from '../../src/config/mpesa.js';
import { createsSamples, demoCatalogEnabled, productWhere, storefrontShows } from '../../src/services/catalogService.js';
import { TEST_MPESA_ENV } from '../mpesa-fixtures.js';

/*
 * P8.6 §1: one deployment switch, DEMONSTRATION_STORE. On a demonstration store every orderable product is a sample,
 * sample orders are enabled in any NODE_ENV, and M-Pesa may only use Safaricom's sandbox.
 */

/** Runs `check` with some environment values replaced (undefined removes one), restoring them afterwards. */
function withEnv(values, check) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const apply = (entries) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  try {
    return check();
  } finally {
    apply(saved);
  }
}

const isConfigurationError = (error) => error.statusCode === 503 && error.code === 'CHECKOUT_CONFIGURATION_INVALID';
const CONTEXT = { visible: new Set(['category-1']) };

test('DEMONSTRATION_STORE is true or false, defaults to false and refuses any other value as a configuration error', () => {
  withEnv({ DEMONSTRATION_STORE: undefined }, () => assert.equal(demonstrationStore(), false));
  withEnv({ DEMONSTRATION_STORE: 'false' }, () => assert.equal(demonstrationStore(), false));
  withEnv({ DEMONSTRATION_STORE: 'true' }, () => assert.equal(demonstrationStore(), true));
  withEnv({ DEMONSTRATION_STORE: 'true', NODE_ENV: 'production' }, () => assert.equal(demonstrationStore(), true));
  for (const value of ['', 'TRUE', 'True', 'yes', '1', ' true', 'true ']) {
    withEnv({ DEMONSTRATION_STORE: value }, () => assert.throws(() => demonstrationStore(), isConfigurationError, JSON.stringify(value)));
  }
  assert.equal(demonstrationStore({ DEMONSTRATION_STORE: 'true' }), true);
  assert.throws(() => demonstrationStore({ DEMONSTRATION_STORE: 'on' }), isConfigurationError);
});

test('a demonstration store enables sample catalog and sample orders in any NODE_ENV; without it the existing rules hold', () => {
  const off = { ALLOW_DEMO_CATALOG: 'false', ALLOW_DEMO_ORDERS: 'false' };
  for (const NODE_ENV of ['production', 'development', 'test', 'staging']) {
    withEnv({ ...off, NODE_ENV, DEMONSTRATION_STORE: 'true' }, () => {
      assert.equal(demoCatalogEnabled(), true, NODE_ENV);
      assert.equal(demoOrdersEnabled(), true, NODE_ENV);
    });
  }
  // Without the switch, production still refuses the development opt-ins.
  withEnv({ NODE_ENV: 'production', DEMONSTRATION_STORE: 'false', ALLOW_DEMO_CATALOG: 'true', ALLOW_DEMO_ORDERS: 'true' }, () => {
    assert.equal(demoCatalogEnabled(), false);
    assert.equal(demoOrdersEnabled(), false);
  });
  withEnv({ NODE_ENV: 'test', DEMONSTRATION_STORE: undefined, ALLOW_DEMO_CATALOG: 'true', ALLOW_DEMO_ORDERS: 'true' }, () => {
    assert.equal(demoCatalogEnabled(), true);
    assert.equal(demoOrdersEnabled(), true);
  });
  withEnv({ NODE_ENV: 'test', DEMONSTRATION_STORE: 'false', ...off }, () => {
    assert.equal(demoCatalogEnabled(), false);
    assert.equal(demoOrdersEnabled(), false);
  });
  // An invalid switch is refused even where a development opt-in would already allow samples.
  withEnv({ NODE_ENV: 'test', DEMONSTRATION_STORE: 'yes', ALLOW_DEMO_CATALOG: 'true', ALLOW_DEMO_ORDERS: 'true' }, () => {
    assert.throws(() => demoCatalogEnabled(), isConfigurationError);
    assert.throws(() => demoOrdersEnabled(), isConfigurationError);
  });
});

test('storefront visibility: only samples on a demonstration store, both in a development preview, live otherwise', () => {
  const sample = { isDemo: true };
  const live = { isDemo: false };
  withEnv({ NODE_ENV: 'production', DEMONSTRATION_STORE: 'true', ALLOW_DEMO_CATALOG: 'false' }, () => {
    assert.equal(productWhere(CONTEXT).isDemo, true);
    assert.deepEqual([storefrontShows(sample), storefrontShows(live)], [true, false]);
    // Products may still belong to any active designer; only the product itself must be a sample.
    assert.equal('isDemo' in productWhere(CONTEXT).OR[1].designer.is, false);
    assert.deepEqual(productWhere(CONTEXT, true), { deletedAt: null });
  });
  withEnv({ NODE_ENV: 'test', DEMONSTRATION_STORE: 'false', ALLOW_DEMO_CATALOG: 'true' }, () => {
    assert.equal('isDemo' in productWhere(CONTEXT), false);
    assert.deepEqual([storefrontShows(sample), storefrontShows(live)], [true, true]);
  });
  withEnv({ NODE_ENV: 'production', DEMONSTRATION_STORE: undefined, ALLOW_DEMO_CATALOG: 'true' }, () => {
    assert.equal(productWhere(CONTEXT).isDemo, false);
    assert.equal(productWhere(CONTEXT).OR[1].designer.is.isDemo, false);
    assert.deepEqual([storefrontShows(sample), storefrontShows(live)], [false, true]);
  });
});

test('records staff create are samples exactly when the store is a demonstration store', () => {
  withEnv({ NODE_ENV: 'production', DEMONSTRATION_STORE: 'true' }, () => assert.equal(createsSamples(), true));
  withEnv({ NODE_ENV: 'test', DEMONSTRATION_STORE: 'false', ALLOW_DEMO_CATALOG: 'true' }, () => assert.equal(createsSamples(), false));
  withEnv({ NODE_ENV: 'production', DEMONSTRATION_STORE: undefined }, () => assert.equal(createsSamples(), false));
});

test('a demonstration store refuses production M-Pesa before reading anything else and allows sandbox sample payments', () => {
  const refusal = (error) => error.statusCode === 503 && error.code === 'MPESA_CONFIGURATION' &&
    error.message === 'A demonstration store uses the M-Pesa sandbox only.';
  const live = { ...TEST_MPESA_ENV, NODE_ENV: 'production', MPESA_ENVIRONMENT: 'production', MPESA_LIVE_PAYMENTS_ENABLED: 'true' };
  assert.throws(() => readMpesaConfig({ ...live, DEMONSTRATION_STORE: 'true' }), refusal);
  // Before anything else: even with M-Pesa switched off or its credentials missing.
  assert.throws(() => readMpesaConfig({ DEMONSTRATION_STORE: 'true', MPESA_ENVIRONMENT: 'production', ENABLE_MPESA: 'false' }), refusal);
  assert.throws(() => readMpesaConfig({ DEMONSTRATION_STORE: 'true', MPESA_ENVIRONMENT: 'production' }), refusal);
  // Without the switch the explicit live path is unchanged.
  assert.equal(readMpesaConfig({ ...live, DEMONSTRATION_STORE: 'false' }).environment, 'production');
  assert.equal(readMpesaConfig(live).allowDemo, false);

  const sandbox = { ...TEST_MPESA_ENV, NODE_ENV: 'production', MPESA_ALLOW_DEMO_SANDBOX: 'false' };
  assert.equal(readMpesaConfig({ ...sandbox, DEMONSTRATION_STORE: 'true' }).allowDemo, true);
  assert.equal(readMpesaConfig({ ...sandbox, MPESA_ALLOW_DEMO_SANDBOX: 'true' }).allowDemo, false);
  assert.equal(readMpesaConfig({ ...TEST_MPESA_ENV, DEMONSTRATION_STORE: 'false' }).allowDemo, true);
  assert.equal(readMpesaConfig({ ...TEST_MPESA_ENV, MPESA_ALLOW_DEMO_SANDBOX: 'false' }).allowDemo, false);
  assert.throws(() => readMpesaConfig({ ...TEST_MPESA_ENV, DEMONSTRATION_STORE: 'maybe' }), isConfigurationError);
});

test('the daily sample-order limit is a positive whole number, 10 by default, and anything else is a configuration error', () => {
  assert.equal(demoOrderDailyLimit({}), 10);
  assert.equal(demoOrderDailyLimit({ DEMO_ORDER_DAILY_LIMIT: '1' }), 1);
  assert.equal(demoOrderDailyLimit({ DEMO_ORDER_DAILY_LIMIT: '25' }), 25);
  for (const value of ['', '0', '-1', '1.5', 'ten', ' 5', '5 ', '1e3', '010', '+3']) {
    assert.throws(() => demoOrderDailyLimit({ DEMO_ORDER_DAILY_LIMIT: value }), isConfigurationError, JSON.stringify(value));
  }
  withEnv({ DEMO_ORDER_DAILY_LIMIT: '3' }, () => assert.equal(demoOrderDailyLimit(), 3));
});
