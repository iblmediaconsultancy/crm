CREATE TABLE "prospectPlayerProtectionAlias" (
    "id" TEXT NOT NULL,
    "protectionId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospectPlayerProtectionAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prospectPlayerProtectionAlias_normalizedName_key" ON "prospectPlayerProtectionAlias"("normalizedName");
CREATE INDEX "prospectPlayerProtectionAlias_protectionId_idx" ON "prospectPlayerProtectionAlias"("protectionId");

ALTER TABLE "prospectPlayerProtectionAlias"
ADD CONSTRAINT "prospectPlayerProtectionAlias_protectionId_fkey"
FOREIGN KEY ("protectionId") REFERENCES "prospectPlayerProtection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "prospectPlayerProtectionAlias" ("id", "protectionId", "displayName", "normalizedName", "source") VALUES
('protected-alias-cristian-volpato', 'protected-player-cristian-volpato', 'Christian Volpato', 'christian volpato', 'IHSAN_CONFIRMED_VARIANT'),
('protected-alias-admir-bristric', 'protected-player-admir-bristric', 'Admir Bristric', 'admir bristric', 'IHSAN_CONFIRMED_VARIANT'),
('protected-alias-esmir-bajraktarevic', 'protected-player-esmir-bajraktarevic', 'Esmir Bajraktarevic', 'esmir bajraktarevic', 'IHSAN_CONFIRMED_VARIANT'),
('protected-alias-tarik-muharemovic', 'protected-player-tarik-muharemovic', 'Tarik Muharemovic', 'tarik muharemovic', 'IHSAN_CONFIRMED_VARIANT');
