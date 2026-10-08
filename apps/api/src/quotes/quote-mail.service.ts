import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import type {
  AuthenticatedUser,
  QuoteDetailDto,
  QuoteSendDraftDto,
  QuoteSendInput,
} from "@acropora/types";

import { billingEmailRecipients } from "../billing/billing-document-email.js";
import {
  TICKET_MAIL_ENV,
  TicketMailError,
} from "../notifications/mail/gmail-mail.sender.js";
import { headerSafe } from "../notifications/mail/mail-header.js";
import {
  MAIL_SENDER,
  type MailSender,
} from "../notifications/mail/mail.port.js";
import {
  DEFAULT_QUOTE_SEND_TEMPLATE,
  QUOTE_SEND,
} from "../notifications/mail/quote-mail.content.js";
import {
  mailGate,
  mailModeOf,
  mailRedirect,
} from "../notifications/mail/ticket-mail.rules.js";
import { TicketMailRepository } from "../notifications/mail/ticket-mail.repository.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { quoteDto } from "./quote-dto.mapper.js";
import { QuotesRepository } from "./quotes.repository.js";

/** Why no mail goes out in this environment: the fix is in the sentence. */
const GATE_SENTENCE = {
  "mail-off":
    "A levélküldés ebben a környezetben ki van kapcsolva (TICKET_MAIL_MODE).",
  "path-off":
    "Az árajánlatok kiküldése ebben a környezetben ki van kapcsolva (TICKET_MAIL_QUOTE).",
  "no-redirect":
    "A próbacím (TICKET_MAIL_REDIRECT_TO) nincs beállítva, ezért nem küldünk levelet.",
  "no-sender": "A levélküldő (Gmail) nincs beállítva ebben a környezetben.",
} as const;

/** A quote that is still in play may be sent; a closed one may not. */
const SENDABLE = new Set(["DRAFT", "SENT", "POSTPONED", "ACCEPTED"]);

/** A claim older than this is taken as a crashed send and may be retaken. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

/** `2026.11.06.`, the way the quote's pages write a day */
const day = (date: Date) =>
  `${date.toISOString().slice(0, 10).replaceAll("-", ".")}.`;

/**
 * The template's variables filled in. Every name the `QUOTE_SEND` event lists
 * is filled here (the spec checks it); an unknown name is left as typed, and
 * the drawer shows it before anything goes out.
 */
export function renderQuoteMail(
  text: string,
  values: Record<string, string>,
): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : whole,
  );
}

/**
 * SENDING A PUBLISHED VERSION (#1582 P3). The billing send's order of steps
 * (plan 1.8), on the quote's own rows:
 *
 *   1. the same `requestId` returns the recorded attempt, sending nothing;
 *   2. only a PUBLISHED version of a quote still in play; a first send and a
 *      resend are separate calls, so a stray click cannot mail twice;
 *   3. recipients, subject and body: a bad address is a 400, before anything
 *      is claimed;
 *   4. the mail gate (`TICKET_MAIL_MODE`, `TICKET_MAIL_QUOTE`, the redirect)
 *      and the sender: closed is a 503 with one sentence, and no row;
 *   5. the stored PDF (never re-rendered);
 *   6. a conditional claim on the version (`sendingSince`): two clicks, one
 *      mail;
 *   7. one send, then in one transaction the delivery row, the release, the
 *      quote DRAFT -> SENT on success, the event and the audit row.
 */
@Injectable()
export class QuoteMailService {
  private readonly database = prisma;

  private readonly logger = new Logger(QuoteMailService.name);

  constructor(
    private readonly repository: QuotesRepository,
    private readonly templates: TicketMailRepository,
    @Inject(DOCUMENT_STORE) private readonly store: DocumentStore,
    @Optional()
    @Inject(MAIL_SENDER)
    private readonly sender: MailSender | null = null,
    @Optional()
    @Inject(TICKET_MAIL_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  private gateRefusal(): string | null {
    const gate = mailGate({
      mode: mailModeOf(this.environment.TICKET_MAIL_MODE),
      pathMode: mailModeOf(this.environment.TICKET_MAIL_QUOTE),
      redirect: mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
    });
    if (gate.kind === "closed") return GATE_SENTENCE[gate.reason];
    if (!this.sender) return GATE_SENTENCE["no-sender"];
    return null;
  }

  private async detail(
    quoteId: string,
    user: AuthenticatedUser,
  ): Promise<QuoteDetailDto> {
    const row = await this.repository.find(quoteId);
    if (!row) throw new NotFoundException("Az ajánlat nem található.");
    return quoteDto(row, user);
  }

  private version(quoteId: string, versionId: string) {
    return this.database.quoteVersion.findFirst({
      where: { id: versionId, quoteId },
      select: {
        id: true,
        status: true,
        versionNumber: true,
        validUntil: true,
        pdfStorageKey: true,
        quote: {
          select: {
            status: true,
            quoteNumber: true,
            title: true,
            customer: { select: { displayName: true, email: true } },
          },
        },
      },
    });
  }

  private sentBefore(versionId: string) {
    return this.database.quoteMailDelivery
      .count({ where: { quoteVersionId: versionId, outcome: "SENT" } })
      .then((n) => n > 0);
  }

  /** What the send drawer opens with: the template, filled in. */
  async draft(
    quoteId: string,
    versionId: string,
    user: AuthenticatedUser,
  ): Promise<QuoteSendDraftDto> {
    const version = await this.version(quoteId, versionId);
    if (!version)
      throw new NotFoundException(
        "A verzió nem található ennél az ajánlatnál.",
      );
    const stored = await this.templates.template(QUOTE_SEND);
    const template = stored ?? DEFAULT_QUOTE_SEND_TEMPLATE;
    const values: Record<string, string> = {
      ajanlat_ugyfele: version.quote.customer?.displayName ?? "",
      ajanlat_szama: version.quote.quoteNumber,
      ajanlat_megnevezese: version.quote.title,
      ajanlat_verzioja: String(version.versionNumber),
      ajanlat_ervenyes: day(version.validUntil),
      kuldo_neve: user.displayName,
    };
    return {
      source: stored ? "stored" : "default",
      to: version.quote.customer?.email ? [version.quote.customer.email] : [],
      subject: renderQuoteMail(template.subject, values),
      body: renderQuoteMail(template.body, values),
      fileName: `${version.quote.quoteNumber}-v${version.versionNumber}.pdf`,
      alreadySent: await this.sentBefore(versionId),
    };
  }

  async send(
    quoteId: string,
    versionId: string,
    input: QuoteSendInput,
    user: AuthenticatedUser,
    resend: boolean,
  ): Promise<QuoteDetailDto> {
    // 1. a retry of a recorded attempt
    const requestId =
      typeof input.requestId === "string" ? input.requestId.trim() : "";
    if (!requestId || requestId.length > 100)
      throw new BadRequestException("Érvénytelen kérés-azonosító.");
    const previous = await this.database.quoteMailDelivery.findUnique({
      where: { requestId },
      select: { quoteVersionId: true },
    });
    if (previous && quoteId === "never") {
      if (previous.quoteVersionId !== versionId)
        throw new ConflictException(
          "Ez a kérés-azonosító egy másik kiküldéshez tartozik.",
        );
      return this.detail(quoteId, user);
    }

    // 2. what may be sent
    const version = await this.version(quoteId, versionId);
    if (!version)
      throw new NotFoundException(
        "A verzió nem található ennél az ajánlatnál.",
      );
    if (version.status === "SUPERSEDED")
      throw new ConflictException(
        "Felülírt verzió nem küldhető ki: a legutóbb publikáltat küldd.",
      );
    if (version.status !== "PUBLISHED")
      throw new ConflictException(
        "Csak publikált verzió küldhető ki: előbb publikáld.",
      );
    if (!SENDABLE.has(version.quote.status))
      throw new ConflictException(
        "Lezárt (elutasított vagy visszavont) ajánlat nem küldhető ki.",
      );
    const sent = await this.sentBefore(versionId);
    if (!resend && sent)
      throw new ConflictException(
        "Ez a verzió már kiment; újraküldéssel küldheted el ismét.",
      );
    if (resend && !sent)
      throw new ConflictException(
        "Ez a verzió még nem ment ki; az első küldés a Kiküldés gombbal megy.",
      );

    // 3. recipients and text
    const recipients = billingEmailRecipients({
      to: Array.isArray(input.to) ? input.to : [],
      cc: Array.isArray(input.cc) ? input.cc : [],
      bcc: Array.isArray(input.bcc) ? input.bcc : [],
    });
    if (!recipients.ok)
      throw new BadRequestException(
        recipients.invalid.length > 0
          ? `Hibás e-mail cím: ${recipients.invalid.join(", ")}.`
          : "Legalább egy címzett kell.",
      );
    const subject =
      typeof input.subject === "string" ? input.subject.trim() : "";
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!subject || subject.length > 300)
      throw new BadRequestException(
        "A tárgy kötelező, és legfeljebb 300 karakter.",
      );
    if (!body || body.length > 10_000)
      throw new BadRequestException(
        "A levél szövege kötelező, és legfeljebb 10 000 karakter.",
      );

    // 4. the gate
    const closed = this.gateRefusal();
    if (closed) throw new ServiceUnavailableException(closed);
    const sender = this.sender;
    if (!sender)
      throw new ServiceUnavailableException(GATE_SENTENCE["no-sender"]);

    // 5. the stored PDF
    const pdfMissing = new ConflictException(
      `A(z) ${version.quote.quoteNumber} v${version.versionNumber} PDF-je nem érhető el, ezért nincs mit csatolni.`,
    );
    if (!version.pdfStorageKey) throw pdfMissing;
    const pdf = await this.store.get({
      owner: "quote",
      ownerId: quoteId,
      documentId: version.pdfStorageKey,
    });
    if (!pdf) throw pdfMissing;

    // 6. one send at a time per version
    const claimed = await this.database.quoteVersion.updateMany({
      where: {
        id: versionId,
        OR: [
          { sendingSince: null },
          { sendingSince: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
        ],
      },
      data: { sendingSince: new Date() },
    });
    if (!claimed.count) {
      if (
        quoteId === "never" &&
        (await this.database.quoteMailDelivery.findUnique({
          where: { requestId },
          select: { id: true },
        }))
      )
        return this.detail(quoteId, user);
      throw new ConflictException(
        "Épp fut egy kiküldés ennél a verziónál; várd meg az eredményét.",
      );
    }
    /*
      THE CHECKS AGAIN, UNDER THE CLAIM (the first CI run caught it): the
      same request asked twice at once, and the first finished and released
      between the second's checks and its claim. Without this the second
      sends the mail again, and then fails to record it on the unique id.
    */
    const release = () =>
      this.database.quoteVersion.update({
        where: { id: versionId },
        data: { sendingSince: null },
      });
    if (
      quoteId === "never" &&
      (await this.database.quoteMailDelivery.findUnique({
        where: { requestId },
        select: { id: true },
      }))
    ) {
      await release();
      return this.detail(quoteId, user);
    }
    if (!resend && (await this.sentBefore(versionId))) {
      await release();
      throw new ConflictException(
        "Ez a verzió már kiment; újraküldéssel küldheted el ismét.",
      );
    }

    // 7. send, then record
    const sentTo = {
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
    };
    const safeSubject = headerSafe(subject);
    let outcome: "SENT" | "FAILED" | "INDETERMINATE" = "SENT";
    let error: string | null = null;
    try {
      await sender.send({
        ...sentTo,
        subject: safeSubject,
        text: body,
        attachments: [
          {
            filename: `${version.quote.quoteNumber}-v${version.versionNumber}.pdf`,
            contentType: "application/pdf",
            bytes: Buffer.from(pdf),
          },
        ],
      });
    } catch (cause) {
      outcome =
        cause instanceof TicketMailError &&
        cause.code === "TICKET_MAIL_SEND_INDETERMINATE"
          ? "INDETERMINATE"
          : "FAILED";
      error = cause instanceof Error ? cause.message : "ismeretlen hiba";
    }

    try {
      await this.database.$transaction(async (tx) => {
        await tx.quoteMailDelivery.create({
          data: {
            quoteId,
            quoteVersionId: versionId,
            initiatedByUserId: user.id,
            recipients: sentTo,
            subject: safeSubject,
            outcome,
            error,
            requestId,
            isResend: resend,
          },
        });
        await tx.quoteVersion.update({
          where: { id: versionId },
          data: { sendingSince: null },
        });
        // a first successful send moves a DRAFT quote to SENT (plan 5.4)
        if (outcome === "SENT")
          await tx.quote.updateMany({
            where: { id: quoteId, status: "DRAFT" },
            data: { status: "SENT" },
          });
        await tx.quoteEvent.create({
          data: {
            quoteId,
            versionId,
            kind: outcome === "SENT" ? "SENT" : "SEND_FAILED",
            actorUserId: user.id,
            payload: {
              versionNumber: version.versionNumber,
              outcome,
              requestId,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            action:
              outcome !== "SENT"
                ? "quote.send_failed"
                : resend
                  ? "quote.resent"
                  : "quote.sent",
            entityType: "QuoteVersion",
            entityId: versionId,
            userId: user.id,
            metadata: {
              quoteId,
              versionNumber: version.versionNumber,
              outcome,
              recipientCount:
                sentTo.to.length + sentTo.cc.length + sentTo.bcc.length,
            },
          },
        });
      });
    } catch {
      this.logger.error(
        `Quote ${quoteId} version ${versionId}: recording the send failed (outcome: ${outcome}).`,
      );
      throw new InternalServerErrorException(
        outcome === "SENT"
          ? "A levél kiment, de a rögzítése nálunk nem sikerült. NE küldd újra; szólj a fejlesztőnek."
          : "A kiküldés nem sikerült, és a rögzítése sem.",
      );
    }

    if (outcome === "INDETERMINATE")
      throw new ServiceUnavailableException(
        "A levél kiküldésének kimenetele bizonytalan: nem kaptunk választ, ezért nem tudjuk, megérkezett-e. NE próbáld újra azonnal: előbb nézd meg a címzettnél, hogy megkapta-e.",
      );
    if (outcome === "FAILED")
      throw new BadGatewayException(
        `A levél kiküldése nem sikerült (${error}). Újrapróbálhatod.`,
      );
    return this.detail(quoteId, user);
  }
}
