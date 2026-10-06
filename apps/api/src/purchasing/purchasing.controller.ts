import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
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
  getInvoice(@Param("id") id: string) {
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
