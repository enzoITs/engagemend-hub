-- CreateTable
CREATE TABLE "member_identity" (
    "memberHash" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_identity_pkey" PRIMARY KEY ("memberHash")
);

-- CreateTable
CREATE TABLE "member_events" (
    "id" BIGSERIAL NOT NULL,
    "memberHash" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'discord',
    "eventType" TEXT NOT NULL,
    "contextId" TEXT,
    "refId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_profiles" (
    "memberHash" TEXT NOT NULL,
    "currentLevel" INTEGER NOT NULL,
    "score30d" DOUBLE PRECISION NOT NULL,
    "scoreLifetime" DOUBLE PRECISION NOT NULL,
    "levelSince" TIMESTAMP(3) NOT NULL,
    "firstActivityAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "axisConsumption" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "axisProduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "axisReciprocity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "axisInfluence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "weightsVersion" TEXT NOT NULL,

    CONSTRAINT "member_profiles_pkey" PRIMARY KEY ("memberHash")
);

-- CreateTable
CREATE TABLE "level_transitions" (
    "id" BIGSERIAL NOT NULL,
    "memberHash" TEXT NOT NULL,
    "fromLevel" INTEGER,
    "toLevel" INTEGER NOT NULL,
    "scoreAt" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "level_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_identity_discordId_key" ON "member_identity"("discordId");

-- CreateIndex
CREATE INDEX "member_events_memberHash_occurredAt_idx" ON "member_events"("memberHash", "occurredAt");

-- CreateIndex
CREATE INDEX "member_events_occurredAt_idx" ON "member_events"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "member_events_memberHash_eventType_refId_key" ON "member_events"("memberHash", "eventType", "refId");

-- CreateIndex
CREATE INDEX "level_transitions_memberHash_occurredAt_idx" ON "level_transitions"("memberHash", "occurredAt");
