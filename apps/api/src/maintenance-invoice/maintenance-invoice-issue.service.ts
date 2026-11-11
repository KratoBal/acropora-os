import { ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  billingEmailModeFor,
  type AuthenticatedUser,
  type BillingEmailStatus,
  type MaintenanceInvoiceConfirmation,
  type MaintenanceInvoiceIssueResult,
} from "@acropora/types";

import { BillingDocumentEmailDraftService } from "../billing/billing-document-email-draft.service.js";
import { BillingDocumentEmailService } from "../billing/billing-document-email.service.js";
import { BillingDocumentsService } from "../billing/billing-documents.service.js";
import { MaintenanceInvoiceDraftService } from "./maintenance-invoice-draft.service.js";

/**
 * THE TIG INVOICE'S "KIÁLLÍTOM", WITH "ELKÜLDÖM E-MAILBEN" (card 7ba97e0d, S3; Balázs 2026-11-11 11:20 UTC: checked,
 * the invoice goes to the address the window shows, the TIG invoice included).
 *
 * The address is read from the window's own summary BEFORE the issue: no address is a 409 with nothing issued. After
 * the issue the letter goes out the way the billing page sends any issued invoice (`BillingDocumentEmailService`, the
 * Levelezés template): the issued TIG invoice is an own row of the billing module since #2421. A failed letter never
 * reads as a failed issue (barracuda on #2419): the answer is the issued invoice and what happened to the letter.
 */
@Injectable()
export class MaintenanceInvoiceIssueService {
  constructor(
    private readonly invoices: MaintenanceInvoiceDraftService,
    private readonly documents: BillingDocumentsService,
    private readonly email: BillingDocumentEmailService,
    private readonly emailDrafts: BillingDocumentEmailDraftService,
  ) {}

  async issue(
    invoiceId: string,
    confirmation: MaintenanceInvoiceConfirmation,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<MaintenanceInvoiceIssueResult> {
    const sendTo = confirmation.send
      ? (await this.invoices.issueSummary(invoiceId, now)).buyerEmail
      : null;
    if (confirmation.send && !sendTo)
      throw new ConflictException(
        "A partnernek nincs e-mail címe, ezért a számla nem küldhető ki: add meg a partnernél, vagy ne küldd ki.",
      );
    const invoice = await this.invoices.issue(invoiceId, confirmation, now);
    const mail =
      sendTo && invoice.status === "ISSUED"
        ? await this.sendIssued(invoice.id, sendTo, user)
        : null;
    return { invoice, mail };
  }

  private async sendIssued(
    invoiceId: string,
    to: string,
    user: AuthenticatedUser,
  ): Promise<NonNullable<MaintenanceInvoiceIssueResult["mail"]>> {
    try {
      const document = await this.documents.detail(invoiceId);
      const mode = billingEmailModeFor(
        "ISSUED",
        (document.emailStatus ?? null) as BillingEmailStatus | null,
      );
      if (!mode)
        return {
          to,
          sent: false,
          error:
            "A számla kiküldése épp fut; várd meg az eredményét a bizonylatnál.",
        };
      const letter = await this.emailDrafts.templateDraft("hu");
      await this.email.send(
        invoiceId,
        {
          requestId: randomUUID(),
          mode,
          to: [to],
          cc: [],
          bcc: [],
          subject: letter.subject,
          body: letter.body,
          bodyHtml: letter.bodyHtml,
        },
        user,
      );
      return { to, sent: true };
    } catch (error) {
      return {
        to,
        sent: false,
        error:
          error instanceof Error && error.message
            ? error.message
            : "A levél nem ment ki.",
      };
    }
  }
}
