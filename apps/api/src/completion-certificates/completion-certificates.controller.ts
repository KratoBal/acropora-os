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

import { IssueCompletionCertificateDto } from "./dto.js";
import { CompletionCertificatesService } from "./completion-certificates.service.js";

/** Ugyanaz a kapu, mint a megrendelőlapon és a szerződésen: PARTNERS_MANAGE. */
@Controller("partners/completion-certificates")
@RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
export class CompletionCertificatesController {
  constructor(private readonly service: CompletionCertificatesService) {}

  @Get()
  list(@Query("serviceJobId") serviceJobId?: string) {
    if (!serviceJobId?.trim())
      throw new BadRequestException(
        "A serviceJobId lekérdezési paraméter kötelező.",
      );
    return this.service.list(serviceJobId);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post()
  issue(
    @Body() dto: IssueCompletionCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.issue(dto, user);
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
  ) {
    if (!file) throw new BadRequestException("A feltöltendő PDF kötelező.");
    return this.service.uploadSignedDocument(id, file);
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
