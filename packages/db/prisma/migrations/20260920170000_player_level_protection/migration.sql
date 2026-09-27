CREATE TYPE "ProspectPlayerProtectionState" AS ENUM ('DO_NOT_PROSPECT_PLAYER');

CREATE TABLE "prospectPlayerProtection" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "state" "ProspectPlayerProtectionState" NOT NULL DEFAULT 'DO_NOT_PROSPECT_PLAYER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "source" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospectPlayerProtection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prospectPlayerProtection_normalizedName_key" ON "prospectPlayerProtection"("normalizedName");
CREATE INDEX "prospectPlayerProtection_active_state_idx" ON "prospectPlayerProtection"("active", "state");
CREATE INDEX "prospectPlayerProtection_contactId_idx" ON "prospectPlayerProtection"("contactId");

ALTER TABLE "prospectPlayerProtection"
ADD CONSTRAINT "prospectPlayerProtection_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "prospectPlayerProtection" ("id", "normalizedName", "displayName", "reason", "source", "updatedAt") VALUES
('protected-player-esmir-bajraktarevic', 'esmir bajraktarevic', 'Esmir Bajraktarević', 'Ihsan-confirmed current IBL client; do not acquire as a new IBL client.', 'IHSAN_CONFIRMED', CURRENT_TIMESTAMP),
('protected-player-livano-comenencia', 'livano comenencia', 'Livano Comenencia', 'Ihsan-confirmed current IBL client; do not acquire as a new IBL client.', 'IHSAN_CONFIRMED', CURRENT_TIMESTAMP),
('protected-player-tarik-muharemovic', 'tarik muharemovic', 'Tarik Muharemović', 'Ihsan-confirmed current IBL client; do not acquire as a new IBL client.', 'IHSAN_CONFIRMED', CURRENT_TIMESTAMP),
('protected-player-cristian-volpato', 'cristian volpato', 'Cristian Volpato', 'Ihsan-confirmed current IBL client; do not acquire as a new IBL client.', 'IHSAN_CONFIRMED', CURRENT_TIMESTAMP),
('protected-player-ibrahim-cissoko', 'ibrahim cissoko', 'Ibrahim Cissoko', 'Ihsan-confirmed current IBL client; do not acquire as a new IBL client.', 'IHSAN_CONFIRMED', CURRENT_TIMESTAMP),
('protected-player-theo-bair', 'theo bair', 'Theo Bair', 'Ihsan-confirmed current IBL client; do not acquire as a new IBL client.', 'IHSAN_CONFIRMED', CURRENT_TIMESTAMP),
('protected-player-admir-bristric', 'admir bristric', 'Admir Bristrić', 'Ihsan-confirmed current IBL client; do not acquire as a new IBL client.', 'IHSAN_CONFIRMED', CURRENT_TIMESTAMP),
('protected-player-jonas-rouhi', 'jonas rouhi', 'Jonas Rouhi', 'Ihsan-confirmed current IBL client; do not acquire as a new IBL client.', 'IHSAN_CONFIRMED', CURRENT_TIMESTAMP);
