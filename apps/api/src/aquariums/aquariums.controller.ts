import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { AquariumsService } from "./aquariums.service.js";
import {
  AquariumListQueryDto,
  AquariumSelectableCustomerQueryDto,
  CreateAquariumDto,
  CreateAquariumEquipmentDto,
  UpdateAquariumDto,
} from "./dto/aquarium.dto.js";

@Controller("aquariums")
export class AquariumsController {
  constructor(private readonly service: AquariumsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AQUARIUMS_VIEW)
  list(@Query() query: AquariumListQueryDto) {
    return this.service.list(query);
  }

  /**
   * A MEGLÉVŐ ÜGYFÉL KERESÉSE, AZ AKVÁRIUM FELVITEL VÁLASZTÓJÁHOZ.
   *
   * A FIX SZAKASZ A `:id` FÖLÖTT ÁLL, mint a `service-assets` `owners` vagy a
   * `worksheets` `selectable-partners` végpontja -- különben a Nest a
   * "customers" szót akvárium-azonosítónak olvasná.
   */
  @Get("customers")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_VIEW)
  selectableCustomers(@Query() query: AquariumSelectableCustomerQueryDto) {
    return this.service.searchSelectableCustomers(query.search);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_VIEW)
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  create(
    @Body() input: CreateAquariumDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateAquariumDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }

  @Post(":id/equipment")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  addEquipment(
    @Param("id") id: string,
    @Body() input: CreateAquariumEquipmentDto,
  ) {
    return this.service.addEquipment(id, input);
  }

  @Delete(":id/equipment/:equipmentId")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  removeEquipment(
    @Param("id") id: string,
    @Param("equipmentId") equipmentId: string,
  ) {
    return this.service.removeEquipment(id, equipmentId);
  }
}
