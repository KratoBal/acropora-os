import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type IncomingDocumentDetail,
  type IncomingDocumentReview,
  type IncomingDocumentListResponse,
  type ReceiptsResponse,
} from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
import { IncomingDocumentListQueryDto } from "./dto/incoming-document-list-query.dto.js";
import { IncomingReviewDto } from "./dto/incoming-review.dto.js";
import { IncomingReviewService } from "./foreign-invoice/incoming-review.service.js";
import {
  incomingListResponse,
  toIncomingDetail,
  MAILBOX_ITEM_PREFIX,
  mailboxOnlyPaidItems,
  mailboxPdfCandidates,
  toIncomingListItem,
} from "./incoming-billing-documents.js";
import {
  collectedPdfIds,
  loadCollectedPdfIndex,
} from "./incoming-collected-pdf.js";

const PDF_MAGIC = Buffer.from("%PDF-");

/** A PDF válasza, a számlaszámból képzett biztonságos fájlnévvel. */
function pdfFile(content: Buffer, documentNumber: string) {
  // a szám nélküli postafiókos rekordnak is legyen neve
  const base = documentNumber.replace(/[^\w.-]+/g, "_");
  return new StreamableFile(content, {
    type: "application/pdf",
    length: content.length,
    disposition: `inline; filename="${base || "szamla"}.pdf"`,
  });
}

/**
 * A SZÁMLÁZÁS „BEJÖVŐ SZÁMLÁK” ÉS „NYUGTÁK” NÉZETE, CSAK OLVASÁSRA (Balázs
 * újraterv-promptja, acrobot 25869 és 25879). A jog ugyanaz, mint a kimenő
 * listáé: `billing.view`. A banki párosítás a Hiányzó számlák számításából jön,
 * új párosító logika nélkül.
 */
@Controller("billing")
@RequirePermissions(PERMISSIONS.BILLING_VIEW)
export class IncomingBillingDocumentsController {
  private readonly database = prisma;

  constructor(
    private readonly missing: MissingInvoicesService,
    private readonly reviews: IncomingReviewService,
  ) {}

  @Get("incoming-documents")
  async list(
    @Query() query: IncomingDocumentListQueryDto,
  ): Promise<IncomingDocumentListResponse> {
    const [rows, pairings, collected, readings] = await Promise.all([
      this.database.incomingBillingDocument.findMany(),
      this.missing.documentPairings(),
      this.collectedIndex(),
      this.reviews.pendingReadings(),
    ]);
    return incomingListResponse(
      [
        ...rows.map((row) =>
          toIncomingListItem(
            row,
            pairings,
            collectedPdfIds(row, collected).length > 0,
          ),
        ),
        // a feedben nem szereplő, csak postafiókból ismert, fizetett számlák
        ...mailboxOnlyPaidItems(rows, pairings, readings),
      ],
      query,
    );
  }

  /**
   * A POSTAFIÓKOS SOR ELLENŐRZÉSE (kártya e4c3b0fb). Az azonosító a lista
   * sorának azonosítója (`mailbox:<dokumentum>`). Az olvasás nem ír: ha még
   * nincs tárolt olvasat, a PDF-ből számol. A mentés és a jóváhagyás a
   * számla rögzítésének joga (`billing.create`); a jóváhagyás után a sor
   * rendes bejövő számla, „Postafiókból” eredettel.
   */
  @Get("incoming-documents/:id/review")
  review(@Param("id") id: string): Promise<IncomingDocumentReview> {
    return this.reviews.review(id);
  }

  @Put("incoming-documents/:id/review")
  @RequirePermissions(PERMISSIONS.BILLING_CREATE)
  saveReview(
    @Param("id") id: string,
    @Body() input: IncomingReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<IncomingDocumentReview> {
    return this.reviews.save(id, input, user.id);
  }

  /** Üres törzzsel a tárolt (vagy kinyert) értékeket hagyja jóvá. */
  @Post("incoming-documents/:id/review/approve")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_CREATE)
  approveReview(
    @Param("id") id: string,
    @Body() input: IncomingReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<IncomingDocumentReview> {
    const given = Object.values(input ?? {}).some(
      (value) => value !== undefined,
    );
    return this.reviews.approve(id, given ? input : null, user.id);
  }

  @Get("incoming-documents/:id")
  async detail(@Param("id") id: string): Promise<IncomingDocumentDetail> {
    const row = await this.database.incomingBillingDocument.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException("Nincs ilyen bejövő számla.");
    const [pairings, collected] = await Promise.all([
      this.missing.documentPairings(),
      this.collectedIndex(),
    ]);
    return toIncomingDetail(
      row,
      pairings,
      collectedPdfIds(row, collected).length > 0,
    );
  }

  /**
   * A számla PDF-je. ELŐSZÖR a Számlázz.hu-é, ha valódi PDF-et küldött (a
   * `pdfszamlabe` regisztrációnál; élesen 2026-10-04-én 85-ből 5). Ha nem, a
   * BEGYŰJTÖTT PDF, számlaszám és adószám-törzs szerint párosítva
   * (`incoming-collected-pdf.ts`).
   *
   * A KÉT KUDARC KÉT KÜLÖN VÁLASZ (kártya f7df5354, Sutyerák #16): nincs ilyen
   * számla: 404; a számla megvan, de PDF nem érkezett hozzá: 409. Korábban
   * mindkettő 404 volt, és egy hívó (Sutyerák) nem tudta megmondani, hogy a
   * PDF hiányzik, vagy rossz azonosítót kérdezett. A felület a `hasPdf`
   * alapján gombot sem mutat.
   *
   * A CSAK POSTAFIÓKOS SOR (`mailbox:<jelölt>`) is ide jön: annak nincs
   * feed-adatlapja, a lista a sorra kattintva a PDF-et nyitja meg (Balázs
   * jelzése, 2026-10-07: a „Postafiókból” sorok kattintásra nem csináltak
   * semmit). Ugyanaz a jog, ugyanaz a 404 és 409.
   */
  @Get("incoming-documents/:id/pdf")
  @Header("Cache-Control", "private, no-store")
  async pdf(@Param("id") id: string) {
    if (id.startsWith(MAILBOX_ITEM_PREFIX))
      return this.mailboxPdf(id.slice(MAILBOX_ITEM_PREFIX.length));
    const row = await this.database.incomingBillingDocument.findUnique({
      where: { id },
      select: {
        documentNumber: true,
        supplierTaxNumber: true,
        sourceDocumentId: true,
      },
    });
    if (!row) throw new NotFoundException("Nincs ilyen bejövő számla.");
    const content = await this.firstPdf([
      ...(row.sourceDocumentId ? [row.sourceDocumentId] : []),
      ...collectedPdfIds(row, await this.collectedIndex()),
    ]);
    return pdfFile(content, row.documentNumber);
  }

  /**
   * A csak postafiókos sor PDF-je. Sor CSAK abból a jelöltből van, amit a
   * lista is megmutat (`mailboxOnlyPaidItems`, ugyanazzal a feltétellel és a
   * feed-duplikáció kiszűrésével); minden más azonosító 404, akkor is, ha
   * egy alias vagy egy nem fizetett jelölt létezik. A fájl az összevont
   * jelöltben az eredetinél van (`mailboxPdfCandidates`).
   */
  private async mailboxPdf(documentId: string) {
    const [rows, pairings] = await Promise.all([
      this.database.incomingBillingDocument.findMany({
        select: { sourceDocumentId: true, documentNumber: true },
      }),
      this.missing.documentPairings(),
    ]);
    const pairing = pairings.get(documentId);
    // aliasra nem válaszol: a lista a fő azonosítóval adja a sort
    if (
      !pairing ||
      pairing.document.id !== documentId ||
      mailboxOnlyPaidItems(rows, new Map([[documentId, pairing]])).length === 0
    )
      throw new NotFoundException("Nincs ilyen bejövő számla.");
    const content = await this.firstPdf(mailboxPdfCandidates(pairing.document));
    return pdfFile(content, pairing.document.number);
  }

  /**
   * Az első valódi PDF a jelöltek közül, sorrendben; a nem PDF tartalom
   * (például a feed XML-je) kimarad. Ha egy sincs: 409.
   */
  private async firstPdf(candidates: readonly string[]): Promise<Buffer> {
    for (const documentId of candidates) {
      const document = await this.database.incomingSupplierDocument.findUnique({
        where: { id: documentId },
        select: { content: true },
      });
      const bytes = document ? Buffer.from(document.content) : null;
      if (bytes && bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC))
        return bytes;
    }
    throw new ConflictException("A számla megvan, de PDF nem érkezett hozzá.");
  }

  /**
   * A begyűjtött PDF-ek párosítási indexe, a tartalmuk nélkül: csak a kulcsok
   * (számlaszám, adószám) kellenek hozzá. A listánál egy lekérdezés az egész.
   */
  private async collectedIndex() {
    return loadCollectedPdfIndex(this.database);
  }

  /**
   * A NYUGTÁK a C szeletig: csak a beérkezett nyugták száma (különböző
   * azonosító, a változatok egyszer számítanak). A sorok mezőit az első valódi
   * köteg auditja után képezzük le; addig nem találunk ki mezőt.
   */
  @Get("receipts")
  async receipts(): Promise<ReceiptsResponse> {
    const received = await this.database.szamlazzFeedMessage.findMany({
      where: { kind: "NYUGTA" },
      distinct: ["externalId"],
      select: { externalId: true },
    });
    return { received: received.length, items: [] };
  }
}
