import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type PurchaseInvoiceListResponse,
} from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto.js";
import { CreateProjectDto } from "./dto/create-project.dto.js";
import { ExchangeRateQueryDto } from "./dto/exchange-rate-query.dto.js";
import { PurchaseInvoiceListQueryDto } from "./dto/purchase-invoice-list-query.dto.js";
import { PurchaseProductConflictQueryDto } from "./dto/purchase-product-conflict-query.dto.js";
import { PurchaseProductSearchQueryDto } from "./dto/purchase-product-search-query.dto.js";
import { PurchaseInvoicePdfLookup } from "./purchase-invoice-pdf.js";
import { PurchaseInvoiceScanService } from "./purchase-invoice-scan.service.js";
import { PurchaseInvoiceEditService } from "./purchase-invoice-edit.service.js";
import { PurchaseInvoiceCancelService } from "./purchase-invoice-cancel.service.js";
import { CancelPurchaseInvoiceDto } from "./dto/cancel-purchase-invoice.dto.js";
import { UpdatePurchaseInvoiceDto } from "./dto/update-purchase-invoice.dto.js";
import { PurchasingService } from "./purchasing.service.js";
import { SupplierLineSuggestionDto } from "./dto/supplier-line-suggestion.dto.js";
import { SupplierLineSuggestionService } from "./line-suggestions/supplier-line-suggestion.service.js";
import { SupplierInvoiceImportError } from "./supplier-invoice-import/supplier-invoice-import.error.js";
import {
  SUPPLIER_INVOICE_MAX_BYTES,
  SupplierInvoiceImportService,
} from "./supplier-invoice-import/supplier-invoice-import.service.js";

@Controller("purchasing")
export class PurchasingController {
  constructor(
    private readonly service: PurchasingService,
    private readonly supplierInvoiceImport: SupplierInvoiceImportService,
    private readonly lineSuggestions: SupplierLineSuggestionService,
    private readonly pdfLookup: PurchaseInvoicePdfLookup,
    private readonly scans: PurchaseInvoiceScanService,
    private readonly edits: PurchaseInvoiceEditService,
    private readonly cancels: PurchaseInvoiceCancelService,
  ) {}

  /**
   * #1199 P-026: javaslat egy termék nélküli számlasorhoz (beszállítói
   * leképezés, EAN-egyezés, Jev). Semmit nem köt és nem ment: a sor audit-
   * futását írja, és a javaslatot adja vissza; az ember fogad el.
   */
  @Post("invoices/line-suggestions")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  suggestLine(@Body() input: SupplierLineSuggestionDto) {
    return this.lineSuggestions.suggest(input);
  }

  @Get("products/search")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  searchProducts(@Query() query: PurchaseProductSearchQueryDto) {
    return this.service.searchProducts(query.q);
  }

  /** #1199 P-026: új termék felvétele előtt, EAN és beszállítói cikkszám szerint. */
  @Get("products/conflicts")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  productConflicts(@Query() query: PurchaseProductConflictQueryDto) {
    return this.service.newProductConflicts(query);
  }

  @Get("projects")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  listProjects() {
    return this.service.listProjects();
  }

  @Post("projects")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  createProject(
    @Body() input: CreateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createProject(input.name, user.id);
  }

  @Get("exchange-rate")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  getExchangeRate(@Query() query: ExchangeRateQueryDto) {
    return this.service.getExchangeRate(query.currency, query.date);
  }

  @Get("invoices")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  async listInvoices(
    @Query() query: PurchaseInvoiceListQueryDto,
  ): Promise<PurchaseInvoiceListResponse> {
    const page = await this.service.list(query);
    // a lap számláinak PDF-je (kártya f7df5354): egy lapra négy lekérdezés
    const hasPdf = await this.pdfLookup.hasPdf(page.items);
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        hasPdf: hasPdf.get(item.id) ?? false,
      })),
    };
  }

  /**
   * A beszállítói számlafájl (CII XML vagy ismert PDF) beolvasása az
   * űrlap előtöltéséhez. NEM ment semmit: a számlát az ember menti a
   * `POST invoices` úton (#1199 P-026). Ezért kéri a rögzítési jogot: csak
   * annak van értelme, aki utána menthet is.
   */
  @Post("invoices/import")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: SUPPLIER_INVOICE_MAX_BYTES },
    }),
  )
  async importSupplierInvoice(
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException("A számlafájl kötelező.");
    try {
      return await this.supplierInvoiceImport.read(file.buffer);
    } catch (error) {
      if (error instanceof SupplierInvoiceImportError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Get("invoices/:id")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  async getInvoice(@Param("id") id: string) {
    const detail = await this.service.getDetail(id);
    return { ...detail, scans: await this.scans.list(id) };
  }

  /**
   * A beszkennelt számla csatolása a rögzített számlához (kártya 5ec62e35):
   * a beolvasótól és a tételektől független. Kép (JPEG, PNG) egyoldalas
   * PDF-ként tárolódik.
   */
  @Post("invoices/:id/scans")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: SUPPLIER_INVOICE_MAX_BYTES },
    }),
  )
  attachScan(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A fájl kötelező.");
    return this.scans.attach(id, file, user.id);
  }

  @Get("invoices/:id/scans/:documentId")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  @Header("Cache-Control", "private, no-store")
  async scanPdf(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
  ) {
    const scan = await this.scans.bytes(id, documentId);
    const base = scan.fileName.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_");
    return new StreamableFile(scan.bytes, {
      type: "application/pdf",
      length: scan.bytes.length,
      disposition: `inline; filename="${base || "szamlakep"}.pdf"`,
    });
  }

  /**
   * A rögzített számla készlethatás nélküli mezőinek javítása (Luca,
   * 2026-10-08): számlaszám, dátumok, fizetés, megjegyzés, a sorok neve.
   */
  @Patch("invoices/:id")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  async updateInvoice(
    @Param("id") id: string,
    @Body() input: UpdatePurchaseInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.edits.update(id, input, user.id);
    return this.service.getDetail(id);
  }

  /**
   * A rögzített számla sztornója (Balázs „A 1”, acrobot 28092): a készlet
   * ellentétes mozgással kimegy, a foglalások felszabadulnak, a NAV-sor és a
   * várható beérkezés újra rögzíthető, a szám újra felhasználható.
   */
  @Post("invoices/:id/cancel")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  async cancelInvoice(
    @Param("id") id: string,
    @Body() input: CancelPurchaseInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.cancels.cancel(id, input.reason, user.id);
    return this.service.getDetail(id);
  }

  @Post("invoices")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  createInvoice(
    @Body() input: CreatePurchaseInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createInvoice(input, user.id);
  }
}
