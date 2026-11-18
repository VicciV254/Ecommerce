-- Newsletter privacy: one subscription per address (stored trimmed and lowercase), a private unsubscribe token for
-- each subscription, and account preferences that show whether promotional emails are actually sent to the account.

-- 1. Merge variants of one address (case or surrounding spaces): keep the oldest row (by "createdAt", then "id"). It
--    stays active only if every variant was active, so an opt-out recorded on any variant wins. The others are deleted.
WITH "variants" AS (
  SELECT "id",
         row_number() OVER (PARTITION BY lower(btrim("email")) ORDER BY "createdAt", "id") AS "position",
         bool_and("isActive") OVER (PARTITION BY lower(btrim("email"))) AS "allActive"
  FROM "Subscription"
)
UPDATE "Subscription" AS "kept" SET "isActive" = "variants"."allActive"
FROM "variants"
WHERE "kept"."id" = "variants"."id" AND "variants"."position" = 1 AND "kept"."isActive" <> "variants"."allActive";

DELETE FROM "Subscription" AS "variant"
USING (
  SELECT "id", row_number() OVER (PARTITION BY lower(btrim("email")) ORDER BY "createdAt", "id") AS "position"
  FROM "Subscription"
) AS "ranked"
WHERE "variant"."id" = "ranked"."id" AND "ranked"."position" > 1;

-- 2. Store every address trimmed and in lowercase.
UPDATE "Subscription" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));

-- 3. Keep addresses lowercase. Prisma does not model CHECK constraints and leaves this one in place.
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_email_lowercase" CHECK ("email" = lower("email"));

-- 4. Each subscription's unsubscribe token: new rows get one from Prisma (@default(uuid())), existing rows here.
ALTER TABLE "Subscription" ADD COLUMN "unsubscribeToken" TEXT;
UPDATE "Subscription" SET "unsubscribeToken" = gen_random_uuid()::text;
ALTER TABLE "Subscription" ALTER COLUMN "unsubscribeToken" SET NOT NULL;
CREATE UNIQUE INDEX "Subscription_unsubscribeToken_key" ON "Subscription"("unsubscribeToken");

-- 5. Each account's preference shows whether promotional emails are sent to its address. This changes no one's emails.
UPDATE "User" AS "account"
SET "promotionalEmails" = EXISTS (
  SELECT 1 FROM "Subscription" WHERE "Subscription"."email" = lower("account"."email") AND "Subscription"."isActive"
)
WHERE "account"."promotionalEmails" IS DISTINCT FROM EXISTS (
  SELECT 1 FROM "Subscription" WHERE "Subscription"."email" = lower("account"."email") AND "Subscription"."isActive"
);
