import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from "@nestjs/common";

import { Public } from "../auth/decorators/public.decorator.js";
import { callerAddress, IpRateLimiter } from "../common/ip-rate-limit.js";
import { GameConfirmDto, GameEntryDto } from "./game-public.dto.js";
import { gameError, GameService } from "./game.service.js";

type CallerRequest = Parameters<typeof callerAddress>[0];

/** The limit, answered in the contract's shape (`TOO_MANY`), not the shared limiter's bare message. */
function limit(limiter: IpRateLimiter, request: CallerRequest): void {
  if (!limiter.hit(callerAddress(request)))
    throw gameError(
      HttpStatus.TOO_MANY_REQUESTS,
      "TOO_MANY",
      "Túl sok kérés. Próbáld újra egy perc múlva.",
    );
}

/**
 * THE GIVEAWAY'S PUBLIC ENDPOINTS (card 31445d0f), without a login; the contract with the page is
 * exchange/jatek/jatek-api-szerzodes.md. The page's server calls them and passes the visitor's address in
 * `X-Forwarded-For`; each is limited per caller and in total, the entry most tightly, since it writes and mails.
 */
@Controller("jatek")
export class GamePublicController {
  static readonly reads = new IpRateLimiter(60, 3000);
  static readonly entries = new IpRateLimiter(10, 600);
  static readonly confirms = new IpRateLimiter(20, 1200);

  constructor(private readonly game: GameService) {}

  @Public()
  @Get("aktualis")
  @Header("Cache-Control", "no-store")
  current(@Req() request: CallerRequest) {
    limit(GamePublicController.reads, request);
    return this.game.current();
  }

  @Public()
  @Post("bekuldes")
  @HttpCode(202)
  submit(@Body() input: GameEntryDto, @Req() request: CallerRequest) {
    limit(GamePublicController.entries, request);
    return this.game.submit(input);
  }

  @Public()
  @Post("megerosites")
  @HttpCode(200)
  confirm(@Body() input: GameConfirmDto, @Req() request: CallerRequest) {
    limit(GamePublicController.confirms, request);
    return this.game.confirm(input);
  }
}
