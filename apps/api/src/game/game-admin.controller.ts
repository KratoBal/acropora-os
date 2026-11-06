import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Put,
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
  MAIL_IMAGE_MAX_BYTES,
  MailImageService,
} from "../notifications/mail/mail-image.service.js";
import {
  GameDecisionDto,
  GameDrawDto,
  GameQuestionDto,
} from "./game-admin.dto.js";
import { GameAdminService } from "./game-admin.service.js";

/**
 * THE GIVEAWAY'S ADMIN (card 31445d0f, slice 2). Its own rights (acrobot, 2026-11-05 22:41): GAME_VIEW reads the entries
 * and the players' addresses, GAME_MANAGE adds a question, decides an answer and draws. Only the human roles hold them
 * (OWNER, ADMIN, MANAGER); neither the VIEWER nor a machine token (CONTENT_AGENT) sees an address or draws.
 */
@Controller("game")
export class GameAdminController {
  constructor(
    private readonly admin: GameAdminService,
    private readonly images: MailImageService,
  ) {}

  /**
   * THE PRIZE'S PICTURE goes into the mail image store (the one image store the OS has: contents in the database, the
   * type taken from the bytes, a JPEG re-encoded without its metadata), not into a new one. The answer is the stored
   * image's summary; the question keeps its `id`.
   */
  @Post("prize-images")
  @RequirePermissions(PERMISSIONS.GAME_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAIL_IMAGE_MAX_BYTES, files: 1 },
    }),
  )
  uploadPrizeImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A feltöltendő kép kötelező.");
    return this.images.upload(file, user.id);
  }

  /** The preview in the admin form (authenticated; the public page gets its own, narrower read later). */
  @Get("prize-images/:id/content")
  @RequirePermissions(PERMISSIONS.GAME_VIEW)
  @Header("Cache-Control", "private, max-age=3600")
  async prizeImage(@Param("id") id: string) {
    const image = await this.admin.prizeImage(id);
    if (!image) throw new NotFoundException("Nincs ilyen kép.");
    return new StreamableFile(image.bytes, {
      type: image.contentType,
      length: image.bytes.byteLength,
    });
  }

  @Get("questions")
  @RequirePermissions(PERMISSIONS.GAME_VIEW)
  questions() {
    return this.admin.questions();
  }

  @Post("questions")
  @RequirePermissions(PERMISSIONS.GAME_MANAGE)
  createQuestion(@Body() input: GameQuestionDto) {
    return this.admin.createQuestion(input);
  }

  @Put("questions/:id")
  @RequirePermissions(PERMISSIONS.GAME_MANAGE)
  updateQuestion(@Param("id") id: string, @Body() input: GameQuestionDto) {
    return this.admin.updateQuestion(id, input);
  }

  @Get("questions/:id/entries")
  @RequirePermissions(PERMISSIONS.GAME_VIEW)
  entries(@Param("id") id: string) {
    return this.admin.entries(id);
  }

  @Put("entries/:id/decision")
  @RequirePermissions(PERMISSIONS.GAME_MANAGE)
  decide(
    @Param("id") id: string,
    @Body() input: GameDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.decide(id, input.correct ?? null, user.id);
  }

  @Get("draws")
  @RequirePermissions(PERMISSIONS.GAME_VIEW)
  draws() {
    return this.admin.draws();
  }

  @Post("draws")
  @RequirePermissions(PERMISSIONS.GAME_MANAGE)
  draw(@Body() input: GameDrawDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.draw(input, user.id);
  }

  /** What the live draw page shows before and after the draw (counts, prize, the winner's shortened name): no e-mail. */
  @Get("live-draw")
  @RequirePermissions(PERMISSIONS.GAME_MANAGE)
  liveDraw(@Query() query: GameDrawDto) {
    return this.admin.liveDraw(query);
  }

  /** The button on the live page: the existing draw, once per week; a second press returns the recorded result. */
  @Post("live-draw")
  @RequirePermissions(PERMISSIONS.GAME_MANAGE)
  runLiveDraw(
    @Body() input: GameDrawDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.runLiveDraw(input, user.id);
  }

  @Post("draws/:id/verify")
  @RequirePermissions(PERMISSIONS.GAME_VIEW)
  verify(@Param("id") id: string) {
    return this.admin.verify(id);
  }

  /** The mail waiting past the daily cap (acrobot, 2026-11-05 22:57). */
  @Get("mail-queue")
  @RequirePermissions(PERMISSIONS.GAME_VIEW)
  mailQueue() {
    return this.admin.mailQueue();
  }

  @Post("mail-queue/send")
  @RequirePermissions(PERMISSIONS.GAME_MANAGE)
  sendQueued(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.sendQueued(user.id);
  }

  /** A confirmation link without the mail, for a stage round only (JATEK_TEST_LINKS=on; acrobot 44026). */
  @Post("entries/:id/test-link")
  @RequirePermissions(PERMISSIONS.GAME_MANAGE)
  testLink(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.testLink(id, user.id);
  }
}
