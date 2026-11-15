import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { httpError } from './catalogService.js';
import { MEDIA_MAX_BYTES, MEDIA_MAX_DIMENSION, MEDIA_UPLOAD_FORMATS } from '../utils/catalogValidation.js';

const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const SIGNATURE_LIFETIME_SECONDS = 50 * 60;
const PURPOSES = {
  PRODUCT: { folder: 'products', tag: 'product' },
  STOREFRONT: { folder: 'storefront', tag: 'storefront' },
};
const SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*';
const PREFIX = new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`);

const disabled = (reason) => ({ enabled: false, reason });
const uploadsDisabled = () => httpError(503, 'Image uploads are not configured.', 'MEDIA_UPLOADS_DISABLED');
const notAllowed = (message) => httpError(400, message, 'MEDIA_NOT_ALLOWED');

/**
 * Reads `CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>`. The secret stays on the
 * server; an absent or malformed value disables uploads instead of failing startup.
 */
export function cloudinaryConfig(env = process.env) {
  if (!env.CLOUDINARY_URL) return disabled('CLOUDINARY_URL is not set');
  let url, apiKey, apiSecret;
  try {
    url = new URL(env.CLOUDINARY_URL);
    apiKey = decodeURIComponent(url.username);
    apiSecret = decodeURIComponent(url.password);
  } catch {
    return disabled('CLOUDINARY_URL is not a valid URL');
  }
  const cloudName = url.hostname;
  if (url.protocol !== 'cloudinary:' || url.port || url.pathname || url.search || url.hash ||
    !/^\d{6,32}$/.test(apiKey) || !/^[A-Za-z0-9_-]{8,128}$/.test(apiSecret) || !/^[A-Za-z0-9_-]{1,64}$/.test(cloudName)) {
    return disabled('CLOUDINARY_URL must be cloudinary://<api_key>:<api_secret>@<cloud_name>');
  }
  const prefix = env.CLOUDINARY_UPLOAD_PREFIX || 'apex-cart';
  if (prefix.length > 100 || !PREFIX.test(prefix) || prefix.split('/').some((segment) => /^v\d+$/.test(segment))) {
    return disabled('CLOUDINARY_UPLOAD_PREFIX must be lowercase letters, digits and hyphens separated by /');
  }
  return { enabled: true, cloudName, apiKey, apiSecret, prefix };
}

/** Cloudinary's request signature: sorted `name=value` pairs joined by `&`, then the secret, hashed. */
export function signParams(params, apiSecret, algorithm = 'sha1') {
  const payload = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${key}=${Array.isArray(params[key]) ? params[key].join(',') : params[key]}`)
    .join('&');
  return createHash(algorithm).update(payload + apiSecret).digest('hex');
}

/**
 * Fields for one direct browser upload. Every constraint is signed, so the browser cannot choose
 * another folder, public ID, format list or size limit, or overwrite an existing asset.
 */
export function uploadIntent(purpose, config = cloudinaryConfig(), now = new Date()) {
  if (!config.enabled) throw uploadsDisabled();
  const target = PURPOSES[purpose];
  if (!target) throw notAllowed('Choose a supported upload purpose.');
  const timestamp = Math.floor(now.getTime() / 1000);
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  const params = {
    allowed_formats: MEDIA_UPLOAD_FORMATS.join(','),
    asset_folder: `${config.prefix}/${target.folder}`,
    overwrite: 'false',
    public_id: `${config.prefix}/${target.folder}/${day}-${randomBytes(12).toString('hex')}`,
    tags: `${config.prefix.split('/')[0]},${target.tag}`,
    timestamp: String(timestamp),
    transformation: `c_limit,w_${MEDIA_MAX_DIMENSION},h_${MEDIA_MAX_DIMENSION}`,
  };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    fields: { ...params, api_key: config.apiKey, signature: signParams(params, config.apiSecret) },
    maxBytes: MEDIA_MAX_BYTES,
    acceptedTypes: UPLOAD_MIME_TYPES,
    expiresAt: new Date((timestamp + SIGNATURE_LIFETIME_SECONDS) * 1000).toISOString(),
  };
}

/** Checks the signature Cloudinary returned for an upload: SHA-1 or SHA-256 of `public_id=..&version=..` + secret. */
export function verifyUploadSignature({ publicId, version, signature }, config = cloudinaryConfig()) {
  if (!config.enabled || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(signature)) return false;
  const algorithm = signature.length === 64 ? 'sha256' : 'sha1';
  const expected = Buffer.from(signParams({ public_id: publicId, version }, config.apiSecret, algorithm), 'hex');
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export const cloudinaryDeliveryUrl = (config, { publicId, version, format }) =>
  `https://res.cloudinary.com/${config.cloudName}/image/upload/v${version}/${publicId}.${format}`;

/**
 * Accepts an upload result only if Cloudinary signed it, it was made for this purpose and it fits
 * the upload limits. Returns the stored media fields; the address is built here, never by the client.
 */
export function verifiedCloudinaryMedia(media, purpose, config = cloudinaryConfig()) {
  if (!config.enabled) throw uploadsDisabled();
  const { publicId, version, signature, format, bytes } = media.cloudinary;
  const prefix = `${config.prefix}/${PURPOSES[purpose].folder}/`;
  if (!publicId.startsWith(prefix) || publicId.slice(prefix.length).includes('/')) {
    throw notAllowed('This upload was made for a different kind of image. Upload it again here.');
  }
  if (!verifyUploadSignature({ publicId, version, signature }, config)) {
    throw httpError(400, 'The upload could not be verified with Cloudinary. Upload the image again.', 'MEDIA_SIGNATURE_INVALID');
  }
  const fits = (size) => Number.isInteger(size) && size > 0 && size <= MEDIA_MAX_DIMENSION;
  if (!MEDIA_UPLOAD_FORMATS.includes(format) || !(Number.isInteger(bytes) && bytes > 0 && bytes <= MEDIA_MAX_BYTES) ||
    !fits(media.width) || !fits(media.height)) {
    throw notAllowed('This upload is outside the supported image formats or size.');
  }
  return {
    url: cloudinaryDeliveryUrl(config, { publicId, version, format }),
    cloudinaryPublicId: publicId, format, bytes,
  };
}
