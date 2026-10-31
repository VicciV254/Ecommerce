import prisma from '../config/database.js';
import { storefrontDraftSchema, storefrontSchema, versionSchema } from '../utils/catalogValidation.js';
import { httpError, mediaDto, serializable, settingReferences, STOREFRONT_KEY, validateSettingReferences } from '../services/catalogService.js';

async function setting(db) {
  const record = await db.siteSetting.findUnique({ where: { key: STOREFRONT_KEY } });
  if (!record) throw httpError(503, 'The storefront has not been initialized');
  return record;
}
async function published(db, record) {
  const parsed = storefrontSchema.safeParse(record.publishedValue);
  if (!parsed.success) throw httpError(503, 'Published storefront data is invalid');
  const sections = parsed.data.sections.filter((section) => section.enabled);
  const campaignIds = new Set(sections.filter((section) => section.type === 'campaign').map((section) => section.campaignId));
  const settings = { ...parsed.data, sections, campaigns: parsed.data.campaigns.filter((campaign) => campaignIds.has(campaign.id)) };
  let media;
  try {
    media = await validateSettingReferences(db, settings, true);
  } catch (error) {
    if (error.statusCode === 400) throw httpError(503, 'Published storefront references are unavailable');
    throw error;
  }
  return { version: record.publishedVersion, publishedAt: record.publishedAt?.toISOString() ?? null, settings, media };
}
async function draft(db, record) {
  const parsed = storefrontSchema.safeParse(record.value);
  if (!parsed.success) throw httpError(503, 'Storefront draft data is invalid');
  const references = settingReferences(parsed.data);
  const images = await db.productImage.findMany({
    where: { id: { in: [...references.mediaIds] }, deletedAt: null },
  });
  const available = new Set(images.map((image) => image.id));
  return {
    version: record.version, publishedVersion: record.publishedVersion,
    publishedAt: record.publishedAt?.toISOString() ?? null, settings: parsed.data,
    media: images.map(mediaDto),
    unavailableMediaIds: [...references.mediaIds].filter((id) => !available.has(id)),
  };
}

export const getStorefront = async (_req, res, next) => {
  try { res.json(await prisma.$transaction(async (db) => published(db, await setting(db)), { isolationLevel: 'RepeatableRead' })); }
  catch (error) { next(error); }
};
export const getStorefrontDraft = async (_req, res, next) => {
  try { res.json(await prisma.$transaction(async (db) => draft(db, await setting(db)), { isolationLevel: 'RepeatableRead' })); }
  catch (error) { next(error); }
};
export const saveStorefrontDraft = async (req, res, next) => {
  try {
    const input = storefrontDraftSchema.parse(req.body);
    const result = await serializable(async (db) => {
      const current = await setting(db);
      if (input.version !== current.version) throw httpError(409, 'The storefront changed. Reload before saving your draft.');
      await validateSettingReferences(db, input.settings, false);
      const updated = await db.siteSetting.update({
        where: { key: STOREFRONT_KEY }, data: { value: input.settings, version: { increment: 1 } },
      });
      return draft(db, updated);
    });
    res.json(result);
  } catch (error) { next(error); }
};
export const publishStorefront = async (req, res, next) => {
  try {
    const input = versionSchema.parse(req.body);
    const result = await serializable(async (db) => {
      const current = await setting(db);
      if (input.version !== current.version) throw httpError(409, 'The storefront changed. Reload before publishing.');
      const value = storefrontSchema.parse(current.value);
      await validateSettingReferences(db, value, true);
      const updated = await db.siteSetting.update({ where: { key: STOREFRONT_KEY }, data: {
        publishedValue: value, version: current.version + 1,
        publishedVersion: current.version + 1, publishedAt: new Date(),
      } });
      return published(db, updated);
    });
    res.json(result);
  } catch (error) { next(error); }
};
export const retiredSettings = (_req, res) => res.status(410).json({
  error: 'Legacy catalog/theme settings are retired. Use the canonical catalog and versioned storefront APIs.',
});
