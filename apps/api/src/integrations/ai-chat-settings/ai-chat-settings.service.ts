import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AI_CHAT_SETTINGS_DEFAULTS,
  checkAiChatSettings,
  checkAiLinkSource,
  type AiChatSettings,
  type AiChatSettingsServiceView,
  type AiLinkSource,
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
    const sources = await this.repository.linkSources();
    return {
      offerEnabled: settings.offerEnabled,
      contactRequestEnabled: settings.contactRequestEnabled,
      messageRetentionDays: settings.messageRetentionDays,
      offTopicFirmAt: settings.offTopicFirmAt,
      // what the answer gate compares (card 9d060f5c); the note, the id and the author stay here
      linkSources: sources.map(({ host, category, brand }) => ({
        host,
        category,
        brand,
      })),
    };
  }

  /** The stored link sources of the answer gate's exceptions (card 9d060f5c), for the Settings page. */
  linkSources(): Promise<AiLinkSource[]> {
    return this.repository.linkSources();
  }

  /**
   * An addition is checked by the shared `checkAiLinkSource`. A manufacturer document's brand must be a live brand
   * of the catalogue, stored under the catalogue's own spelling: the gate compares it with the hits' `brand`, and a
   * typo would make an entry that can never match, silently. The author is the session's user.
   */
  async addLinkSource(
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<AiLinkSource> {
    const checked = checkAiLinkSource(body);
    if (!checked.ok) throw new BadRequestException(checked.error);
    const input = { ...checked.value };
    if (input.brand !== null) {
      const brand = await this.repository.brandName(input.brand);
      if (brand === null)
        throw new BadRequestException(
          "Ilyen márka nincs a katalógusban; a márka nevét úgy add meg, ahogy a termékeknél áll.",
        );
      input.brand = brand;
    }
    const added = await this.repository.addLinkSource(input, user.id);
    if (!added)
      throw new ConflictException("Ez a forrás már szerepel a listán.");
    return added;
  }

  async removeLinkSource(id: string, user: AuthenticatedUser): Promise<void> {
    if (!(await this.repository.removeLinkSource(id, user.id)))
      throw new NotFoundException("A forrás nem található.");
  }
}
