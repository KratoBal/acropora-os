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
import {
  CreateOperationsLogEntryDto,
  OperationsLogEntryListQueryDto,
  UploadOperationsLogPhotoDto,
} from "./dto/operations-log-entry.dto.js";
import { OperationsLogEntriesService } from "./operations-log-entries.service.js";
import { OperationsLogPhotosService } from "./operations-log-photos.service.js";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ BEJEGYZÉSEINEK VÉGPONTJAI (task os-uzemeltetesi-naplo, S2a).
 *
 * A RÖGZÍTÉS (`operations-log.record`) a szerelőé és a vezetőké: a rögzítés kínálata (az eszközhöz tartozó sablonok) és a kollégák
 * listája is ezt a jogot kéri, mert a rögzítő képernyő kell hozzájuk. A bejegyzések OLVASÁSA a nézet joga
 * (`operations-log.view`); a partner-nézet (S5) a saját, szűkített végpontján jön, nem ezeken.
 */
@Controller("operations-log")
export class OperationsLogEntriesController {
  constructor(
    private readonly service: OperationsLogEntriesService,
    private readonly photos: OperationsLogPhotosService,
  ) {}

  @Get("assets/:assetId/templates")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_RECORD)
  templatesForAsset(@Param("assetId") assetId: string) {
    return this.service.templatesForAsset(assetId);
  }

  @Get("colleagues")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_RECORD)
  colleagues() {
    return this.service.colleagues();
  }

  @Post("entries")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_RECORD)
  create(
    @Body() input: CreateOperationsLogEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Get("entries")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_VIEW)
  list(@Query() query: OperationsLogEntryListQueryDto) {
    return this.service.list(query);
  }

  @Get("entries/:id")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_VIEW)
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  /**
   * EGY KÉP EGY FÉNYKÉP MEZŐHÖZ, KÉRÉSENKÉNT EGY (az újraküldés kulcsa kérésenként egy kép). A bejegyzés rögzítője csatolhat;
   * a telefon a bejegyzés után, külön kéréssel küldi (offline sorban is). Eggyel több fájlt engedünk be, mint amennyit
   * elfogadunk: a multer a saját korlátját 500-zal vágná el.
   */
  @Post("entries/:id/photos")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_RECORD)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_UPLOAD_LIMITS.fileSizeBytes },
    }),
  )
  async uploadPhoto(
    @Param("id") id: string,
    @Body() input: UploadOperationsLogPhotoDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A feltöltendő fénykép kötelező.");
    return this.photos.addPhoto(id, file, user.id, input);
  }

  /** A kép; `variant=thumbnail` a csempe képe. Nem gyorsítótárazzuk. */
  @Get("entries/:id/photos/:documentId")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_VIEW)
  @Header("Cache-Control", "private, no-store")
  async downloadPhoto(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Query("variant") variant?: string,
  ) {
    const photo = await this.photos.photoBytes(id, documentId, variant);
    return new StreamableFile(photo.bytes, {
      type: photo.contentType,
      length: photo.bytes.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(photo.fileName)}`,
    });
  }
}
