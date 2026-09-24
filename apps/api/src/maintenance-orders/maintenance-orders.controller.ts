import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
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

import { IssueMaintenanceOrderDto, RevokeMaintenanceOrderDto } from "./dto.js";
import { MaintenanceOrdersService } from "./maintenance-orders.service.js";

/**
 * A MEGRENDELŐLAP KIÁLLÍTÁSA. Ugyanaz a kapu, mint a szerződésen
 * (`PARTNERS_MANAGE`) -- a szervizes jogköre itt sem lát árat, ahogy a
 * szerződésén sem (acrobot kikötése, 2026-09-24).
 */
@Controller("partners/maintenance-orders")
@RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
export class MaintenanceOrdersController {
  constructor(private readonly service: MaintenanceOrdersService) {}

  @Get()
  list(@Query("contractId") contractId?: string) {
    if (!contractId?.trim())
      throw new BadRequestException(
        "A contractId lekérdezési paraméter kötelező.",
      );
    return this.service.list(contractId);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post()
  issue(
    @Body() dto: IssueMaintenanceOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.issue(dto, user);
  }

  @Post(":id/revoke")
  revoke(
    @Param("id") id: string,
    @Body() dto: RevokeMaintenanceOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.revoke(id, dto, user);
  }

  @Post(":id/signed-document")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_UPLOAD_LIMITS.fileSizeBytes },
    }),
  )
  uploadSignedDocument(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A feltöltendő PDF kötelező.");
    return this.service.uploadSignedDocument(id, file, user);
  }

  @Get(":id/documents/:documentId")
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
}
