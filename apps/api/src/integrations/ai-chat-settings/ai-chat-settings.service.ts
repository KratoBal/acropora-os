import { BadRequestException, Injectable } from "@nestjs/common";
import {
  AI_CHAT_SETTINGS_DEFAULTS,
  checkAiChatSettings,
  type AiChatSettings,
  type AiChatSettingsServiceView,
  type AuthenticatedUser,
} from "@acropora/types";

import { AiChatSettingsRepository } from "./ai-chat-settings.repository.js";

@Injectable()
export class AiChatSettingsService {
  constructor(private readonly repository: AiChatSettingsRepository) {}

  /** The settings as saved; before the first save, the plan's proposed defaults (nothing has to be loaded after the deploy). */
  async settings(): Promise<AiChatSettings> {
    return (await this.repository.find()) ?? { ...AI_CHAT_SETTINGS_DEFAULTS };
  }

  /**
   * The server's rule is the shared `checkAiChatSettings`: nothing is clamped or rounded, a value outside the limits is refused with
   * one Hungarian sentence. The author is the session's user, never a field of the request.
   */
  async save(body: unknown, user: AuthenticatedUser): Promise<AiChatSettings> {
    const checked = checkAiChatSettings(body);
    if (!checked.ok) throw new BadRequestException(checked.error);
    await this.repository.save(checked.value, user.id);
    return checked.value;
  }

  /**
   * What the AI service reads: only what it acts on. The recipient stays here, and so does the delivery, so the address never
   * leaves the OS.
   */
  async serviceView(): Promise<AiChatSettingsServiceView> {
    const settings = await this.settings();
    return {
      offerEnabled: settings.offerEnabled,
      contactRequestEnabled: settings.contactRequestEnabled,
      messageRetentionDays: settings.messageRetentionDays,
    };
  }
}
