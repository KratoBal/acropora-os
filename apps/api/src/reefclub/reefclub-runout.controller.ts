import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";

import { reefClubNotFound } from "./reefclub-aquarium-access.js";
import {
  reefClubCallerAddress,
  ReefClubRateLimits,
} from "./reefclub-rate-limits.js";
import {
  ReefClubRunOutEnableDto,
  ReefClubRunOutUnsubscribeDto,
} from "./reefclub-runout.dto.js";
import {
  type RunOutReminderItem,
  type RunOutStatus,
  ReefClubRunOutService,
} from "./reefclub-runout.service.js";
import {
  reefClubAccountOf as accountOf,
  ReefClubPublic,
  type ReefClubRequest,
} from "./reefclub.guard.js";

/**
 * /rc/v1/runout-reminders (ReefClub V3.2, card cd94ed11, slice 3b): the "when does it run out" reminder, per product.
 *
 *   GET     /rc/v1/runout-reminders              the state of the three locks (and the text, only when all are open) and the
 *                                                member's reminders that are on; writes nothing
 *   POST    /rc/v1/runout-reminders              {productId, aquariumId, consentVersion}: turns it on (the consent record)
 *   DELETE  /rc/v1/runout-reminders/:productId   turns it off (204); no active reminder of the product is the one 404
 *   POST    /rc/v1/runout-reminders/unsubscribe  {key}: the mail's link, WITHOUT a session
 *
 * The account is the session's, never a field of the body. A refusal of the service is a 400 with its code (the switch is off,
 * the text is not given, the page showed an older text, the aquarium has no litres), a missing product a 404 with its code, and a
 * foreign or missing aquarium the one 404 of the aquarium routes. The turn-off answers like the shop link's end: a product the member
 * has no active reminder of is the one 404, whether another member has one or nobody does (the id sweep of
 * `reefclub-akvarium.integration.spec.ts` measures it byte for byte).
 *
 * THE UNSUBSCRIBE IS A POST, NOT A GET: a mail program's link checker opens every link of a mail, and a GET that unsubscribes
 * would turn the reminder off before the member read the mail. The link opens the ReefClub page, and the page posts the key. It
 * is public, so it goes through the guard's same-origin and JSON check like every write, and it is limited per address; a wrong
 * key is a 404 with its code (a key is an HMAC, guessing one is not a matter of tries). A missing secret is the service's loud
 * error (a 500), never an "unknown key": every link ever sent would silently stop working otherwise.
 */
@Controller("rc/v1/runout-reminders")
export class ReefClubRunOutController {
  constructor(
    private readonly runOut: ReefClubRunOutService,
    private readonly limits: ReefClubRateLimits,
  ) {}

  @Get()
  async overview(
    @Req() request: ReefClubRequest,
  ): Promise<RunOutStatus & { reminders: RunOutReminderItem[] }> {
    return {
      ...this.runOut.status(),
      reminders: await this.runOut.list(accountOf(request)),
    };
  }

  @Post()
  async enable(
    @Req() request: ReefClubRequest,
    @Body() body: ReefClubRunOutEnableDto,
  ): Promise<{ id: string }> {
    const account = accountOf(request);
    this.limits.runOutByAccount.check(account);
    const result = await this.runOut.enable(account, {
      productId: body.productId,
      aquariumId: body.aquariumId,
      consentVersion: body.consentVersion,
    });
    if (result.outcome === "ENABLED") return { id: result.id };
    const answer = { message: result.message, code: result.code };
    if (result.code === "PRODUCT_NOT_FOUND")
      throw new NotFoundException(answer);
    throw new BadRequestException(answer);
  }

  @ReefClubPublic()
  @Post("unsubscribe")
  @HttpCode(200)
  async unsubscribe(
    @Req() request: ReefClubRequest,
    @Body() body: ReefClubRunOutUnsubscribeDto,
  ): Promise<{ outcome: "UNSUBSCRIBED" | "ALREADY_UNSUBSCRIBED" }> {
    this.limits.runOutUnsubscribeByAddress.check(
      reefClubCallerAddress(request),
    );
    const result = await this.runOut.unsubscribeByKey(body.key);
    if (result.outcome === "UNKNOWN_KEY")
      throw new NotFoundException({
        message: "Ez a leiratkozó link nem érvényes.",
        code: "UNKNOWN_KEY",
      });
    return result;
  }

  @Delete(":productId")
  @HttpCode(204)
  async disable(
    @Req() request: ReefClubRequest,
    @Param("productId") productId: string,
  ): Promise<void> {
    const result = await this.runOut.disable(accountOf(request), productId);
    if (result.outcome === "NOT_ACTIVE") throw reefClubNotFound();
  }
}
