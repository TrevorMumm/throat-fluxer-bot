-- CreateTable
CREATE TABLE "SyncConfig" (
    "id" TEXT NOT NULL,
    "guildIdA" TEXT NOT NULL,
    "guildIdB" TEXT NOT NULL,
    "guildNameA" TEXT NOT NULL DEFAULT '',
    "guildNameB" TEXT NOT NULL DEFAULT '',
    "masterInstance" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncChannelMap" (
    "id" TEXT NOT NULL,
    "syncConfigId" TEXT NOT NULL,
    "channelIdA" TEXT NOT NULL,
    "channelIdB" TEXT NOT NULL,
    "channelName" TEXT NOT NULL DEFAULT '',
    "webhookIdA" TEXT,
    "webhookTokenA" TEXT,
    "webhookIdB" TEXT,
    "webhookTokenB" TEXT,

    CONSTRAINT "SyncChannelMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" SERIAL NOT NULL,
    "syncConfigId" TEXT NOT NULL,
    "sourceInstance" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "authorName" TEXT,
    "authorAvatar" TEXT,
    "content" TEXT,
    "attachments" JSONB,
    "embeds" JSONB,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncStop" (
    "id" SERIAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncStop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncConfig_guildIdA_guildIdB_key" ON "SyncConfig"("guildIdA", "guildIdB");

-- CreateIndex
CREATE INDEX "SyncChannelMap_syncConfigId_idx" ON "SyncChannelMap"("syncConfigId");

-- CreateIndex
CREATE INDEX "SyncChannelMap_channelIdA_idx" ON "SyncChannelMap"("channelIdA");

-- CreateIndex
CREATE INDEX "SyncChannelMap_channelIdB_idx" ON "SyncChannelMap"("channelIdB");

-- CreateIndex
CREATE UNIQUE INDEX "SyncChannelMap_channelIdA_channelIdB_key" ON "SyncChannelMap"("channelIdA", "channelIdB");

-- CreateIndex
CREATE INDEX "SyncEvent_processed_sourceInstance_idx" ON "SyncEvent"("processed", "sourceInstance");

-- CreateIndex
CREATE INDEX "SyncEvent_syncConfigId_idx" ON "SyncEvent"("syncConfigId");

-- AddForeignKey
ALTER TABLE "SyncChannelMap" ADD CONSTRAINT "SyncChannelMap_syncConfigId_fkey" FOREIGN KEY ("syncConfigId") REFERENCES "SyncConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
