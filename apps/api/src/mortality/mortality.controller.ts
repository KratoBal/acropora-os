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
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { DOCUMENT_UPLOAD_LIMITS } from "../documents/document-upload-limits.js";
import {
  CreateMortalityDto,
  MortalityListQueryDto,
  MortalityOptionQueryDto,
  UpdateMortalityDto,
  UploadMortalityPhotoDto,
} from "./dto/mortality.dto.js";
import { MortalityPhotosService } from "./mortality-photos.service.js";
import { MortalityService } from "./mortality.service.js";

/**
 * AZ ELHULLÁSI NAPLÓ (kártya 115c9740). Megtekintés `mortality.view`, rögzítés
 * és módosítás `mortality.manage` (acrobot döntése, 27141: OWNER, ADMIN,
 * MANAGER, SERVICE mindkettő, VIEWER csak megtekintés, partner semmi).
 * Törlés nincs, sem a bejegyzésre, sem a fényképre.
 *
 * Az `options/*` és a `summary` útvonal a `:id` ELŐTT áll: a Nest a
 * deklaráció sorrendjében illeszt.
 */
@Controller("mortality")
export class MortalityController {
  constructor(
    private readonly service: MortalityService,
    private readonly photos: MortalityPhotosService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MORTALITY_VIEW)
  list(@Query() query: MortalityListQueryDto) {
    return this.service.list(query);
  }

  @Get("summary")
  @RequirePermissions(PERMISSIONS.MORTALITY_VIEW)
  summary() {
    return this.service.summary();
  }

  @Get("options/products")
  @RequirePermissions(PERMISSIONS.MORTALITY_VIEW)
  productOptions(@Query() query: MortalityOptionQueryDto) {
    return this.service.productOptions(query.q);
  }

  @Get("options/aquariums")
  @RequirePermissions(PERMISSIONS.MORTALITY_VIEW)
  aquariumOptions() {
    return this.service.aquariumOptions();
  }

  @Get("options/suppliers")
  @RequirePermissions(PERMISSIONS.MORTALITY_VIEW)
  supplierOptions(@Query() query: MortalityOptionQueryDto) {
    return this.service.supplierOptions(query.q);
  }

  /** A halas rackek (Luca kérése, 2026-10-07); a kivezetettek nélkül. */
  @Get("options/locations")
  @RequirePermissions(PERMISSIONS.MORTALITY_VIEW)
  locationOptions() {
    return this.service.locationOptions();
  }

  @Get("options/recorders")
  @RequirePermissions(PERMISSIONS.MORTALITY_VIEW)
  recorderOptions() {
    return this.service.recorderOptions();
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.MORTALITY_VIEW)
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MORTALITY_MANAGE)
  create(
    @Body() input: CreateMortalityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.MORTALITY_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateMortalityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }

  /**
   * Eggyel több fájlt engedünk be, mint amennyit elfogadunk: a multer a saját
   * korlátját 500-zal vágná el (a hibajegy csatolmányainak indoka).
   */
  @Post(":id/photos")
  @RequirePermissions(PERMISSIONS.MORTALITY_MANAGE)
  @UseInterceptors(
    FilesInterceptor("file", DOCUMENT_UPLOAD_LIMITS.files + 1, {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_UPLOAD_LIMITS.fileSizeBytes },
    }),
  )
  async uploadPhotos(
    @Param("id") id: string,
    @Body() input: UploadMortalityPhotoDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!files?.length)
      throw new BadRequestException("A feltöltendő fénykép kötelező.");
    if (files.length > DOCUMENT_UPLOAD_LIMITS.files)
      throw new BadRequestException(
        `Egyszerre legfeljebb ${DOCUMENT_UPLOAD_LIMITS.files} fénykép tölthető fel.`,
      );
    // sorban: a keret-ellenőrzés a már felhasznalt helyet olvassa
    const created = [];
    for (const file of files)
      created.push(
        await this.photos.addPhoto(id, file, user.id, input.caption),
      );
    return created;
  }

  /** A fénykép; `variant=thumbnail` a csempe képe. Nem gyorsítótárazzuk. */
  @Get(":id/photos/:documentId")
  @RequirePermissions(PERMISSIONS.MORTALITY_VIEW)
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
