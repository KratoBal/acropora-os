import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentEmailDraftService } from "./billing-document-email-draft.service.js";

/**
 * A SZÁMLA-LEVÉL KIINDULÓ SZÖVEGE BIZONYLAT NÉLKÜL: a még nem mentett számla
 * kiküldő fiókja innen indul, ugyanazzal a válasszal, mint a
 * `GET /billing/documents/:id/email-draft`. A jog ugyanaz: `billing.resend`.
 */
@Controller("billing")
export class BillingEmailDraftController {
  constructor(private readonly drafts: BillingDocumentEmailDraftService) {}

  @Get("email-draft")
  @RequirePermissions(PERMISSIONS.BILLING_RESEND)
  draft() {
    return this.drafts.templateDraft();
  }
}
