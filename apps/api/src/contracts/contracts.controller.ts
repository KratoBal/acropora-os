import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { DOCUMENT_UPLOAD_LIMITS } from "../documents/document-upload-limits.js";
import { ContractsService } from "./contracts.service.js";
import { CreateContractDto, UpdateContractDto } from "./dto.js";

/** Irodai szerződéstár. A PARTNERS_MANAGE kapu nem adható a szervizesnek. */
@Controller("partners/contracts")
@RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
export class ContractsController {
  constructor(private readonly service: ContractsService) {}

  @Get() list() {
    return this.service.list();
  }
  @Get("customers") customers() {
    return this.service.customers();
  }
  @Get(":id") detail(@Param("id") id: string) {
    return this.service.detail(id);
  }
  @Post() create(@Body() input: CreateContractDto) {
    return this.service.create(input);
  }
  @Patch(":id") update(
    @Param("id") id: string,
    @Body() input: UpdateContractDto,
  ) {
    return this.service.update(id, input);
  }

  @Post(":id/documents")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_UPLOAD_LIMITS.fileSizeBytes },
    }),
  )
  upload(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException("A feltöltendő PDF kötelező.");
    return this.service.addPdf(id, file);
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
