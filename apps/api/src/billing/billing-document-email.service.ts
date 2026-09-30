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
import {
  billingEmailDelivery,
  billingEmailModeFor,
  type AuthenticatedUser,
  type BillingDocumentDetail,
  type BillingDocumentEmailInput,
  type BillingDocumentStatus,
  type BillingDocumentType,
  type BillingEmailStatus,
  type InvoiceFormat,
} from "@acropora/types";

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
  mailGate,
  mailModeOf,
  mailRedirect,
} from "../notifications/mail/ticket-mail.rules.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import {
  billingEmailRecipients,
  billingEmailValues,
  MODE_LABEL,
  renderBillingEmail,
} from "./billing-document-email.js";
import { BillingDocumentEmailRepository } from "./billing-document-email.repository.js";
import { ISSUED_PDF } from "./billing-document-issue.service.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { toBillingDocumentDetail } from "./billing-documents.service.js";

/** Miért nem megy ki levél ebben a környezetben: a teendő a hibaüzenetben. */
const GATE_SENTENCE = {
  "mail-off":
    "A levélküldés ebben a környezetben ki van kapcsolva (TICKET_MAIL_MODE).",
  "path-off":
    "A számlázási bizonylatok kiküldése ebben a környezetben ki van kapcsolva (TICKET_MAIL_BILLING_DOCUMENT).",
  "no-redirect":
    "A próbacím (TICKET_MAIL_REDIRECT_TO) nincs beállítva, ezért nem küldünk levelet.",
  "no-sender": "A levélküldő (Gmail) nincs beállítva ebben a környezetben.",
} as const;

/**
 * A KIÁLLÍTOTT BIZONYLAT KIKÜLDÉSE (szerződés, `POST :id/email`).
 *
 * SOHA NEM ÁLLÍT KI ÚJ BIZONYLATOT és a Számlázz.hu-t sem hívja: csak `ISSUED`
 * sorra fut, és a kiállításkor tárolt PDF megy csatolmányként. A sorrend:
 *
 *   1. ugyanaz a `requestId` a meglévő kézbesítést adja vissza, küldés nélkül;
 *   2. az állapot és a mód (`billingEmailModeFor`, ugyanaz a szabály, mint a
 *      felületé): rossz mód 409, és megmondja, melyik illik;
 *   3. a címzettek és a sablon: hibás cím vagy feloldhatatlan változó 400, és
 *      ilyenkor a `requestId` nem foglalódik le;
 *   4. a levél-kapu (`TICKET_MAIL_MODE`, `TICKET_MAIL_BILLING_DOCUMENT`, a
 *      próbacím) és a küldő: zárva 503, egy mondattal;
 *   5. a feltételes foglalás (`SENDING`): két kattintásból egy levél;
 *   6. egy küldés, utána egy tranzakcióban a kézbesítési sor, az állapot és az
 *      auditnapló eseménye.
 */
@Injectable()
export class BillingDocumentEmailService {
  private readonly logger = new Logger(BillingDocumentEmailService.name);

  constructor(
    private readonly documents: BillingDocumentsRepository,
    private readonly repository: BillingDocumentEmailRepository,
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    @Optional()
    @Inject(MAIL_SENDER)
    private readonly sender: MailSender | null = null,
    @Optional()
    @Inject(TICKET_MAIL_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async send(
    id: string,
    input: BillingDocumentEmailInput,
    user: AuthenticatedUser,
  ): Promise<BillingDocumentDetail> {
    const previous = await this.repository.deliveryByRequestId(input.requestId);
    if (previous) {
      if (previous.invoiceId !== id)
        throw new ConflictException(
          "Ez a kérés-azonosító egy másik bizonylat kiküldéséhez tartozik.",
        );
      return this.detail(id);
    }

    const row = await this.documents.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    const status = row.status as BillingDocumentStatus;
    const emailStatus = row.emailStatus as BillingEmailStatus | null;
    if (status !== "ISSUED")
      throw new ConflictException("Csak kiállított bizonylat küldhető ki.");
    if (
      billingEmailDelivery(
        row.documentType as BillingDocumentType,
        row.invoiceFormat as InvoiceFormat | null,
      ) === "NONE"
    )
      throw new ConflictException("Ez a bizonylattípus nem küldhető ki.");
    const mode = billingEmailModeFor(status, emailStatus);
    if (mode === null)
      throw new ConflictException(
        "Épp fut egy kiküldés ennél a bizonylatnál; várd meg az eredményét.",
      );
    if (input.mode !== mode)
      throw new ConflictException(
        `Ennél a bizonylatnál most ${MODE_LABEL[mode]} indítható, nem ${MODE_LABEL[input.mode]}.`,
      );

    const recipients = billingEmailRecipients(input);
    if (!recipients.ok)
      throw new BadRequestException(
        recipients.invalid.length > 0
          ? `Hibás e-mail cím: ${recipients.invalid.join(", ")}.`
          : "Legalább egy címzett kell.",
      );

    const current = toBillingDocumentDetail(row);
    const values = billingEmailValues(
      row,
      current.customer?.name ?? row.partnerName,
    );
    const subject = renderBillingEmail(input.subject, values);
    const body = renderBillingEmail(input.body, values);
    if (!subject.ok || !body.ok) {
      const failed = [subject, body].filter((result) => !result.ok);
      const unknown = [
        ...new Set(failed.flatMap((r) => (r.ok ? [] : r.unknown))),
      ];
      const missing = [
        ...new Set(failed.flatMap((r) => (r.ok ? [] : r.missing))),
      ];
      throw new BadRequestException(
        [
          unknown.length > 0
            ? `Ismeretlen változó: ${unknown.map((name) => `{${name}}`).join(", ")}.`
            : null,
          missing.length > 0
            ? `Ennél a bizonylatnál nincs értéke: ${missing.map((name) => `{${name}}`).join(", ")}.`
            : null,
          "Írd át a szöveget, és küldd újra.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    }

    const gate = mailGate({
      mode: mailModeOf(this.environment.TICKET_MAIL_MODE),
      pathMode: mailModeOf(this.environment.TICKET_MAIL_BILLING_DOCUMENT),
      redirect: mailRedirect(this.environment.TICKET_MAIL_REDIRECT_TO),
    });
    if (gate.kind === "closed")
      throw new ServiceUnavailableException(GATE_SENTENCE[gate.reason]);
    if (!this.sender)
      throw new ServiceUnavailableException(GATE_SENTENCE["no-sender"]);

    const pdfMissing = new ConflictException(
      `A(z) ${row.invoiceNumber ?? row.id} bizonylat PDF-je nem érhető el nálunk, ezért nincs mit csatolni.`,
    );
    if (!row.pdfStorageKey) throw pdfMissing;
    const pdf = await this.documentStore.get({
      owner: "invoice",
      ownerId: row.id,
      documentId: ISSUED_PDF,
    });
    if (!pdf) throw pdfMissing;

    if (!(await this.repository.claim(id, mode))) {
      // A párhuzamos kérés nyert. Ha ugyanez a kérés volt, és már rögzítve
      // van, annak az eredménye a válasz; különben még fut.
      if (await this.repository.deliveryByRequestId(input.requestId))
        return this.detail(id);
      throw new ConflictException(
        "Épp fut egy kiküldés ennél a bizonylatnál; várd meg az eredményét.",
      );
    }

    const sentTo = {
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
    };
    const safeSubject = headerSafe(subject.text);
    let outcome: "SENT" | "FAILED" | "INDETERMINATE" = "SENT";
    let error: string | null = null;
    try {
      await this.sender.send({
        ...sentTo,
        subject: safeSubject,
        text: body.text,
        attachments: [
          {
            filename: `${row.invoiceNumber ?? row.id}.pdf`,
            contentType: "application/pdf",
            bytes: pdf,
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
      await this.repository.finish({
        id,
        requestId: input.requestId,
        mode,
        userId: user.id,
        previousEmailStatus: emailStatus,
        recipients: sentTo,
        subject: safeSubject,
        outcome,
        error,
      });
    } catch {
      this.logger.error(
        `A(z) ${row.invoiceNumber ?? id} kiküldésének rögzítése nem sikerült (kimenet: ${outcome}).`,
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
        `A levél kiküldése nem sikerült (${error}). Az újrapróbálással megismételheted.`,
      );
    return this.detail(id);
  }

  private async detail(id: string): Promise<BillingDocumentDetail> {
    const row = await this.documents.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    return toBillingDocumentDetail(row);
  }
}
