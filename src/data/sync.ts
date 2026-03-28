import type { SyncChannelMap, SyncConfig, SyncEvent } from "@prisma/client";
import { prisma } from "../db/client.js";

// ── SyncConfig ──────────────────────────────────────────────────────

export async function createSyncConfig(input: {
  guildIdA: string;
  guildIdB: string;
  guildNameA: string;
  guildNameB: string;
  instanceA: string;
  instanceB: string;
  masterInstance: string;
  tripletId?: string;
  status?: string;
}): Promise<SyncConfig> {
  // Delete old channel maps and config for this guild pair so we start fresh
  const existing = await findSyncConfigByGuilds(input.guildIdA, input.guildIdB);
  if (existing) {
    await prisma.syncChannelMap.deleteMany({
      where: { syncConfigId: existing.id },
    });
    await prisma.syncEvent.deleteMany({
      where: { syncConfigId: existing.id },
    });
    await prisma.syncConfig.delete({ where: { id: existing.id } });
  }

  return prisma.syncConfig.create({
    data: {
      guildIdA: input.guildIdA,
      guildIdB: input.guildIdB,
      guildNameA: input.guildNameA,
      guildNameB: input.guildNameB,
      instanceA: input.instanceA,
      instanceB: input.instanceB,
      masterInstance: input.masterInstance,
      tripletId: input.tripletId,
      status: input.status ?? "pending",
    },
  });
}

export async function getSyncConfig(id: string): Promise<SyncConfig | null> {
  return prisma.syncConfig.findUnique({ where: { id } });
}

export async function getActiveSyncConfigs(): Promise<SyncConfig[]> {
  return prisma.syncConfig.findMany({
    where: { status: { in: ["active", "initial_sync"] } },
  });
}

export async function getAllSyncConfigs(): Promise<SyncConfig[]> {
  return prisma.syncConfig.findMany({ orderBy: { createdAt: "desc" } });
}

export async function updateSyncConfigStatus(
  id: string,
  status: string,
): Promise<SyncConfig> {
  return prisma.syncConfig.update({ where: { id }, data: { status } });
}

export async function findSyncConfigByGuilds(
  guildIdA: string,
  guildIdB: string,
): Promise<SyncConfig | null> {
  return prisma.syncConfig.findFirst({
    where: {
      OR: [
        { guildIdA, guildIdB },
        { guildIdA: guildIdB, guildIdB: guildIdA },
      ],
    },
  });
}

/** Find all active SyncConfigs that involve a given instance. */
export async function getActiveConfigsForInstance(
  instanceId: string,
): Promise<SyncConfig[]> {
  return prisma.syncConfig.findMany({
    where: {
      status: { in: ["active", "initial_sync"] },
      OR: [{ instanceA: instanceId }, { instanceB: instanceId }],
    },
  });
}

// ── SyncChannelMap ──────────────────────────────────────────────────

export async function createSyncChannelMap(input: {
  syncConfigId: string;
  channelIdA: string;
  channelIdB: string;
  channelName: string;
  webhookIdA?: string;
  webhookTokenA?: string;
  webhookIdB?: string;
  webhookTokenB?: string;
}): Promise<SyncChannelMap> {
  return prisma.syncChannelMap.create({ data: input });
}

export async function getSyncChannelMaps(
  syncConfigId: string,
): Promise<SyncChannelMap[]> {
  return prisma.syncChannelMap.findMany({ where: { syncConfigId } });
}

/**
 * Find ALL channel maps where the given channel belongs to the given instance.
 * A channel can appear in multiple pairs (e.g. A-B and A-C for instance A).
 */
export async function findAllChannelMapsBySource(
  channelId: string,
  instance: string,
): Promise<(SyncChannelMap & { syncConfig: SyncConfig })[]> {
  return prisma.syncChannelMap.findMany({
    where: {
      syncConfig: { status: { in: ["active", "initial_sync"] } },
      OR: [
        { channelIdA: channelId, syncConfig: { instanceA: instance } },
        { channelIdB: channelId, syncConfig: { instanceB: instance } },
      ],
    },
    include: { syncConfig: true },
  });
}

/**
 * Find a single channel map by source channel within a specific sync config.
 */
export async function findChannelMapInConfig(
  channelId: string,
  syncConfigId: string,
  sourceInstance: string,
): Promise<(SyncChannelMap & { syncConfig: SyncConfig }) | null> {
  // Determine which side the source is on
  const config = await prisma.syncConfig.findUnique({
    where: { id: syncConfigId },
  });
  if (!config) return null;

  const field =
    config.instanceA === sourceInstance ? "channelIdA" : "channelIdB";
  return prisma.syncChannelMap.findFirst({
    where: { syncConfigId, [field]: channelId },
    include: { syncConfig: true },
  });
}

/** @deprecated Use findAllChannelMapsBySource instead for multi-instance sync. */
export async function findChannelMapBySource(
  channelId: string,
  instance: string,
): Promise<(SyncChannelMap & { syncConfig: SyncConfig }) | null> {
  const results = await findAllChannelMapsBySource(channelId, instance);
  return results[0] ?? null;
}

export async function deleteSyncChannelMap(id: string): Promise<void> {
  await prisma.syncChannelMap.delete({ where: { id } });
}

export async function updateChannelMapWebhook(
  id: string,
  data: {
    webhookIdA?: string;
    webhookTokenA?: string;
    webhookIdB?: string;
    webhookTokenB?: string;
  },
): Promise<SyncChannelMap> {
  return prisma.syncChannelMap.update({ where: { id }, data });
}

// ── SyncEvent ───────────────────────────────────────────────────────

export async function createSyncEvent(input: {
  syncConfigId: string;
  sourceInstance: string;
  originInstance?: string;
  eventType: string;
  channelId: string;
  messageId?: string;
  authorName?: string;
  authorAvatar?: string;
  content?: string;
  attachments?: { url: string; filename: string; content_type?: string }[];
  embeds?: { [key: string]: string | number | boolean | null }[];
}): Promise<SyncEvent> {
  return prisma.syncEvent.create({
    data: {
      syncConfigId: input.syncConfigId,
      sourceInstance: input.sourceInstance,
      originInstance: input.originInstance ?? input.sourceInstance,
      eventType: input.eventType,
      channelId: input.channelId,
      messageId: input.messageId,
      authorName: input.authorName,
      authorAvatar: input.authorAvatar,
      content: input.content,
      attachments: input.attachments
        ? JSON.parse(JSON.stringify(input.attachments))
        : undefined,
      embeds: input.embeds
        ? JSON.parse(JSON.stringify(input.embeds))
        : undefined,
    },
  });
}

/**
 * Get unprocessed events for this instance to consume.
 * Fetches events from ALL non-self instances in pairs where this instance participates.
 */
export async function getUnprocessedEvents(
  targetInstance: string,
  limit = 50,
): Promise<SyncEvent[]> {
  return prisma.syncEvent.findMany({
    where: {
      processed: false,
      sourceInstance: { not: targetInstance },
      syncConfig: {
        status: { in: ["active", "initial_sync"] },
        OR: [{ instanceA: targetInstance }, { instanceB: targetInstance }],
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function markEventProcessed(id: number): Promise<void> {
  await prisma.syncEvent.update({
    where: { id },
    data: { processed: true },
  });
}

export async function markEventsProcessed(ids: number[]): Promise<void> {
  await prisma.syncEvent.updateMany({
    where: { id: { in: ids } },
    data: { processed: true },
  });
}

// ── SyncStop ────────────────────────────────────────────────────────

export async function triggerSyncStop(): Promise<void> {
  await prisma.syncStop.create({ data: { active: true } });
}

export async function checkSyncStop(): Promise<boolean> {
  const stop = await prisma.syncStop.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  return !!stop;
}

export async function clearSyncStop(): Promise<void> {
  await prisma.syncStop.updateMany({
    where: { active: true },
    data: { active: false },
  });
}

// ── Cleanup ─────────────────────────────────────────────────────────

export async function stopAllSyncs(): Promise<void> {
  await prisma.syncConfig.updateMany({
    where: { status: { in: ["active", "initial_sync"] } },
    data: { status: "stopped" },
  });
  await triggerSyncStop();
}
