import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  NAVIGATION_ENV,
  reefClubLinkingOn,
} from "../auth/navigation-features.js";
import {
  AquariumReefClubService,
  type CustomerReefClubLink,
  type IssuedLinkCode,
} from "./aquarium-reefclub.service.js";
import { IssueReefClubLinkCodeDto } from "./dto/aquarium-reefclub.dto.js";

/**
 * THE OS SIDE OF A CUSTOMER'S REEFCLUB LINKS (ReefClub plan v6.1, 3.3; slice
 * 5), under the aquarium routes because the aquarium right governs them. Not
 * on the public gateway: these run in the internal process only.
 */
@Controller("aquariums/customers/:customerId")
export class AquariumReefClubController {
  constructor(
    private readonly reefclub: AquariumReefClubService,
    /**
     * AZ ÉLES KAPCSOLÓ (acrobot 34365): a kódkiadás, a linkek listája és megszüntetése csak ott él,
     * ahol a ReefClub fut (`reefClubLinkingOn`). Kikapcsolva minden végpont 404, mintha nem lenne:
     * élesen így egy kódot sem lehet kiadni, és lokálhosztos levél sem mehet ki.
     */
    @Optional()
    @Inject(NAVIGATION_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  private requireLinking(): void {
    if (!reefClubLinkingOn(this.environment)) throw new NotFoundException();
  }

  @Post("reefclub-link-code")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  issueCode(
    @Param("customerId") customerId: string,
    @Body() body: IssueReefClubLinkCodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<IssuedLinkCode> {
    this.requireLinking();
    return this.reefclub.issueCode(customerId, body.sendEmail ?? false, user);
  }

  @Get("reefclub-links")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  async links(
    @Param("customerId") customerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ links: CustomerReefClubLink[] }> {
    this.requireLinking();
    return { links: await this.reefclub.links(customerId, user) };
  }

  @Delete("reefclub-links/:linkId")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  async endLink(
    @Param("customerId") customerId: string,
    @Param("linkId") linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    this.requireLinking();
    await this.reefclub.endLink(customerId, linkId, user);
  }
}
