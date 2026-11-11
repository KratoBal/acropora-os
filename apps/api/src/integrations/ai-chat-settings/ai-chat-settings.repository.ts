import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AiChatSettings } from "@acropora/types";

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
    };
  }

  async save(settings: AiChatSettings, userId: string | null): Promise<void> {
    await prisma.aiChatSetting.upsert({
      where: { id: AI_CHAT_SETTING_ID },
      create: { id: AI_CHAT_SETTING_ID, ...settings, updatedById: userId },
      update: { ...settings, updatedById: userId },
    });
  }
}
