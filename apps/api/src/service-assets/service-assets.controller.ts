import { partnerScopeOf } from "../auth/partner-scope.util.js";
import {
  Body,
  BadRequestException,
  Controller,
  Delete,
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
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { memoryStorage } from "multer";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  AssetListQueryDto,
  AssetOwnersQueryDto,
  CreateAssetDto,
  UpdateAssetDto,
  UploadAssetDocumentDto,
} from "./dto/asset.dto.js";
import { ServiceAssetsService } from "./service-assets.service.js";

@Controller("service/assets")
export class ServiceAssetsController {
  constructor(private readonly service: ServiceAssetsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(
    @Query() query: AssetListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(query, partnerScopeOf(user));
  }

  @Get("owners")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  owners(@Query() query: AssetOwnersQueryDto) {
    return this.service.owners(query);
  }

  /**
   * A TULAJDONOST SZANDEKOSAN NEM ELLENORIZZUK (spec 4.1): a token maga a
   * kulcs. A hatokor MEGIS atmegy, mert a dokumentum-tipus szabalya nem a
   * tulajdonosrol szol -- lasd a tarolo `detailByQrToken` jegyzetet.
   */
  @Get("scan/:qrToken")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  scan(
    @Param("qrToken") qrToken: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.scan(qrToken, partnerScopeOf(user));
  }

  @Get(":id/qr")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  qrCode(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.qrCode(id, partnerScopeOf(user));
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  detail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.detail(id, partnerScopeOf(user));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  create(
    @Body() input: CreateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }

  @Post(":id/qr/rotate")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  rotateQr(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.rotateQr(id, user.id);
  }

  @Post(":id/documents")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  uploadDocument(
    @Param("id") id: string,
    @Body() input: UploadAssetDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A PDF fájl kötelező.");
    return this.service.addDocument(id, input.type, file, user.id);
  }

  @Get(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  @Header("Cache-Control", "private, no-store")
  async downloadDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const document = await this.service.document(
      id,
      documentId,
      partnerScopeOf(user),
    );
    return new StreamableFile(document.content, {
      type: document.contentType,
      length: document.content.length,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    });
  }

  @Delete(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  async deleteDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.deleteDocument(id, documentId, user.id);
    return { ok: true as const };
  }
}
