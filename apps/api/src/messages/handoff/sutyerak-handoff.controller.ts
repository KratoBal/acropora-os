import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";

import { Public } from "../../auth/decorators/public.decorator.js";
import { MessagesService } from "../messages.service.js";
import { SutyerakHandoffReplyDto } from "./sutyerak-handoff.dto.js";
import { SutyerakHandoffGuard } from "./sutyerak-handoff.guard.js";

/**
 * A VISSZAÚT (4. pont B, 5. tétel; Balázs 08:09 UTC): amit Sutyerák nem tudott
 * megválaszolni, azt acrobotnak adta át; acrobot ezen írja vissza a választ
 * Sutyerák nevében, abba a beszélgetésbe, ahol a kérdés elhangzott (widgetnél
 * a dolgozó és Sutyerák kettes beszélgetésébe). Munkamenet nem kell, csak a
 * saját szolgáltatás-token.
 */
@Controller("assistant/handoff-reply")
@Public()
@UseGuards(SutyerakHandoffGuard)
export class SutyerakHandoffController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  @HttpCode(200)
  reply(@Body() body: SutyerakHandoffReplyDto) {
    return this.messages.handoffReply(body);
  }
}
