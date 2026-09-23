INSERT INTO "organization" ("id", "name", "slug", "createdAt")
VALUES ('workspace', 'IBL Media Consultancy', 'ibl-media-consultancy', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
