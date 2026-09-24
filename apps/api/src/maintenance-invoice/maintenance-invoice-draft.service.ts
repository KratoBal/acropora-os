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
import type { Prisma } from "@acropora/database";
import type { MaintenanceInvoiceSummary } from "@acropora/types";

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
 * A KLIENSNEK SZÁNT, SZŰK ALAK -- a UNAS-tükör `toInvoiceSummary` mintája
 * (unas-order-sync.types.ts): a `Prisma.Decimal` mezők stringként mennek,
 * és csak azok a mezők szerepelnek, amiket a panel ténylegesen kiír.
 */
function toSummary(invoice: {
  id: string;
  status: string;
  currency: string;
  netAmount: Prisma.Decimal | null;
  vatAmount: Prisma.Decimal | null;
  grossAmount: Prisma.Decimal | null;
  createdAt: Date;
}): MaintenanceInvoiceSummary {
  return {
    id: invoice.id,
    status: invoice.status as MaintenanceInvoiceSummary["status"],
    currency: invoice.currency,
    netAmount: invoice.netAmount?.toString() ?? "0",
    vatAmount: invoice.vatAmount?.toString() ?? "0",
    grossAmount: invoice.grossAmount?.toString() ?? "0",
    createdAt: invoice.createdAt.toISOString(),
  };
}

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

  /**
   * A MEGLÉVŐ PISZKOZAT, HA VAN -- CSAK OLVASÁS, Számlázz.hu-hívás nélkül.
   * A panel ezt hívja betöltéskor, hogy tudja, kell-e még "Piszkozat
   * készítése" gombot mutatnia.
   */
  async byCertificate(
    certificateId: string,
  ): Promise<MaintenanceInvoiceSummary | null> {
    const existing = await this.repository.existingInvoice(certificateId);
    return existing ? toSummary(existing) : null;
  }

  /** A piszkozat előnézeti PDF-jének bájtjai, a dokumentum-tárolóból. */
  async pdfFor(invoiceId: string): Promise<Buffer> {
    const invoice = await this.repository.invoicePdfLookup(invoiceId);
    if (!invoice)
      throw new NotFoundException("A piszkozat-számla nem található.");
    if (!invoice.pdfStorageKey)
      throw new ServiceUnavailableException(
        "A piszkozat-számla PDF-je nem érhető el.",
      );
    const key = {
      owner: "invoice" as const,
      ownerId: invoice.id,
      documentId: "preview.pdf",
    };
    const bytes = await this.documentStore.get(key);
    if (!bytes)
      throw new ServiceUnavailableException(
        "A piszkozat-számla PDF-je a dokumentum-tárolóban nem érhető el.",
      );
    return Buffer.from(bytes);
  }

  async draftFor(certificateId: string): Promise<MaintenanceInvoiceSummary> {
    const existing = await this.repository.existingInvoice(certificateId);
    if (existing) return toSummary(existing);

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
      /*
        MINDEN HIBA IDE FUT, NEM CSAK A `SzamlazzAgentHttpError` -- acrobot
        kérdése (23160): egy nyers hálózati hiba (DNS, kapcsolat megszakadt,
        időtúllépés) a `fetch`-ből érkezik, SOHA nem `SzamlazzAgentHttpError`
        (az csak akkor keletkezik, ha egyáltalán jött HTTP válasz). Egy
        `SzamlazzAgentXmlError` (érvénytelen/váratlan válasz-alak) ugyanígy
        idegen technikai szöveget adna a panelen. Mielőtt ez a javítás
        megtörtént, mindkettő a NYERS hibát dobta tovább a hívóig -- a
        felhasználó egy angol/technikai üzenetet látott volna a saját
        magyar nyelvű felülete helyett. Egyik ág sem ír adatbázisba: ez a
        hívás a piszkozat LÉTREHOZÁSA ELŐTT fut, tehát félkész DRAFT sor
        egyik esetben sem keletkezhet.
      */
      if (error instanceof SzamlazzAgentHttpError)
        throw new ServiceUnavailableException(
          `A Számlázz.hu nem érhető el vagy hibával válaszolt (HTTP ${error.status}).`,
        );
      throw new ServiceUnavailableException(
        "A Számlázz.hu nem érhető el (hálózati hiba). Próbáld újra.",
      );
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

    const created = await this.repository.createDraft({
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
    return toSummary(created);
  }
}
