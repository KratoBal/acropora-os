import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";

import { ISSUED_PDF } from "../../billing/billing-document-issue.service.js";
import { DOCUMENT_STORE } from "../../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../../service-assets/document-store/document-store.js";
import {
  WEBSHOP_INVOICE_ENVIRONMENT,
  webshopInvoicePublicBase,
  webshopInvoiceSecret,
} from "./webshop-invoice.config.js";
import { WebshopInvoiceRepository } from "./webshop-invoice.repository.js";
import { guestInvoicesOf } from "./webshop-invoice.rules.js";
import {
  DOWNLOAD_TOKEN_MAX_SECONDS,
  mintDownloadToken,
  verifyDownloadToken,
  verifyLinkRequest,
} from "./webshop-invoice.token.js";

/** A letöltő hivatkozás élettartama: a felső korlát alatt, az órák eltérésére hagyott ráhagyással. */
const LINK_LIFETIME_SECONDS = DOWNLOAD_TOKEN_MAX_SECONDS - 60;

export interface GuestInvoiceLink {
  invoice_number: string | null;
  document_type: string;
  issue_date: string | null;
  url: string;
}

/**
 * A VENDÉG SZÁMLA-LETÖLTÉSE (V1.1, acrobot jóváhagyása 2026-11-05). A `link` a commerce szerver aláírt kérésére a rendelés
 * számláihoz egy-egy egyszer használatos, 14 perces letöltő hivatkozást ad; a `download` a vendég böngészőjének tokenjét
 * váltja PDF-re. Minden hiba `null`, a kontroller egyforma 404-gyel válaszol: nem derül ki, melyik rendelés létezik, és az sem,
 * hogy a token lejárt, már használt vagy hamis volt.
 */
@Injectable()
export class WebshopInvoiceService {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    private readonly repository: WebshopInvoiceRepository,
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    @Optional()
    @Inject(WEBSHOP_INVOICE_ENVIRONMENT)
    environment?: NodeJS.ProcessEnv,
  ) {
    this.environment = environment ?? process.env;
  }

  async link(
    request: { order_id?: unknown; ts?: unknown; sig?: unknown },
    nowMs: number = Date.now(),
  ): Promise<{ documents: GuestInvoiceLink[] } | null> {
    const secret = webshopInvoiceSecret(this.environment);
    const base = webshopInvoicePublicBase(this.environment);
    if (!secret || !base) return null;
    const now = Math.floor(nowMs / 1000);
    if (
      !verifyLinkRequest(
        secret,
        { orderId: request.order_id, ts: request.ts, sig: request.sig },
        now,
      )
    )
      return null;
    const orderId = request.order_id as string;
    const candidates = await this.repository.candidatesOf(orderId);
    const stornoed = await this.repository.stornoedAmong(
      candidates.map((row) => row.id),
    );
    const documents = guestInvoicesOf(candidates, stornoed).map((invoice) => ({
      invoice_number: invoice.invoiceNumber,
      document_type: invoice.documentType,
      issue_date: invoice.issueDate,
      url: `${base}/integrations/webshop-invoice/download/${mintDownloadToken(
        secret,
        {
          orderId,
          invoiceId: invoice.id,
          jti: randomUUID(),
          exp: now + LINK_LIFETIME_SECONDS,
        },
      )}`,
    }));
    return { documents };
  }

  async download(
    token: unknown,
    nowMs: number = Date.now(),
  ): Promise<{ bytes: Uint8Array; filename: string } | null> {
    const secret = webshopInvoiceSecret(this.environment);
    if (!secret) return null;
    const claims = verifyDownloadToken(secret, token, Math.floor(nowMs / 1000));
    if (!claims) return null;
    // a számla ma is a vendég számlája? (a token kiadása óta sztornózhatták, vagy a PDF eltűnhetett)
    const row = await this.repository.candidate(
      claims.invoiceId,
      claims.orderId,
    );
    if (!row) return null;
    const stornoed = await this.repository.stornoedAmong([row.id]);
    if (guestInvoicesOf([row], stornoed).length === 0) return null;
    const bytes = await this.documentStore.get({
      owner: "invoice",
      ownerId: row.id,
      documentId: ISSUED_PDF,
    });
    // a hiányzó PDF nem égeti el a tokent: a beváltás csak sikeres letöltés előtt, közvetlenül
    if (!bytes) return null;
    if (!(await this.repository.redeem(claims.jti, claims.orderId, row.id)))
      return null;
    const safe = (row.invoiceNumber ?? row.id).replace(/[^A-Za-z0-9._-]/g, "_");
    return { bytes, filename: `szamla-${safe}.pdf` };
  }
}
