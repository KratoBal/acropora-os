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
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto.js";
import { CreateProjectDto } from "./dto/create-project.dto.js";
import { ExchangeRateQueryDto } from "./dto/exchange-rate-query.dto.js";
import { PurchaseInvoiceListQueryDto } from "./dto/purchase-invoice-list-query.dto.js";
import { PurchaseProductSearchQueryDto } from "./dto/purchase-product-search-query.dto.js";
import { PurchasingService } from "./purchasing.service.js";
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
  ) {}

  @Get("products/search")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  searchProducts(@Query() query: PurchaseProductSearchQueryDto) {
    return this.service.searchProducts(query.q);
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
  listInvoices(@Query() query: PurchaseInvoiceListQueryDto) {
    return this.service.list(query);
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
