import { createHash, timingSafeEqual } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  StreamableFile,
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

const header = (request: CallerRequest, name: string): string => {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
};

/**
 * THE VISITOR, AS THE GAME PAGE'S SERVER VOUCHES FOR IT (acrobot, 2026-11-05 22:57): the page's server sends the
 * visitor's address in `X-Jatek-Client-IP`, with the shared secret in `X-Jatek-Proxy-Secret` (JATEK_PROXY_SECRET in
 * both apps). With the secret the limit is per visitor; without it (a direct caller, a wrong or missing secret) the
 * key is the last hop, which a caller cannot write.
 */
export function clientKey(
  request: CallerRequest,
  secret: string | undefined = process.env.JATEK_PROXY_SECRET,
): string {
  const given = header(request, "x-jatek-proxy-secret");
  const client = header(request, "x-jatek-client-ip");
  if (
    secret &&
    given &&
    client.length > 0 &&
    client.length <= 45 &&
    /^[0-9A-Fa-f:.]+$/.test(client)
  ) {
    const a = createHash("sha256").update(secret).digest();
    const b = createHash("sha256").update(given).digest();
    if (timingSafeEqual(a, b)) return `jatek:${client}`;
  }
  return lastHopAddress(request);
}

/** The limit, answered in the contract's shape (`TOO_MANY`), not the shared limiter's bare message. */
function limit(limiter: IpRateLimiter, request: CallerRequest): void {
  if (!limiter.hit(clientKey(request)))
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
  /*
    Per visitor (the page's vouched address) and in all. The total is sized for a campaign's first minute (barracuda,
    #2254 v2); without the secret every page visitor shares the last hop, and then the per-visitor number is all
    there is, so the secret must be set on both apps. A read and a confirmation send no mail, and a 256-bit token
    cannot be guessed; the entry's mail has its own pace and daily cap in the service.
  */
  static readonly reads = new IpRateLimiter(60, 6000);
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

  /** The past winners by their shortened names (never an address). */
  @Public()
  @Get("nyertesek")
  @Header("Cache-Control", "no-store")
  winners(@Req() request: CallerRequest) {
    limit(GamePublicController.reads, request);
    return this.game.winners();
  }

  /** A question's prize picture, only for a question that is public (it has opened, or is the next one). */
  @Public()
  @Get("nyeremeny-kep/:questionId")
  @Header("Cache-Control", "public, max-age=300")
  async prizeImage(
    @Param("questionId") questionId: string,
    @Req() request: CallerRequest,
  ) {
    limit(GamePublicController.reads, request);
    const image = await this.game.prizeImage(questionId.slice(0, 64));
    if (!image)
      throw gameError(HttpStatus.NOT_FOUND, "NO_IMAGE", "Nincs ilyen kép.");
    return new StreamableFile(image.bytes, {
      type: image.contentType,
      length: image.bytes.byteLength,
    });
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
