import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { CompletionCertificatesRepository } from "../completion-certificates/completion-certificates.repository.js";
import { storageKeyFor } from "../service-assets/document-store/document-storage-key.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import {
  SzamlazzAgentHttpError,
  type SzamlazzAgentClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { HttpSzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import { buildSzamlazzAgentInvoiceXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { SzamlazzConnectionError } from "../integrations/szamlazz/szamlazz-connection.types.js";
import {
  maintenanceInvoiceXmlInputFrom,
  MaintenanceInvoiceInputError,
} from "./maintenance-invoice-xml-input.js";
import { MaintenanceInvoiceRepository } from "./maintenance-invoice.repository.js";

/**
 * A KARBANTARTÁSI PISZKOZAT-SZÁMLA LÉTREHOZÁSA (ADR-014, 4. szelet).
 *
 * NINCS FEATURE-KAPCSOLÓ ELŐTTE -- Balázs döntése (acrobot 23107, 2. pont):
 * a piszkozat szabadon készíthető, kapu csak a VALÓDI kiállítás előtt áll
 * (`MAINTENANCE_INVOICE_ISSUE_ENABLED`, ma nem épült meg, mert ehhez a
 * körhöz nem tartozik).
 *
 * MINDEN HÍVÁS VALÓDI KÜLSŐ HÍVÁS a Számlázz.hu felé, `előnézetpdf=true`
 * mellett -- ez a mai kör mégis megengedett, mert az `előnézetpdf` a
 * hivatalos dokumentáció szerint NEM hoz létre bizonylatot. Ennek ellenére
 * a hívás a TÁROLT, VALÓDI Agent Key-t használja, tehát ELSŐ ÉLES HASZNÁLAT
 * ELŐTT acrobot külön szól Balázsnak (23107) -- ezt a szolgáltatás maga nem
 * tudja kikényszeríteni, mert az egy szervezeti lépés, nem kód-feltétel.
 */
@Injectable()
export class MaintenanceInvoiceDraftService {
  constructor(
    private readonly certificates: CompletionCertificatesRepository,
    private readonly repository: MaintenanceInvoiceRepository,
    private readonly credentials: SzamlazzCredentialProvider,
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    /**
     * `@Optional()`, MERT NEST KÜLÖNBEN INJEKTÁLNI PRÓBÁLNÁ: egy interfész-
     * típusra nincs futásidejű token, és az alkalmazás a TELJES függőségi
     * gráf építésekor hasalna el -- ugyanaz a hiba, amit a Medusa
     * `clientFactory` paraméterének doc-commentje ír le
     * (medusa-connection.service.ts), és amit a bootstrap teszt itt is
     * elkapott, még a beküldés előtt (2026-09-24).
     */
    @Optional()
    private readonly client: SzamlazzAgentClient = new HttpSzamlazzAgentClient(),
  ) {}

  async draftFor(certificateId: string) {
    const existing = await this.repository.existingInvoice(certificateId);
    if (existing) return existing;

    const certificate = await this.certificates.detail(certificateId);
    if (!certificate)
      throw new NotFoundException("A teljesítési igazolás nem található.");

    const signed = certificate.documents.some(
      (document) => document.type === "SIGNED_FORM",
    );
    if (!signed)
      throw new ConflictException(
        "A teljesítési igazolás aláírt példánya hiányzik -- piszkozat-számla enélkül nem készíthető.",
      );

    const customer = certificate.serviceJob.customer;
    if (!customer)
      throw new BadRequestException(
        "A karbantartási laphoz nincs vevő rendelve -- piszkozat-számla enélkül nem készíthető.",
      );

    let mapped;
    try {
      mapped = maintenanceInvoiceXmlInputFrom({
        number: certificate.number,
        issuedAt: certificate.issuedAt,
        serviceJob: { customer },
        items: certificate.items,
      });
    } catch (error) {
      if (error instanceof MaintenanceInvoiceInputError)
        throw new BadRequestException(
          error.code === "NO_BILLING_ADDRESS"
            ? "A vevőnek nincs alapértelmezett számlázási címe -- piszkozat-számla enélkül nem készíthető."
            : "A teljesítési igazolásnak nincs tétele -- piszkozat-számla enélkül nem készíthető.",
        );
      throw error;
    }

    let agentKey: string;
    try {
      agentKey = (await this.credentials.resolve()).agentKey;
    } catch (error) {
      if (error instanceof SzamlazzConnectionError)
        throw new ServiceUnavailableException(
          "A Számlázz.hu kapcsolat nincs beállítva -- add meg az Agent Key-t a Beállítások oldalon.",
        );
      throw error;
    }

    const xml = buildSzamlazzAgentInvoiceXml({
      ...mapped.xmlInput,
      agentKey,
      previewOnly: true,
    });

    let response;
    try {
      response = await this.client.generateInvoice(xml);
    } catch (error) {
      if (error instanceof SzamlazzAgentHttpError)
        throw new ServiceUnavailableException(
          `A Számlázz.hu nem érhető el vagy hibával válaszolt (HTTP ${error.status}).`,
        );
      throw error;
    }

    if (!response.successful || !response.pdf)
      throw new ServiceUnavailableException(
        response.errorMessage ??
          "A Számlázz.hu elutasította az előnézet-kérést.",
      );

    const invoiceId = randomUUID();
    const documentKey = {
      owner: "invoice" as const,
      ownerId: invoiceId,
      documentId: "preview.pdf",
    };
    await this.documentStore.put(documentKey, response.pdf);

    return this.repository.createDraft({
      id: invoiceId,
      completionCertificateId: certificateId,
      customerId: customer.id,
      partnerName: customer.displayName,
      partnerTaxNumber: customer.taxNumber,
      currency: mapped.xmlInput.currency,
      totals: mapped.totals,
      pdfStorageKey: storageKeyFor(documentKey),
      lines: certificate.items.map((item, index) => {
        const amounts = mapped.lineAmounts[index]!;
        return {
          description: item.description,
          quantity: item.quantity,
          unitNet: item.unitNet,
          vatRatePercent: item.vatRatePercent,
          netAmount: amounts.netAmount,
          vatAmount: amounts.vatAmount,
          grossAmount: amounts.grossAmount,
        };
      }),
    });
  }
}
