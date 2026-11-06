import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  CreateRentalDto,
  RentalCustomerMatchQueryDto,
  RentalListQueryDto,
} from "./dto/rental.dto.js";
import { RentalsService } from "./rentals.service.js";

/**
 * THE RENTAL DESK (task eszkozberles, S2): reads under `rentals.view`, recording under `rentals.manage` (OWNER, ADMIN,
 * MANAGER, SALES; acrobot 44216). The desk reads the devices and the matching customers through its own routes, so it needs
 * neither `settings.manage` (the equipment master) nor `customers.view`.
 *
 * The static routes stand before `:id`, so `customer-matches` is never read as an id.
 */
@Controller("rentals")
export class RentalsController {
  constructor(private readonly service: RentalsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.RENTALS_VIEW)
  list(@Query() query: RentalListQueryDto) {
    return this.service.list(query);
  }

  @Get("available-equipment")
  @RequirePermissions(PERMISSIONS.RENTALS_VIEW)
  availableEquipment() {
    return this.service.availableEquipment();
  }

  @Get("customer-matches")
  @RequirePermissions(PERMISSIONS.RENTALS_VIEW)
  customerMatches(@Query() query: RentalCustomerMatchQueryDto) {
    return this.service.customerMatches(query);
  }

  /** The contract PDF, inline: the desk prints it straight from the browser (S3). */
  @Get(":id/contract.pdf")
  @RequirePermissions(PERMISSIONS.RENTALS_VIEW)
  @Header("Cache-Control", "private, no-store")
  async contract(@Param("id") id: string) {
    const document = await this.service.contract(id, new Date());
    return new StreamableFile(document.bytes, {
      type: "application/pdf",
      length: document.bytes.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    });
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.RENTALS_VIEW)
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.RENTALS_MANAGE)
  create(
    @Body() input: CreateRentalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }
}
