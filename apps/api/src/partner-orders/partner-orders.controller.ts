import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { DOCUMENT_UPLOAD_LIMITS } from "../documents/document-upload-limits.js";

import {
  CreatePartnerOrderDto,
  PartnerOrderListQueryDto,
  UpdatePartnerOrderSettingsDto,
} from "./dto.js";
import { PartnerOrdersService } from "./partner-orders.service.js";

/** Same gates as the quotes: reading needs QUOTES_VIEW, every change QUOTES_MANAGE. */
@Controller("partner-orders")
export class PartnerOrdersController {
  constructor(private readonly service: PartnerOrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW)
  list(@Query() query: PartnerOrderListQueryDto) {
    return this.service.list(query.page, query.pageSize, {
      q: query.q?.trim() || undefined,
      status: query.status,
      stage: query.stage,
      openOnly: query.open === "1",
      backlogOnly: query.backlog === "1",
    });
  }

  /** The orders' settings (S4b): how many idle days make an open order back-ordered. Declared before `:id`. */
  @Get("settings")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW)
  settings() {
    return this.service.settings();
  }

  @Put("settings")
  @RequirePermissions(PERMISSIONS.QUOTES_MANAGE)
  saveSettings(
    @Body() body: UpdatePartnerOrderSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveSettings(body.backlogDays, user);
  }

  @Get("candidates")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW)
  candidates() {
    return this.service.candidates();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  create(
    @Body() dto: CreatePartnerOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createFromQuote(dto.quoteId, user);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW)
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post(":id/documents")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_UPLOAD_LIMITS.fileSizeBytes, files: 1 },
    }),
  )
  uploadDocument(
    @Param("id") id: string,
    @Body("step") step: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A feltöltendő fájl kötelező.");
    return this.service.uploadDocument(id, String(step ?? ""), file, user);
  }

  @Get(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW)
  @Header("Cache-Control", "private, no-store")
  async download(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
  ) {
    const document = await this.service.document(id, documentId);
    return new StreamableFile(document.bytes, {
      type: document.contentType,
      length: document.bytes.length,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    });
  }

  @Delete(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE)
  deleteDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
  ) {
    return this.service.deleteDocument(id, documentId);
  }
}
