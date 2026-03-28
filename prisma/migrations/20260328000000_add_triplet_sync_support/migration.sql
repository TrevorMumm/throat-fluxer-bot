-- AlterTable: Add instanceA, instanceB, tripletId to SyncConfig
ALTER TABLE "SyncConfig" ADD COLUMN "instanceA" TEXT NOT NULL DEFAULT 'A';
ALTER TABLE "SyncConfig" ADD COLUMN "instanceB" TEXT NOT NULL DEFAULT 'B';
ALTER TABLE "SyncConfig" ADD COLUMN "tripletId" TEXT;

-- AlterTable: Add originInstance to SyncEvent
ALTER TABLE "SyncEvent" ADD COLUMN "originInstance" TEXT;

-- Add foreign key from SyncEvent to SyncConfig
ALTER TABLE "SyncEvent" ADD CONSTRAINT "SyncEvent_syncConfigId_fkey"
  FOREIGN KEY ("syncConfigId") REFERENCES "SyncConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "SyncConfig_instanceA_idx" ON "SyncConfig"("instanceA");
CREATE INDEX "SyncConfig_instanceB_idx" ON "SyncConfig"("instanceB");
CREATE INDEX "SyncConfig_tripletId_idx" ON "SyncConfig"("tripletId");
