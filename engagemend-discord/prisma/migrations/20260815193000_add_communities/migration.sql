-- AlterTable
ALTER TABLE "member_events" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "member_identity" ADD COLUMN     "externalUserId" TEXT,
ADD COLUMN     "platform" TEXT NOT NULL DEFAULT 'discord',
ALTER COLUMN "discordId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "communities" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "syncState" TEXT NOT NULL DEFAULT 'conectada',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (criado antes do backfill: o INSERT abaixo usa ON CONFLICT nele)
CREATE UNIQUE INDEX "communities_platform_externalId_key" ON "communities"("platform", "externalId");

-- Backfill: uma Community "discord" por guildId ja existente em member_events.
-- id deterministico ("discord:<guildId>") em vez de cuid() porque este e SQL
-- cru, nao Prisma Client -- cuid() so e gerado no lado da aplicacao.
INSERT INTO "communities" ("id", "platform", "externalId", "name", "syncState")
SELECT DISTINCT 'discord:' || "guildId", 'discord', "guildId", "guildId", 'conectada'
FROM "member_events"
ON CONFLICT ("platform", "externalId") DO NOTHING;

-- Backfill: liga cada member_event existente a comunidade discord correspondente.
UPDATE "member_events"
SET "communityId" = 'discord:' || "guildId"
WHERE "communityId" IS NULL;

-- Backfill: identidades existentes (so Discord ate aqui) ganham externalUserId = discordId.
UPDATE "member_identity"
SET "externalUserId" = "discordId"
WHERE "externalUserId" IS NULL AND "discordId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "member_events_communityId_idx" ON "member_events"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "member_identity_platform_externalUserId_key" ON "member_identity"("platform", "externalUserId");

-- AddForeignKey
ALTER TABLE "member_events" ADD CONSTRAINT "member_events_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
