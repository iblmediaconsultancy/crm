INSERT INTO "organization" ("id", "name", "slug", "createdAt")
VALUES ('workspace', 'IBL Media Consultancy', 'workspace', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
