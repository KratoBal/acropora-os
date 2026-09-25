import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Post,
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

import { CompletionCertificatesPortalService } from "./completion-certificates-portal.service.js";

/**
 * A TELJESÍTÉSI IGAZOLÁS A PARTNER PORTÁLON -- `service/completion-
 * certificates`, ugyanolyan alakú útvonal, mint a `service/worksheets`.
 * Lásd `maintenance-orders-portal.controller.ts` fejlécét: ugyanaz a
 * szerkezeti döntés, kártestvér modulon.
 */
@Controller("service/completion-certificates")
export class CompletionCertificatesPortalController {
  constructor(private readonly service: CompletionCertificatesPortalService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  detail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.detail(id, user);
  }

  @Get(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  @Header("Cache-Control", "private, no-store")
  async download(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const document = await this.service.document(id, documentId, user);
    return new StreamableFile(document.bytes, {
      type: document.contentType,
      length: document.bytes.length,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    });
  }

  @Post(":id/signed-document")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
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
}
