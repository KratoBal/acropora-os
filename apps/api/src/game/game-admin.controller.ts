import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
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
  constructor(private readonly admin: GameAdminService) {}

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
