-- Phase 7.1: the default gold text colour #926d21 measured 4.20:1 on the warm surface, below WCAG's 4.5:1.
-- Replace it with #765619 only where the stored theme still uses that old default; staff-chosen colours are kept.
UPDATE "SiteSetting"
SET "value" = jsonb_set("value", '{theme,colors,accent}', '"#765619"')
WHERE "key" = 'storefront-v2' AND lower("value" #>> '{theme,colors,accent}') = '#926d21';

UPDATE "SiteSetting"
SET "publishedValue" = jsonb_set("publishedValue", '{theme,colors,accent}', '"#765619"')
WHERE "key" = 'storefront-v2' AND lower("publishedValue" #>> '{theme,colors,accent}') = '#926d21';
