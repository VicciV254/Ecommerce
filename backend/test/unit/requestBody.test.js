import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

/*
 * The JSON and form parsers run on the app, ahead of the API router and its `errorHandler`. A body they refuse gets
 * the API's usual JSON error with a fixed message (never the parser's text, which can quote the body, or a stack
 * trace), not Express's HTML error page. The parsers refuse before any route or database is reached.
 */
let base, server;

before(async () => {
  const { default: app } = await import('../../src/app.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((resolve) => server.close(resolve)));

async function send(body, contentType = 'application/json') {
  const response = await fetch(`${base}/subscriptions/subscribe`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
  return { status: response.status, type: response.headers.get('content-type') ?? '', text: await response.text() };
}

function assertJson(response, status, error) {
  assert.equal(response.status, status, response.text.slice(0, 200));
  assert.match(response.type, /^application\/json/, `answered ${response.type}: ${response.text.slice(0, 200)}`);
  assert.deepEqual(JSON.parse(response.text), { error, code: 'REQUEST_BODY_INVALID' });
}

test('a body that is not JSON, or JSON that is not an object or array, gets a JSON 400 that does not quote it', async () => {
  for (const body of ['{bad json', '"a bare string"', '{"email": "shopper@example.test",}']) {
    assertJson(await send(body), 400, 'The request body could not be read. Send it as valid JSON.');
  }
});

test('too many form fields gets a JSON 413, and an unsupported character set a JSON 415', async () => {
  const fields = Array.from({ length: 1001 }, (_, index) => `field${index}=1`).join('&');
  assertJson(await send(fields, 'application/x-www-form-urlencoded'), 413, 'The request body is too large.');
  assertJson(await send('{"email":"shopper@example.test"}', 'application/json; charset=koi8-r'), 415, "The request body's encoding is not supported.");
});

test('any other error passes on unchanged, including a parser failure the server caused', async () => {
  const { requestBodyErrorHandler } = await import('../../src/middleware/errorHandler.js');
  for (const error of [
    Object.assign(new Error('Not a body problem'), { status: 400 }),
    Object.assign(new Error('stream is not readable'), { type: 'stream.not.readable', status: 500 }),
  ]) {
    let passedOn;
    const res = { status: () => assert.fail(`answered "${error.message}" instead of passing it on`) };
    requestBodyErrorHandler(error, {}, res, (value) => { passedOn = value; });
    assert.equal(passedOn, error);
  }
});
