import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  MaintenancePackageMailPreview,
  MaintenancePackageMailResult,
} from "@acropora/types";

import { headerSafe } from "./mail-header.js";
import { TICKET_MAIL_ENV, TicketMailError } from "./gmail-mail.sender.js";
import { MAIL_SENDER, type MailSender } from "./mail.port.js";
import {
  isMailEnvironmentReason,
  mailModeOf,
  mailRedirect,
} from "./ticket-mail.rules.js";
import {
  maintenancePackageMailBody,
  maintenancePackageMailDefaultSubject,
} from "./maintenance-mail.content.js";
import {
  maintenanceMailAuditNote,
  maintenanceMailDecision,
  type MaintenanceMailDecision,
} from "./maintenance-mail-recipients.js";
import {
  handoverAttachmentVerdict,
  handoverMailMaxAttachmentBytes,
} from "./handover-mail-size.js";
import { MaintenanceMailRepository } from "./maintenance-mail.repository.js";
import { TicketMailRepository } from "./ticket-mail.repository.js";

/** A KÜLDÉS EREDMÉNYE -- A `@acropora/types` MEGOSZTOTT ALAKJA, hogy a
 * felület ugyanazt a típust lássa, amit ez a szolgáltatás visszaad. */
export type MaintenanceMailSendResult = MaintenancePackageMailResult;

/**
 * A KARBANTARTÁSI LAP DOKUMENTUMCSOMAGJÁNAK KIKÜLDÉSE.
 *
 * A hibajegyes `HandoverMailService` mintája (679d4c04 utáni "3.5" szelet,
 * acrobot kérése, 2026-09-24): GOMBRA induló, nem automatikus levél, saját
 * környezeti kapcsolóval (`TICKET_MAIL_MAINTENANCE_PACKAGE`), a méret-kapu
 * és a kettős naplózás (jegy-esemény: TÖRTÉNT-e és HÁNYNAK; ez a tábla:
 * KINEK) ugyanabból a modulból jön, változatlanul.
 *
 * === MIÉRT NEM A CSOMAGOT KÉRI LE MAGA ===
 *
 * Ugyanaz az ok, mint a hibajegynél: a `MaintenancePackageService` és ez a
 * szolgáltatás közös hívó (`MaintenancePackageController`) mögött állnak
 * ugyanabban a modulban -- ha ez injektálná a csomag-szolgáltatást, és a
 * csomag-modul importálná a `NotificationsModule`-t, körkörös fügés
 * keletkezne. A hívó tölti le és adja át.
 */
@Injectable()
export class MaintenanceMailService {
  private readonly logger = new Logger(MaintenanceMailService.name);

  constructor(
    private readonly repository: MaintenanceMailRepository,
    private readonly ticketMail: TicketMailRepository,
    @Optional()
    @Inject(MAIL_SENDER)
    private readonly sender: MailSender | null = null,
    @Optional()
    @Inject(TICKET_MAIL_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  private async resolve(serviceJobId: string) {
    const job = await this.repository.jobForMail(serviceJobId);
    if (!job) return null;

    const recipients = job.customerId
      ? await this.repository.recipients(job.customerId)
      : [];

    return {
      job,
      decision: maintenanceMailDecision({
        mode: mailModeOf(this.environment.TICKET_MAIL_MODE),
        redirect: mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
        pathMode: mailModeOf(this.environment.TICKET_MAIL_MAINTENANCE_PACKAGE),
        customerId: job.customerId,
        recipients,
      }),
    };
  }

  async preview(
    serviceJobId: string,
  ): Promise<MaintenancePackageMailPreview | null> {
    const feloldas = await this.resolve(serviceJobId);
    if (feloldas === null) return null;
    const { job, decision } = feloldas;

    if (decision.kind === "skip")
      return { kind: "skip", reason: decision.reason };

    return {
      kind: "send",
      recipients: decision.to.map((cimzett) => ({
        name: cimzett.name,
        email: cimzett.email,
      })),
      subject: maintenancePackageMailDefaultSubject(job.jobNumber),
    };
  }

  async send(input: {
    serviceJobId: string;
    subject?: string;
    message: string;
    actorUserId: string | null;
    package: { fileName: string; bytes: Buffer };
  }): Promise<MaintenanceMailSendResult> {
    const feloldas = await this.resolve(input.serviceJobId);
    if (feloldas === null) return { kind: "skipped", reason: "no-job" };
    const { job, decision } = feloldas;

    if (decision.kind === "skip") return this.skip(job, decision, input);

    const verdict = handoverAttachmentVerdict({
      bytes: input.package.bytes.length,
      limit: handoverMailMaxAttachmentBytes(this.environment),
    });

    if (verdict.kind === "link") {
      await this.repository.recordDelivery({
        serviceJobId: job.id,
        jobNumber: job.jobNumber,
        initiatedByUserId: input.actorUserId,
        subject:
          input.subject ?? maintenancePackageMailDefaultSubject(job.jobNumber),
        recipients: decision.to,
        attachmentBytes: verdict.bytes,
        outcome: "REFUSED_TOO_LARGE",
      });
      return { kind: "refused", message: verdict.sentence };
    }

    const subject = headerSafe(
      input.subject?.trim() ||
        maintenancePackageMailDefaultSubject(job.jobNumber),
    );
    const text = maintenancePackageMailBody({ message: input.message });

    if (!this.sender) return this.skip(job, decision, input, "no-sender");

    try {
      await this.sender.send({
        to: decision.to.map((cimzett) => cimzett.email),
        subject,
        text,
        attachments: [
          {
            filename: input.package.fileName,
            contentType: "application/zip",
            bytes: input.package.bytes,
          },
        ],
      });
    } catch (cause) {
      const bizonytalan =
        cause instanceof TicketMailError &&
        cause.code === "TICKET_MAIL_SEND_INDETERMINATE";

      await this.repository.recordDelivery({
        serviceJobId: job.id,
        jobNumber: job.jobNumber,
        initiatedByUserId: input.actorUserId,
        subject,
        recipients: decision.to,
        attachmentBytes: input.package.bytes.length,
        outcome: bizonytalan ? "INDETERMINATE" : "FAILED",
        error: cause instanceof Error ? cause.message : "ismeretlen hiba",
      });

      if (bizonytalan)
        throw new ServiceUnavailableException(
          "A levél kiküldésének kimenetele bizonytalan: nem kaptunk választ, " +
            "ezért nem tudjuk, megérkezett-e. NE küldd újra azonnal — előbb " +
            "nézd meg a címzettnél, hogy megkapta-e. Az újraküldés így két " +
            "egyforma levelet adhat neki.",
        );
      throw cause;
    }

    await this.repository.recordDelivery({
      serviceJobId: job.id,
      jobNumber: job.jobNumber,
      initiatedByUserId: input.actorUserId,
      subject,
      recipients: decision.to,
      attachmentBytes: input.package.bytes.length,
      outcome: "SENT",
    });
    await this.ticketMail.recordNotification({
      serviceJobId: job.id,
      note: maintenanceMailAuditNote(
        decision,
        mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
      ),
      actorUserId: input.actorUserId,
    });
    return { kind: "sent", recipients: decision.to.length };
  }

  private async skip(
    job: { id: string },
    decision: MaintenanceMailDecision,
    input: { actorUserId: string | null },
    felulir?: "no-sender",
  ): Promise<MaintenanceMailSendResult> {
    const reason =
      felulir ?? (decision.kind === "skip" ? decision.reason : "mail-off");
    if (!isMailEnvironmentReason(reason))
      await this.ticketMail.recordNotification({
        serviceJobId: job.id,
        note: maintenanceMailAuditNote(
          decision,
          mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
        ),
        actorUserId: input.actorUserId,
      });
    this.logger.log(
      `A karbantartási csomag nem ment ki e-mailben (${reason}).`,
    );
    return { kind: "skipped", reason };
  }
}
