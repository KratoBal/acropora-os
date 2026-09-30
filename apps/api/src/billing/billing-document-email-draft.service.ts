import { Injectable, NotFoundException } from "@nestjs/common";
import {
  mailTemplateEventVariables,
  type MailTemplateVariable,
} from "@acropora/types";

import {
  BILLING_DOCUMENT_MANUAL,
  DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE,
} from "../notifications/mail/billing-document-mail.content.js";
import { TicketMailRepository } from "../notifications/mail/ticket-mail.repository.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";

export interface BillingEmailDraft {
  /** `stored`: a Levelezés oldalon átírt szöveg; `default`: az alapszöveg. */
  source: "stored" | "default";
  /** Nyers, `{{név}}` alakú változókkal: a szerver küldéskor helyettesít. */
  subject: string;
  body: string;
  variables: readonly MailTemplateVariable[];
}

/**
 * A KIKÜLDŐ FIÓK KIINDULÓ SZÖVEGE (acrobot, 2026-09-30): a Levelezés oldal
 * `BILLING_DOCUMENT_MANUAL` sablonja, nyers alakban. Saját végpont, mert a
 * sablon-szerkesztő végpontja beállítási jogot kér, a kiküldés pedig
 * `billing.resend`-et. A számla-levél sima szöveg, ezért csak a `body` megy.
 */
@Injectable()
export class BillingDocumentEmailDraftService {
  constructor(
    private readonly documents: BillingDocumentsRepository,
    private readonly templates: TicketMailRepository,
  ) {}

  async draft(id: string): Promise<BillingEmailDraft> {
    if (!(await this.documents.find(id)))
      throw new NotFoundException("A bizonylat nem található.");
    return this.templateDraft();
  }

  /**
   * BIZONYLAT NÉLKÜL (acrobot 25343, Balázs találta a stage-en): egy még nem
   * mentett számlának nincs azonosítója, így a kiküldő fiók a `draft(id)`-t nem
   * tudja hívni, és addig egy beégetett szöveget mutatott, miközben a kiküldés
   * már a sablont vitte. A szöveg ugyanaz, mert a sablon nem függ a bizonylattól.
   */
  async templateDraft(): Promise<BillingEmailDraft> {
    const stored = await this.templates.template(BILLING_DOCUMENT_MANUAL);
    return {
      source: stored ? "stored" : "default",
      subject: (stored ?? DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE).subject,
      body: (stored ?? DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE).body,
      variables: mailTemplateEventVariables(BILLING_DOCUMENT_MANUAL),
    };
  }
}
