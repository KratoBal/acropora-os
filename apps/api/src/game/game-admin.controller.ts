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
 * THE GIVEAWAY'S ADMIN (card 31445d0f, slice 2). The rights are the content's: the giveaway is marketing content, and
 * the people who run it (Balázs, Luca) hold them. Reading needs CONTENT_VIEW; a question, a decision on an answer and a
 * draw need CONTENT_MANAGE.
 */
@Controller("game")
export class GameAdminController {
  constructor(private readonly admin: GameAdminService) {}

  @Get("questions")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  questions() {
    return this.admin.questions();
  }

  @Post("questions")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  createQuestion(@Body() input: GameQuestionDto) {
    return this.admin.createQuestion(input);
  }

  @Put("questions/:id")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  updateQuestion(@Param("id") id: string, @Body() input: GameQuestionDto) {
    return this.admin.updateQuestion(id, input);
  }

  @Get("questions/:id/entries")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  entries(@Param("id") id: string) {
    return this.admin.entries(id);
  }

  @Put("entries/:id/decision")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  decide(
    @Param("id") id: string,
    @Body() input: GameDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.decide(id, input.correct ?? null, user.id);
  }

  @Get("draws")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  draws() {
    return this.admin.draws();
  }

  @Post("draws")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  draw(@Body() input: GameDrawDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.draw(input, user.id);
  }

  @Post("draws/:id/verify")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  verify(@Param("id") id: string) {
    return this.admin.verify(id);
  }
}
