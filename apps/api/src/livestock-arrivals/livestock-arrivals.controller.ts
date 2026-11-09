import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  CreateLivestockArrivalDto,
  LivestockArrivalListQueryDto,
  LivestockArrivalOptionQueryDto,
  UpdateLivestockArrivalDto,
} from "./dto/livestock-arrival.dto.js";
import { LivestockArrivalsService } from "./livestock-arrivals.service.js";

/**
 * THE LIVE ANIMAL ARRIVALS (card f4e4832b, V2.6 S2). Reading is `inventory.view`, writing `inventory.manage`: the same
 * people who keep the shop's stock keep what is coming (no new permission, so no new role decision). No DELETE: a mistaken
 * or called-off arrival is set to CANCELLED, and the row stays as the history of what was announced.
 */
@Controller("livestock-arrivals")
export class LivestockArrivalsController {
  constructor(private readonly service: LivestockArrivalsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  list(@Query() query: LivestockArrivalListQueryDto) {
    return this.service.list(query);
  }

  /** BEFORE `:id`: Nest matches in declaration order, and `options` would be taken for an id. */
  @Get("options/products")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  productOptions(@Query() query: LivestockArrivalOptionQueryDto) {
    return this.service.productOptions(query.q);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  create(
    @Body() input: CreateLivestockArrivalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  update(@Param("id") id: string, @Body() input: UpdateLivestockArrivalDto) {
    return this.service.update(id, input);
  }
}
