import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { KnowledgeExtractionService } from "./extraction.service.js";
import { MAX_PDF_BYTES } from "./pdf-full-text.js";

/**
 * KUTATÁSI ÁLLÍTÁS-KIOLVASÁS (S3), `knowledge.research.run` joggal: indítás
 * (`{ "sourceIds": [...] }`, legfeljebb öt forrás) és a futások olvasása. Az
 * indítás a `KNOWLEDGE_DISCOVERY` kapcsoló mögött áll, csak a teszt környezetben.
 */
@Controller("knowledge-base/extraction-runs")
export class KnowledgeExtractionController {
  constructor(private readonly extraction: KnowledgeExtractionService) {}

  @Post()
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_RESEARCH_RUN)
  start(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.extraction.start(body, user);
  }

  /**
   * A KÉZI PDF (research-kezi-pdf): egy forrás, a szerkesztő feltöltött PDF-jével (`file` mező), a nyílt szöveg helyett.
   * Csak még ki nem olvasott forrásra, vagy `reextract=true`-val. A PDF nem tárolódik, csak a lenyomata.
   */
  @Post("manual-pdf/:sourceId")
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_RESEARCH_RUN)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      // above the cap multer answers 413; the service checks the same cap for any other caller
      limits: { fileSize: MAX_PDF_BYTES, files: 1 },
    }),
  )
  startManualPdf(
    @Param("sourceId") sourceId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const bytes = file ? new Uint8Array(file.buffer) : undefined;
    return this.extraction.startManualPdf(
      sourceId,
      bytes,
      body?.reextract === "true" || body?.reextract === true,
      user,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_RESEARCH_RUN)
  list() {
    return this.extraction.list();
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_RESEARCH_RUN)
  get(@Param("id") id: string) {
    return this.extraction.get(id);
  }
}
