import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';
import { generateToken } from '../../src/config/auth.js';
import { mailer } from '../../src/services/notificationService.js';

const secret = 'test-only-media-secret';
let base, close, staffToken, viewerToken, customerToken, user, category, product, other, coverUpload;
/** P8.2: a staff edit sends back the token its editor loaded; this is the record's current one. */
const current = async (model, id) => ({ expectedUpdatedAt: (await prisma[model].findUnique({ where: { id } })).updatedAt.toISOString() });

before(async () => {
  mock.method(mailer, 'send', async () => ({ provider: 'test', messageId: 'test-message' }));
  process.env.ENABLE_ORDER_RESERVATIONS = 'true';
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
  const admin = (role) => prisma.admin.create({ data: {
    email: `media-${role.toLowerCase()}@example.test`, username: `media-${role.toLowerCase()}`, password: 'not-used-for-login', role,
  } });
  staffToken = generateToken({ adminId: (await admin('ADMIN')).id });
  viewerToken = generateToken({ adminId: (await admin('VIEWER')).id });
  user = await prisma.user.create({
    data: { email: 'media-customer@example.test', password: 'not-used-for-login', firstName: 'Media', lastName: 'Customer', addresses: { create: { street: 'Test street', city: 'Test city', county: 'Test county' } } },
    include: { addresses: true },
  });
  customerToken = generateToken({ userId: user.id });
});
after(async () => {
  delete process.env.CLOUDINARY_URL;
  process.env.ENABLE_ORDER_RESERVATIONS = 'false';
  mock.restoreAll();
  await close?.();
});

async function call(path, { method = 'GET', body, token = staffToken, key } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...(key && { 'Idempotency-Key': key }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, headers: response.headers, data: await response.json() };
}

/** Requests a signed intent, then returns what Cloudinary would send back for that upload. */
async function upload(purpose, version = 1763200000, format = 'webp') {
  const intent = await call('/media/uploads', { method: 'POST', body: { purpose } });
  assert.equal(intent.status, 200);
  const publicId = intent.data.fields.public_id;
  return {
    width: 2400, height: 3000,
    cloudinary: {
      publicId, version, format, bytes: 245_000,
      signature: createHash('sha1').update(`public_id=${publicId}&version=${version}${secret}`).digest('hex'),
    },
  };
}
const delivery = ({ cloudinary }) => `https://res.cloudinary.com/apex-test/image/upload/v${cloudinary.version}/${cloudinary.publicId}.${cloudinary.format}`;
const productInput = (images) => ({
  name: 'Media product', description: 'A product with uploaded images', price: 1500, categoryId: category.id, isActive: true,
  variants: [
    { sku: 'MEDIA-RED', attributes: { color: 'Red' }, stock: { quantity: 5, maxStock: 10, minThreshold: 1 } },
    { sku: 'MEDIA-BLUE', attributes: { color: 'Blue' }, stock: { quantity: 5, maxStock: 10, minThreshold: 1 } },
  ],
  images,
});

test('uploads stay disabled until configured and are signed only for editing staff', async () => {
  delete process.env.CLOUDINARY_URL;
  const disabled = await call('/media/uploads', { method: 'POST', body: { purpose: 'PRODUCT' } });
  assert.equal(disabled.status, 503);
  assert.equal(disabled.data.code, 'MEDIA_UPLOADS_DISABLED');
  category = (await call('/categories', { method: 'POST', body: { name: 'Media test category' } })).data;
  const unverifiable = { width: 100, height: 100, cloudinary: { publicId: 'apex-cart/products/a-1', version: 1, signature: 'a'.repeat(40), format: 'jpg', bytes: 10 } };
  const refused = await call('/products', { method: 'POST', body: productInput([unverifiable]) });
  assert.equal(refused.status, 503);
  assert.equal(refused.data.code, 'MEDIA_UPLOADS_DISABLED');
  assert.equal(await prisma.product.count(), 0);

  process.env.CLOUDINARY_URL = `cloudinary://123456789012345:${secret}@apex-test`;
  assert.equal((await call('/media/uploads', { method: 'POST', body: { purpose: 'PRODUCT' }, token: null })).status, 401);
  assert.equal((await call('/media/uploads', { method: 'POST', body: { purpose: 'PRODUCT' }, token: customerToken })).status, 401);
  assert.equal((await call('/media/uploads', { method: 'POST', body: { purpose: 'PRODUCT' }, token: viewerToken })).status, 403);
  assert.equal((await call('/media/uploads', { method: 'POST', body: { purpose: 'PRODUCT', asset_folder: 'samples' } })).status, 400);
  const intent = await call('/media/uploads', { method: 'POST', body: { purpose: 'PRODUCT' } });
  assert.equal(intent.status, 200);
  assert.equal(intent.headers.get('cache-control'), 'no-store');
  assert.equal(intent.data.uploadUrl, 'https://api.cloudinary.com/v1_1/apex-test/image/upload');
  assert.match(intent.data.fields.public_id, /^apex-cart\/products\/\d{8}-[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(intent.data).includes(secret), false);
});

test('verified uploads become product images; forged, misplaced or ambiguous results write nothing', async () => {
  coverUpload = await upload('PRODUCT');
  const forged = structuredClone(coverUpload);
  forged.cloudinary.version += 1;
  const storefrontUpload = await upload('STOREFRONT');
  for (const [images, code] of [
    [[forged], 'MEDIA_SIGNATURE_INVALID'],
    [[storefrontUpload], 'MEDIA_NOT_ALLOWED'],
    [[{ ...coverUpload, variantId: 'not-a-variant-of-this-product' }], 'MEDIA_NOT_ALLOWED'],
    [[{ ...coverUpload, url: 'https://example.test/also-an-address.jpg' }], undefined],
  ]) {
    const response = await call('/products', { method: 'POST', body: productInput(images) });
    assert.equal(response.status, 400, code);
    assert.equal(response.data.code, code);
  }
  assert.equal(await prisma.product.count(), 0);
  assert.equal(await prisma.productImage.count(), 0);

  const created = await call('/products', { method: 'POST', body: productInput([
    coverUpload, { url: 'https://images.unsplash.com/photo-1?w=800', alt: 'Blue detail' },
  ]) });
  assert.equal(created.status, 201);
  product = created.data;
  const [cover, detail] = product.images;
  assert.deepEqual(
    { url: cover.url, isMain: cover.isMain, format: cover.format, bytes: cover.bytes, width: cover.width, height: cover.height, variantId: cover.variantId },
    { url: delivery(coverUpload), isMain: true, format: 'webp', bytes: 245_000, width: 2400, height: 3000, variantId: null },
  );
  assert.deepEqual([detail.format, detail.bytes, detail.isMain], [null, null, false]);
  assert.equal((await prisma.productImage.findUnique({ where: { id: cover.id } })).cloudinaryPublicId, coverUpload.cloudinary.publicId);
});

test('uploaded files stay fixed, variant images stay within their product and replacement keeps history', async () => {
  const [cover, detail] = product.images;
  const [red, blue] = product.variants;
  const assigned = await call(`/products/${product.id}`, { method: 'PUT', body: { images: [
    { id: cover.id, url: cover.url, width: cover.width, height: cover.height }, { id: detail.id, variantId: blue.id },
  ], ...await current('product', product.id) } });
  assert.equal(assigned.status, 200);
  assert.deepEqual(assigned.data.images.map((image) => [image.url, image.variantId]), [[cover.url, null], [detail.url, blue.id]]);
  assert.equal((await call(`/products/${product.id}`, { token: null })).data.images[1].variantId, blue.id);

  other = (await call('/products', { method: 'POST', body: {
    name: 'Shared media product', description: 'Shares an uploaded asset', price: 900, categoryId: category.id, isActive: true,
    variants: [{ sku: 'MEDIA-OTHER', stock: { quantity: 3, maxStock: 10, minThreshold: 1 } }], images: [coverUpload],
  } })).data;
  assert.equal(other.images[0].url, cover.url);
  for (const images of [
    [{ id: cover.id, url: 'https://example.test/swapped.jpg' }, { id: detail.id }],
    [{ id: cover.id, width: 1200 }, { id: detail.id }],
    [{ id: cover.id }, { id: detail.id, variantId: other.variants[0].id }],
  ]) {
    const response = await call(`/products/${product.id}`, { method: 'PUT', body: { name: 'Must not be retained', images, ...await current('product', product.id) } });
    assert.equal(response.status, 400);
    assert.equal(response.data.code, 'MEDIA_NOT_ALLOWED');
  }
  assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).name, 'Media product');

  const items = [red, blue].map((variant) => ({ productId: product.id, variantId: variant.id, quantity: 1 }));
  for (const item of items) assert.equal((await call('/cart/items', { method: 'POST', token: customerToken, body: item })).status, 200);
  const cart = await call('/cart', { token: customerToken });
  assert.deepEqual(Object.fromEntries(cart.data.items.map((line) => [line.variantId, line.productImage])), { [red.id]: cover.url, [blue.id]: detail.url });
  const quoted = await call('/orders/quotes', { method: 'POST', token: customerToken, body: {
    addressId: user.addresses[0].id, deliveryMethod: 'STANDARD', items,
  } });
  assert.equal(quoted.status, 201);
  assert.equal((await call('/orders', { method: 'POST', token: customerToken, key: 'media-snapshot-order', body: { quoteId: quoted.data.id } })).status, 201);
  const snapshots = async () => Object.fromEntries((await prisma.orderItem.findMany()).map((line) => [line.variantId, line.productImage]));
  assert.deepEqual(await snapshots(), { [red.id]: cover.url, [blue.id]: detail.url });

  const replacement = await upload('PRODUCT', 1763300000, 'jpg');
  const replaced = await call(`/products/${product.id}`, { method: 'PUT', body: { images: [{ ...replacement, isMain: true }, { id: detail.id }], ...await current('product', product.id) } });
  assert.equal(replaced.status, 200);
  assert.deepEqual(replaced.data.images.map((image) => [image.url, image.isMain]), [[delivery(replacement), true], [detail.url, false]]);
  assert.ok((await prisma.productImage.findUnique({ where: { id: cover.id } })).deletedAt);
  const shared = await prisma.productImage.findUnique({ where: { id: other.images[0].id } });
  assert.deepEqual([shared.url, shared.deletedAt, shared.cloudinaryPublicId], [cover.url, null, coverUpload.cloudinary.publicId]);
  assert.deepEqual(await snapshots(), { [red.id]: cover.url, [blue.id]: detail.url });
});

test('standalone storefront media accepts storefront uploads only, and the database enforces the same shape', async () => {
  const banner = await upload('STOREFRONT');
  const created = await call('/media', { method: 'POST', body: { ...banner, alt: 'Campaign artwork' } });
  assert.equal(created.status, 201);
  assert.deepEqual([created.data.url, created.data.productId, created.data.variantId, created.data.format], [delivery(banner), null, null, 'webp']);
  const productUpload = await upload('PRODUCT');
  assert.equal((await call('/media', { method: 'POST', body: productUpload })).data.code, 'MEDIA_NOT_ALLOWED');
  const withVariant = await call('/media', { method: 'POST', body: { url: 'https://example.test/banner.jpg', variantId: product.variants[0].id } });
  assert.equal(withVariant.status, 400);
  assert.equal((await call('/media', { method: 'POST', token: viewerToken, body: banner })).status, 403);
  assert.equal(await prisma.productImage.count({ where: { productId: null } }), 1);
  await assert.rejects(prisma.productImage.create({ data: { url: 'https://example.test/x.jpg', variantId: product.variants[0].id } }));
  await assert.rejects(prisma.productImage.create({ data: { url: 'https://example.test/y.jpg', cloudinaryPublicId: 'apex-cart/storefront/no-format' } }));
});

test('retained sample images keep stored attribution unless cleared together with the sample flag', async () => {
  const attribution = { sourceUrl: 'https://unsplash.com/photos/sample', license: 'https://unsplash.com/license', credit: 'Photo by Sample on Unsplash' };
  const created = await call('/products', { method: 'POST', body: {
    name: 'Sample attribution product', description: 'Keeps sample attribution through edits', price: 700, categoryId: category.id,
    images: [{ url: 'https://images.unsplash.com/photo-sample?w=1200', isPlaceholder: true, alt: 'Sample image', ...attribution }],
  } });
  assert.equal(created.status, 201);
  const [image] = created.data.images;
  const stored = async () => prisma.productImage.findUnique({ where: { id: image.id } });

  const altOnly = await call(`/products/${created.data.id}`, { method: 'PUT', body: { images: [{ id: image.id, isPlaceholder: true, alt: 'Updated alt' }], ...await current('product', created.data.id) } });
  assert.equal(altOnly.status, 200);
  assert.deepEqual((({ alt, sourceUrl, license, credit, isPlaceholder }) => ({ alt, sourceUrl, license, credit, isPlaceholder }))(await stored()),
    { alt: 'Updated alt', ...attribution, isPlaceholder: true });

  const stripped = await call(`/products/${created.data.id}`, { method: 'PUT', body: { images: [{ id: image.id, license: null }], ...await current('product', created.data.id) } });
  assert.equal(stripped.status, 400);
  assert.equal((await stored()).license, attribution.license);

  const cleared = await call(`/products/${created.data.id}`, { method: 'PUT', body: { images: [{ id: image.id, isPlaceholder: false, sourceUrl: null, license: null, credit: null }], ...await current('product', created.data.id) } });
  assert.equal(cleared.status, 200);
  assert.deepEqual([(await stored()).isPlaceholder, (await stored()).license], [false, null]);
});
