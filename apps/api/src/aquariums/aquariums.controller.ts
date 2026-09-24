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
import { AquariumMaintainersService } from "./aquarium-maintainers.service.js";
import { AquariumMeasurementsService } from "./aquarium-measurements.service.js";
import { AquariumsService } from "./aquariums.service.js";
import {
  AquariumListQueryDto,
  AquariumSelectableCustomerQueryDto,
  CreateAquariumDto,
  CreateAquariumEquipmentDto,
  UpdateAquariumDto,
} from "./dto/aquarium.dto.js";
import {
  CreateAquariumMeasurementDto,
  SetAquariumMaintainersDto,
} from "./dto/aquarium-measurement.dto.js";

@Controller("aquariums")
export class AquariumsController {
  constructor(
    private readonly service: AquariumsService,
    private readonly measurements: AquariumMeasurementsService,
    private readonly maintainers: AquariumMaintainersService,
  ) {}

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

  /**
   * STATIKUS ÚTVONAL A `:id` ELŐTT -- egyébként a "maintainers" szó a
   * `:id` paraméterbe esne. Lásd `worksheets.controller.ts`
   * `assignable-users`-ét, ugyanez a minta.
   */
  @Get("maintainers/selectable")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  selectableMaintainers() {
    return this.maintainers.selectable();
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

  @Get(":id/measurements")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_VIEW)
  listMeasurements(@Param("id") id: string) {
    return this.measurements.list(id);
  }

  @Post(":id/measurements")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  createMeasurement(
    @Param("id") id: string,
    @Body() input: CreateAquariumMeasurementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.measurements.create(id, input, user.id);
  }

  /**
   * AZ `occasionId` A MÉRÉSI ALKALOM `measuredAt` ÉRTÉKÉNEK ISO-ALAKJA,
   * URL-KÓDOLVA -- lásd `aquarium-measurements.repository.ts` fejlécét,
   * miért nincs külön azonosító.
   */
  @Delete(":id/measurements/:occasionId")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  deleteMeasurement(
    @Param("id") id: string,
    @Param("occasionId") occasionId: string,
  ) {
    return this.measurements.delete(id, occasionId);
  }

  @Patch(":id/maintainers")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  setMaintainers(
    @Param("id") id: string,
    @Body() input: SetAquariumMaintainersDto,
  ) {
    return this.maintainers.set(id, input.userIds);
  }
}
