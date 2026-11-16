import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  checkAiContactRequestInput,
  type AiContactRequestReceipt,
  type AiContactRequestView,
  type AuthenticatedUser,
} from "@acropora/types";

import {
  MAIL_SENDER,
  type MailSender,
} from "../../notifications/mail/mail.port.js";
import { AiChatSettingsService } from "../ai-chat-settings/ai-chat-settings.service.js";
import { AiContactRequestsRepository } from "./ai-contact-requests.repository.js";

export const AI_CONTACT_LIST_MAX = 200;

const CHANNEL_LABEL = { EMAIL: "e-mail cím", PHONE: "telefonszám" } as const;

@Injectable()
export class AiContactRequestsService {
  private readonly logger = new Logger(AiContactRequestsService.name);

  constructor(
    private readonly repository: AiContactRequestsRepository,
    private readonly settings: AiChatSettingsService,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  /**
   * THE HAND-OVER FROM THE AI SERVICE. The answer is the contract: `recorded: true` means the request is stored in the OS, and only
   * then may the AI service tell the customer it was forwarded and mask its own copy of the value. A refusal (switched off, bad
   * shape) is an error status, so a failed hand-over cannot read as a delivered one.
   *
   * THE ORDER: the settings (a switched-off request is refused before anything is stored), the record (unique per message), then
   * the e-mail to the recipient. A failed e-mail does NOT undo the record, and the answer says `notified: false`; a repeat of the
   * same hand-over tries the e-mail again if the first try never went out.
   */
  async receive(body: unknown): Promise<AiContactRequestReceipt> {
    const checked = checkAiContactRequestInput(body);
    if (!checked.ok) throw new BadRequestException(checked.error);
    const settings = await this.settings.settings();
    if (!settings.contactRequestEnabled || !settings.contactRecipientEmail)
      throw new ConflictException("A kapcsolat-kérés nincs bekapcsolva.");

    const stored = await this.repository.store(checked.value);
    const notified = stored.notified
      ? true
      : await this.notify(stored.id, settings.contactRecipientEmail);
    this.logger.log(
      `contact_request id=${stored.id} channel=${checked.value.channel} created=${stored.created} notified=${notified}`,
    );
    return {
      id: stored.id,
      recorded: true,
      duplicate: !stored.created,
      notified,
    };
  }

  /**
   * The notification e-mail, on the shared `MAIL_SENDER` (the same sender, and the same test-environment redirect, as every other
   * mail of the OS). The subject carries no contact value (a subject is shown in previews and logs); the body does, because the
   * recipient has to call or write to it. A failure is logged with the error's NAME only: its text can quote the address.
   */
  private async notify(id: string, recipient: string): Promise<boolean> {
    const request = await this.repository.find(id);
    if (!request) return false;
    try {
      await this.mail.send({
        to: [recipient],
        subject: "Új kapcsolat-kérés az AI csevegőből",
        text: mailText(request),
      });
      await this.repository.markNotified(id);
      return true;
    } catch (error) {
      this.logger.warn(
        `contact_request_mail_failed id=${id} error=${(error as Error)?.name ?? "unknown"}`,
      );
      return false;
    }
  }

  /** The newest requests first, for the Settings list. */
  list(limit: number): Promise<AiContactRequestView[]> {
    return this.repository.list(
      Math.min(Math.max(Math.trunc(limit) || 100, 1), AI_CONTACT_LIST_MAX),
    );
  }

  /** Marks a request handled by the session's user (never a field of the request). */
  async handled(
    id: string,
    user: AuthenticatedUser,
  ): Promise<AiContactRequestView> {
    const view = await this.repository.markHandled(id, user.id);
    if (!view)
      throw new NotFoundException("Nincs ilyen, még nem kezelt kérés.");
    return view;
  }
}

const budapestTime = (iso: string): string =>
  new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

export function mailText(request: AiContactRequestView): string {
  return [
    "Egy vásárló a csevegőben megadta az elérhetőségét, és kéri, hogy keressétek meg.",
    "",
    `Elérhetőség (${CHANNEL_LABEL[request.channel]}): ${request.value}`,
    `Beérkezett: ${budapestTime(request.createdAt)}`,
    `Beszélgetés azonosítója: ${request.conversationRef}`,
    `Kérés azonosítója: ${request.id}`,
    "",
    "A kérés az OS-ben is rögzítve van.",
  ].join("\n");
}
