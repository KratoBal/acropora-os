import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from "@nestjs/common";

import { ReefClubRedeemLinkCodeDto } from "./reefclub-aquarium.dto.js";
import {
  reefClubCallerAddress,
  ReefClubRateLimits,
} from "./reefclub-rate-limits.js";
import {
  type ReefClubShopLink,
  ReefClubShopLinksService,
} from "./reefclub-shop-links.service.js";
import {
  reefClubAccountOf as accountOf,
  type ReefClubRequest,
} from "./reefclub.guard.js";

/**
 * /rc/v1/shop-links (plan v6.1, 3.3; slice 5): redeem a shop code, list the
 * active links, end one. Ending takes effect on the next request: the shop
 * aquariums of that customer are the one 404 from then on (plan 5.2 point 6).
 */
@Controller("rc/v1/shop-links")
export class ReefClubShopLinksController {
  constructor(
    private readonly links: ReefClubShopLinksService,
    private readonly limits: ReefClubRateLimits,
  ) {}

  @Post()
  redeem(
    @Req() request: ReefClubRequest,
    @Body() body: ReefClubRedeemLinkCodeDto,
  ): Promise<ReefClubShopLink> {
    const address = reefClubCallerAddress(request);
    this.limits.shopLinkByAddress.check(address);
    return this.links.redeem(accountOf(request), address, body.code);
  }

  @Get()
  async list(
    @Req() request: ReefClubRequest,
  ): Promise<{ links: ReefClubShopLink[] }> {
    return { links: await this.links.list(accountOf(request)) };
  }

  @Delete(":id")
  @HttpCode(204)
  async end(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
  ): Promise<void> {
    await this.links.end(accountOf(request), id);
  }
}
