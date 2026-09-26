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

import { MaintenanceOrdersPortalService } from "./maintenance-orders-portal.service.js";

/**
 * A MEGRENDELŐLAP A PARTNER PORTÁLON -- `service/maintenance-orders`,
 * UGYANOLYAN ALAKÚ ÚTVONAL, MINT A `service/worksheets`/`service/assets`,
 * NEM a belső `partners/maintenance-orders` MÁSODIK BEJÁRATA.
 *
 * A `PARTNERS_MANAGE`-es belső végpontok (kiállítás, visszavonás, a teljes
 * ár-hordozó válasz) EBBŐL A KONTROLLERBŐL NEM ÉRHETŐK EL -- lásd a
 * szolgáltatás-réteg fejlécét, miért a szolgáltatás-metódust hívjuk, nem a
 * belső végpontot.
 */
@Controller("service/maintenance-orders")
export class MaintenanceOrdersPortalController {
  constructor(private readonly service: MaintenanceOrdersPortalService) {}

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

  /**
   * `SERVICE_MANAGE`, A DURVA KAPU -- a finom kapu (`MAINTENANCE_ORDER_
   * UPLOAD_SIGNED` képesség) a szolgáltatás-rétegben áll, ugyanúgy, mint az
   * `AssignAssetAquariumDto`-nál.
   */
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
