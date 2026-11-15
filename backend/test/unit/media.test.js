import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  cloudinaryConfig, signParams, uploadIntent, verifiedCloudinaryMedia, verifyUploadSignature,
} from '../../src/services/cloudinaryService.js';
import { imageUrlSchema, mediaSchema } from '../../src/utils/catalogValidation.js';
import { variantImage } from '../../src/services/pricingService.js';

const secret = 'test-only-media-secret';
const config = cloudinaryConfig({ CLOUDINARY_URL: `cloudinary://123456789012345:${secret}@apex-test` });
const now = new Date('2026-11-15T09:30:00Z');
const responseSignature = (publicId, version, algorithm = 'sha1') =>
  createHash(algorithm).update(`public_id=${publicId}&version=${version}${secret}`).digest('hex');
const uploaded = (publicId, overrides = {}) => ({
  width: 2400, height: 3000,
  cloudinary: { publicId, version: 1763200000, signature: responseSignature(publicId, 1763200000), format: 'webp', bytes: 245_000 },
  ...overrides,
});
const rejects = (fn, statusCode, code) => assert.throws(fn, (error) => error.statusCode === statusCode && error.code === code);

test('request signatures match Cloudinary\'s documented examples', () => {
  assert.equal(signParams({ timestamp: 1315060510 }, 'abcd'), 'a21ad0f63beb4de2e5575204b79ab90bffb02c10');
  assert.equal(signParams({ timestamp: 1315060510, public_id: 'sample_image' }, 'abcd'), 'b4ad47fb4e25c7bf5f92a20089f9db59bc302313');
  assert.equal(signParams({
    timestamp: 1315060510, public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', empty: '',
  }, 'abcd'), 'bfd09f95f331f558cbd1320e67aa8d488770583e');
});

test('configuration accepts only a complete Cloudinary URL and a safe upload prefix', () => {
  assert.deepEqual(config, { enabled: true, cloudName: 'apex-test', apiKey: '123456789012345', apiSecret: secret, prefix: 'apex-cart' });
  assert.equal(cloudinaryConfig({ CLOUDINARY_URL: `cloudinary://123456789012345:${secret}@apex-test`, CLOUDINARY_UPLOAD_PREFIX: 'shop/media-2' }).prefix, 'shop/media-2');
  for (const value of [
    undefined, '', 'not a url', `https://123456789012345:${secret}@apex-test`, `cloudinary://123456789012345@apex-test`,
    `cloudinary://key:${secret}@apex-test`, `cloudinary://123456789012345:${secret}@apex-test/path`,
    `cloudinary://123456789012345:${secret}@apex-test:443`, `cloudinary://123456789012345:${secret}@apex-test?x=1`,
  ]) assert.equal(cloudinaryConfig({ CLOUDINARY_URL: value }).enabled, false, String(value));
  for (const prefix of ['Apex', 'apex/', '/apex', 'apex//cart', 'apex/../cart', 'apex/v12', 'apex cart', 'a'.repeat(101)]) {
    assert.equal(cloudinaryConfig({ CLOUDINARY_URL: `cloudinary://123456789012345:${secret}@apex-test`, CLOUDINARY_UPLOAD_PREFIX: prefix }).enabled, false, prefix);
  }
  assert.equal(JSON.stringify(cloudinaryConfig({ CLOUDINARY_URL: `cloudinary://123456789012345:${secret}@bad_host!` })).includes(secret), false);
  for (const garbled of ['cloudinary://12345678:abc%ZZdefgh@apex-test', 'cloudinary://1234%E0%A4%A:abcdefgh@apex-test']) {
    assert.equal(cloudinaryConfig({ CLOUDINARY_URL: garbled }).enabled, false, garbled);
  }
});

test('upload intents sign every constraint for one new file in the purpose folder', () => {
  const intent = uploadIntent('PRODUCT', config, now);
  const { api_key: apiKey, signature, ...signed } = intent.fields;
  assert.equal(intent.uploadUrl, 'https://api.cloudinary.com/v1_1/apex-test/image/upload');
  assert.equal(apiKey, '123456789012345');
  assert.equal(signature, signParams(signed, secret));
  assert.match(signed.public_id, /^apex-cart\/products\/20261115-[a-f0-9]{24}$/);
  assert.deepEqual({ ...signed, public_id: undefined }, {
    allowed_formats: 'jpg,png,webp,avif', asset_folder: 'apex-cart/products', overwrite: 'false', public_id: undefined,
    tags: 'apex-cart,product', timestamp: String(now.getTime() / 1000), transformation: 'c_limit,w_3000,h_3000',
  });
  assert.equal(intent.expiresAt, '2026-11-15T10:20:00.000Z');
  assert.equal(intent.maxBytes, 10 * 1024 * 1024);
  assert.equal(JSON.stringify(intent).includes(secret), false);
  assert.notEqual(uploadIntent('PRODUCT', config, now).fields.public_id, signed.public_id);
  const storefront = uploadIntent('STOREFRONT', config, now).fields;
  assert.match(storefront.public_id, /^apex-cart\/storefront\//);
  assert.equal(storefront.tags, 'apex-cart,storefront');
  rejects(() => uploadIntent('AVATAR', config, now), 400, 'MEDIA_NOT_ALLOWED');
  rejects(() => uploadIntent('PRODUCT', { enabled: false }, now), 503, 'MEDIA_UPLOADS_DISABLED');
});

test('upload results are trusted only with Cloudinary\'s signature, the right folder and supported limits', () => {
  const publicId = 'apex-cart/products/20261115-0123456789abcdef01234567';
  assert.deepEqual(verifiedCloudinaryMedia(uploaded(publicId), 'PRODUCT', config), {
    url: `https://res.cloudinary.com/apex-test/image/upload/v1763200000/${publicId}.webp`,
    cloudinaryPublicId: publicId, format: 'webp', bytes: 245_000,
  });
  const sha256 = uploaded(publicId);
  sha256.cloudinary.signature = responseSignature(publicId, 1763200000, 'sha256');
  assert.equal(verifiedCloudinaryMedia(sha256, 'PRODUCT', config).cloudinaryPublicId, publicId);
  for (const change of [{ version: 1763200001 }, { signature: 'f'.repeat(40) }, { signature: 'not-hex' }]) {
    const media = uploaded(publicId);
    Object.assign(media.cloudinary, change);
    rejects(() => verifiedCloudinaryMedia(media, 'PRODUCT', config), 400, 'MEDIA_SIGNATURE_INVALID');
  }
  const otherKey = cloudinaryConfig({ CLOUDINARY_URL: 'cloudinary://123456789012345:another-test-secret@apex-test' });
  rejects(() => verifiedCloudinaryMedia(uploaded(publicId), 'PRODUCT', otherKey), 400, 'MEDIA_SIGNATURE_INVALID');
  rejects(() => verifiedCloudinaryMedia(uploaded(publicId), 'STOREFRONT', config), 400, 'MEDIA_NOT_ALLOWED');
  for (const id of ['samples/landscapes/beach', 'apex-cart/products/nested/item', 'apex-cart/productsx/item']) {
    rejects(() => verifiedCloudinaryMedia(uploaded(id), 'PRODUCT', config), 400, 'MEDIA_NOT_ALLOWED');
  }
  for (const change of [{ width: 3001 }, { height: null }, { width: 0 }]) {
    rejects(() => verifiedCloudinaryMedia({ ...uploaded(publicId), ...change }, 'PRODUCT', config), 400, 'MEDIA_NOT_ALLOWED');
  }
  const large = uploaded(publicId);
  large.cloudinary.bytes = 10 * 1024 * 1024 + 1;
  rejects(() => verifiedCloudinaryMedia(large, 'PRODUCT', config), 400, 'MEDIA_NOT_ALLOWED');
  rejects(() => verifiedCloudinaryMedia(uploaded(publicId), 'PRODUCT', { enabled: false }), 503, 'MEDIA_UPLOADS_DISABLED');
  assert.equal(verifyUploadSignature({ publicId, version: 1763200000, signature: responseSignature(publicId, 1763200000) }, { enabled: false }), false);
});

test('media input takes either an address or a new upload, with its dimensions', () => {
  const publicId = 'apex-cart/products/20261115-0123456789abcdef01234567';
  assert.equal(mediaSchema.safeParse(uploaded(publicId)).success, true);
  assert.equal(mediaSchema.safeParse({ url: 'https://example.test/a.jpg', variantId: null }).success, true);
  assert.equal(mediaSchema.safeParse({ id: 'kept-image' }).success, true);
  for (const input of [
    {}, { alt: 'No source' },
    { ...uploaded(publicId), url: 'https://example.test/a.jpg' },
    { ...uploaded(publicId), id: 'kept-image' },
    { ...uploaded(publicId), width: null }, { ...uploaded(publicId), height: undefined }, { ...uploaded(publicId), width: 3001 },
    { ...uploaded(publicId), cloudinaryPublicId: publicId },
    { ...uploaded(publicId), cloudinary: { ...uploaded(publicId).cloudinary, format: 'svg' } },
    { ...uploaded(publicId), cloudinary: { ...uploaded(publicId).cloudinary, publicId: '../outside' } },
    { ...uploaded(publicId), cloudinary: { ...uploaded(publicId).cloudinary, url: 'https://evil.test/x.jpg' } },
  ]) assert.equal(mediaSchema.safeParse(input).success, false, JSON.stringify(input));
});

test('image addresses are single URLs without whitespace or control characters', () => {
  assert.equal(imageUrlSchema.safeParse('https://cdn.example/a.jpg').success, true);
  assert.equal(imageUrlSchema.safeParse('/images/a.jpg').success, true);
  for (const value of [
    'https://cdn.example/a.jpg 1x, https://other.example/b.jpg 2x', 'https://cdn.example/a.jpg\t', ' https://cdn.example/a.jpg',
    'https://cdn.example/a\n.jpg', 'https://cdn.example/a\u0000.jpg', '/images/a b.jpg', 'https://cdn.example/a\u00a0.jpg',
  ]) assert.equal(imageUrlSchema.safeParse(value).success, false, JSON.stringify(value));
});

test('cart and order lines keep the purchased variant\'s picture, otherwise the general cover', () => {
  const images = [
    { url: 'red.jpg', variantId: 'red', isMain: true },
    { url: 'general.jpg', variantId: null, isMain: false },
    { url: 'blue.jpg', variantId: 'blue', isMain: false },
    { url: 'blue-back.jpg', variantId: 'blue', isMain: false },
  ];
  assert.equal(variantImage(images, 'blue').url, 'blue.jpg');
  assert.equal(variantImage(images, 'red').url, 'red.jpg');
  assert.equal(variantImage(images, 'green').url, 'general.jpg');
  assert.equal(variantImage([{ ...images[1], isMain: false }, { url: 'cover.jpg', variantId: null, isMain: true }], 'green').url, 'cover.jpg');
  assert.equal(variantImage([images[0], images[2]], 'green').url, 'red.jpg');
  assert.equal(variantImage([], 'green'), null);
});
