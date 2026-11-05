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
import { type callerAddress, IpRateLimiter } from "../common/ip-rate-limit.js";
import { GameConfirmDto, GameEntryDto } from "./game-public.dto.js";
import { gameError, GameService } from "./game.service.js";

type CallerRequest = Parameters<typeof callerAddress>[0];

/**
 * The address a forged header cannot move: the LAST `X-Forwarded-For` hop, which our own proxy appended (the first ones
 * are whatever the caller wrote; barracuda and acrobot on #2254). Behind the game page's server every visitor shares
 * that server's address, so for the entry this limit is in effect one shared ceiling; what keeps one address from being
 * flooded with mail is the service's pace per address and question, which no header changes.
 */
export function lastHopAddress(request: CallerRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const hops = (
    Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? "")
  )
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.at(-1) || request.ip || "unknown";
}

/** The limit, answered in the contract's shape (`TOO_MANY`), not the shared limiter's bare message. */
function limit(limiter: IpRateLimiter, request: CallerRequest): void {
  if (!limiter.hit(lastHopAddress(request)))
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
  /** the entry writes and mails: 120 a minute in all (a first week's busiest minute is far below it) */
  static readonly entries = new IpRateLimiter(120, 120);
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
