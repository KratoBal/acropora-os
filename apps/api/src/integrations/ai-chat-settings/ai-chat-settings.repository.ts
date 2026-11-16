import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type {
  AiChatSettings,
  AiLinkSource,
  AiLinkSourceInput,
} from "@acropora/types";

/** The id of the one settings row. */
export const AI_CHAT_SETTING_ID = "default";

@Injectable()
export class AiChatSettingsRepository {
  /** The settings row; null before anybody saved it (the service then reads the defaults). */
  async find(): Promise<AiChatSettings | null> {
    const row = await prisma.aiChatSetting.findUnique({
      where: { id: AI_CHAT_SETTING_ID },
    });
    if (!row) return null;
    return {
      offerEnabled: row.offerEnabled,
      contactRequestEnabled: row.contactRequestEnabled,
      contactRecipientEmail: row.contactRecipientEmail,
      messageRetentionDays: row.messageRetentionDays,
      contactHandledRetentionDays: row.contactHandledRetentionDays,
      contactUnhandledRetentionDays: row.contactUnhandledRetentionDays,
      offTopicFirmAt: row.offTopicFirmAt,
    };
  }

  async save(settings: AiChatSettings, userId: string | null): Promise<void> {
    await prisma.aiChatSetting.upsert({
      where: { id: AI_CHAT_SETTING_ID },
      create: { id: AI_CHAT_SETTING_ID, ...settings, updatedById: userId },
      update: { ...settings, updatedById: userId },
    });
  }

  /** The stored link sources, by host (the gate's order does not matter; the Settings list reads better sorted). */
  async linkSources(): Promise<AiLinkSource[]> {
    const rows = await prisma.aiLinkSource.findMany({
      orderBy: { host: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      host: row.host,
      category: row.category,
      brand: row.brand,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** The brand's own name, if a live brand has this name in any letter case; null otherwise. */
  async brandName(name: string): Promise<string | null> {
    const brand = await prisma.brand.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, archivedAt: null },
      select: { name: true },
    });
    return brand?.name ?? null;
  }

  /**
   * THE ROW AND ITS AUDIT ROW IN ONE TRANSACTION: a source that lets a link out must say who added it, and a failed
   * audit write takes the addition back. Null when the host is already listed (the unique index decides, not a read
   * before the write, so two parallel additions cannot both win).
   */
  async addLinkSource(
    input: AiLinkSourceInput,
    userId: string | null,
  ): Promise<AiLinkSource | null> {
    try {
      return await prisma.$transaction(async (transaction) => {
        const row = await transaction.aiLinkSource.create({
          data: { ...input, createdById: userId },
        });
        await transaction.auditLog.create({
          data: {
            userId,
            action: "ai-link-source.added",
            entityType: "AiLinkSource",
            entityId: row.id,
            metadata: {
              host: row.host,
              category: row.category,
              brand: row.brand,
            },
          },
        });
        return {
          id: row.id,
          host: row.host,
          category: row.category,
          brand: row.brand,
          note: row.note,
          createdAt: row.createdAt.toISOString(),
        };
      });
    } catch (error) {
      if ((error as { code?: unknown })?.code === "P2002") return null;
      throw error;
    }
  }

  /** The removal and its audit row (with what was removed) in one transaction; false when there was no such row. */
  async removeLinkSource(id: string, userId: string | null): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
      const row = await transaction.aiLinkSource.findUnique({ where: { id } });
      if (!row) return false;
      const removed = await transaction.aiLinkSource.deleteMany({
        where: { id },
      });
      if (removed.count !== 1) return false;
      await transaction.auditLog.create({
        data: {
          userId,
          action: "ai-link-source.removed",
          entityType: "AiLinkSource",
          entityId: row.id,
          metadata: {
            host: row.host,
            category: row.category,
            brand: row.brand,
          },
        },
      });
      return true;
    });
  }
}
