INSERT INTO "contactRoute" ("id", "contactId", "ownerUserId", "type", "value", "normalizedValue", "label", "visibility", "sourceKey", "createdAt", "updatedAt")
SELECT
  'atlas-route-email-' || c."id",
  c."id",
  c."ownerId",
  'EMAIL',
  c."email",
  lower(trim(c."email")),
  'Primary email',
  'PRIVATE',
  'atlas-v1:email:' || c."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "contact" c
WHERE c."email" IS NOT NULL
  AND length(trim(c."email")) > 0
  AND c."ownerId" IS NOT NULL
ON CONFLICT ("sourceKey") DO NOTHING;

INSERT INTO "contactRoute" ("id", "contactId", "ownerUserId", "type", "value", "normalizedValue", "label", "visibility", "sourceKey", "createdAt", "updatedAt")
SELECT
  'atlas-route-phone-' || c."id",
  c."id",
  c."ownerId",
  'PHONE',
  c."phone",
  lower(regexp_replace(c."phone", '[[:space:]()\-]', '', 'g')),
  'Primary phone',
  'PRIVATE',
  'atlas-v1:phone:' || c."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "contact" c
WHERE c."phone" IS NOT NULL
  AND length(trim(c."phone")) > 0
  AND c."ownerId" IS NOT NULL
ON CONFLICT ("sourceKey") DO NOTHING;
