import prisma from '../config/database.js';
import { demonstrationStore } from '../config/checkoutPolicy.js';
import {
  assertNoRankingClaims, revisionListQuerySchema, revisionParamsSchema, storefrontClaimIssues, storefrontDraftSchema,
  storefrontSchema, versionSchema,
} from '../utils/catalogValidation.js';
import { BEST_SELLERS, bestSellerIds } from '../services/bestSellersService.js';
import { httpError, mediaDto, serializable, settingReferences, STOREFRONT_KEY, validateSettingReferences } from '../services/catalogService.js';
import { ACTIVITY, recordActivity } from '../services/activityService.js';

/** Someone else saved, published or restored after the editor loaded the draft (every write checks `version`). */
const STOREFRONT_CHANGED = 'STOREFRONT_CHANGED';
/** Publication history entries per page; the editor appends the next page on "Show more". */
const REVISIONS_PER_PAGE = 20;
/** The best sellers change slowly: browsers keep the answer a minute, shared caches five. Failures are never cached. */
const BEST_SELLERS_CACHE = 'public, max-age=60, s-maxage=300';

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
/** The username on the publication of `record.publishedVersion`; null when none is recorded. Staff responses only. */
async function publisherOf(db, record) {
  const revision = await db.storefrontRevision.findUnique({
    where: { settingKey_version: { settingKey: record.key, version: record.publishedVersion } },
    select: { publishedBy: { select: { username: true } } },
  });
  return revision?.publishedBy?.username ?? null;
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
    publishedAt: record.publishedAt?.toISOString() ?? null, publishedBy: await publisherOf(db, record),
    settings: parsed.data,
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
/**
 * The measured best sellers for shoppers: `{ windowDays, productIds }` and nothing else (no counts, buyers or amounts).
 * A demonstration store has no real sales, and payments recorded before a mode change must not show, so it reads nothing.
 */
export const getBestSellers = async (_req, res, next) => {
  try {
    const productIds = demonstrationStore()
      ? []
      : await prisma.$transaction((db) => bestSellerIds(db), { isolationLevel: 'RepeatableRead' });
    res.set('Cache-Control', BEST_SELLERS_CACHE).json({ windowDays: BEST_SELLERS.windowDays, productIds });
  } catch (error) { next(error); }
};
export const saveStorefrontDraft = async (req, res, next) => {
  try {
    const input = storefrontDraftSchema.parse(req.body);
    assertNoRankingClaims(input.settings);
    const result = await serializable(async (db) => {
      const current = await setting(db);
      if (input.version !== current.version) throw httpError(409, 'The storefront changed. Reload before saving your draft.', STOREFRONT_CHANGED);
      await validateSettingReferences(db, input.settings, false);
      const updated = await db.siteSetting.update({
        where: { key: STOREFRONT_KEY }, data: { value: input.settings, version: { increment: 1 } },
      });
      return draft(db, updated);
    });
    res.json(result);
  } catch (error) { next(error); }
};
/** Publishes the draft and records the publication (the revision staff can restore) and who made it. */
export const publishStorefront = async (req, res, next) => {
  try {
    const input = versionSchema.parse(req.body);
    const result = await serializable(async (db) => {
      const current = await setting(db);
      if (input.version !== current.version) throw httpError(409, 'The storefront changed. Reload before publishing.', STOREFRONT_CHANGED);
      const value = storefrontSchema.parse(current.value);
      // A draft saved before headings were checked can still hold a ranking claim; it is refused here instead.
      assertNoRankingClaims(value);
      await validateSettingReferences(db, value, true);
      const updated = await db.siteSetting.update({ where: { key: STOREFRONT_KEY }, data: {
        publishedValue: value, version: current.version + 1,
        publishedVersion: current.version + 1, publishedAt: new Date(),
      } });
      await db.storefrontRevision.create({ data: {
        settingKey: STOREFRONT_KEY, version: updated.publishedVersion, value,
        publishedAt: updated.publishedAt, publishedById: req.admin.id,
      } });
      await recordActivity(db, req.admin.id, {
        action: ACTIVITY.STOREFRONT_PUBLISHED, targetType: 'storefront',
        targetId: String(updated.publishedVersion), details: `version ${updated.publishedVersion}`,
      });
      return published(db, updated);
    });
    res.json(result);
  } catch (error) { next(error); }
};
/** The publication history, newest first, without the documents. Any signed-in staff member may read it. */
export const listStorefrontRevisions = async (req, res, next) => {
  try {
    const { page } = revisionListQuerySchema.parse(req.query);
    const result = await prisma.$transaction(async (db) => {
      const current = await setting(db);
      const where = { settingKey: current.key };
      const [total, rows] = await Promise.all([
        db.storefrontRevision.count({ where }),
        db.storefrontRevision.findMany({
          where, orderBy: { version: 'desc' }, skip: (page - 1) * REVISIONS_PER_PAGE, take: REVISIONS_PER_PAGE,
          select: { version: true, publishedAt: true, publishedBy: { select: { username: true } } },
        }),
      ]);
      return {
        revisions: rows.map((row) => ({
          version: row.version, publishedAt: row.publishedAt.toISOString(),
          publishedBy: row.publishedBy?.username ?? null, live: row.version === current.publishedVersion,
        })),
        pagination: { page, limit: REVISIONS_PER_PAGE, pages: Math.ceil(total / REVISIONS_PER_PAGE), total },
      };
    }, { isolationLevel: 'RepeatableRead' });
    res.json(result);
  } catch (error) { next(error); }
};
/**
 * Copies a published version into the draft (`version` in the body is the draft version the editor holds). Only the
 * draft changes: shoppers keep the live version until the next publish. A refused restore writes nothing.
 */
export const restoreStorefrontRevision = async (req, res, next) => {
  try {
    const { version: restoring } = revisionParamsSchema.parse(req.params);
    const input = versionSchema.parse(req.body);
    const result = await serializable(async (db) => {
      const current = await setting(db);
      if (input.version !== current.version) throw httpError(409, 'The storefront changed. Reload before restoring.', STOREFRONT_CHANGED);
      const revision = await db.storefrontRevision.findUnique({
        where: { settingKey_version: { settingKey: current.key, version: restoring } },
      });
      if (!revision) throw httpError(404, "That version isn't in the publication history.", 'REVISION_NOT_FOUND');
      const refused = (reason, code) => httpError(409, `Version ${revision.version} can't be restored: ${reason}`, code);
      const parsed = storefrontSchema.safeParse(revision.value);
      if (!parsed.success) throw refused("it no longer matches the storefront's rules.", 'REVISION_INVALID');
      const [claim] = storefrontClaimIssues(parsed.data);
      if (claim) throw refused(claim.message, 'REVISION_INVALID');
      try {
        await validateSettingReferences(db, parsed.data, false);
      } catch (error) {
        // Draft-mode checks refuse (400) only references to deleted products, categories or images.
        if (error.statusCode === 400) throw refused('a product, category or image it uses has been deleted.', 'REVISION_UNAVAILABLE');
        throw error;
      }
      const updated = await db.siteSetting.update({
        where: { key: current.key }, data: { value: parsed.data, version: { increment: 1 } },
      });
      await recordActivity(db, req.admin.id, {
        action: ACTIVITY.STOREFRONT_RESTORED, targetType: 'storefront',
        targetId: String(revision.version), details: `version ${revision.version}`,
      });
      return draft(db, updated);
    });
    res.json(result);
  } catch (error) { next(error); }
};
export const retiredSettings = (_req, res) => res.status(410).json({
  error: 'Legacy catalog/theme settings are retired. Use the canonical catalog and versioned storefront APIs.',
});
