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

import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  CreateUnitOfMeasureDto,
  UnitOfMeasureListQueryDto,
  UpdateUnitOfMeasureDto,
} from "./dto/unit-of-measure.dto.js";
import { UnitsService } from "./units.service.js";

/**
 * A MERTEKEGYSEG-TORZSADAT VEGPONTJAI.
 *
 * AZ UTVONAL `units-of-measure`, NEM `units`. A rendszerben a "unit" szo a
 * SZERVEZETI EGYSEGET (helyszint) jelenti -- az `Asset.unitId` az, es a webes
 * felulet `UnitPicker`-rel valasztja. Egy `/units` utvonal mellett a kettot
 * semmi nem kulonboztetne meg a naplokban es a kliensekben sem.
 *
 * A KET JOGKOR KULON, ES EZ NEM ovatoskodas: az OLVASAS a valasztoke (aki
 * eszkozt szerkeszt, annak latnia kell a listat), az IRAS viszont torzsadat-
 * karbantartas, ami a Beallitasok ala tartozik. Ha az iras is `SERVICE_VIEW`
 * lenne, barmelyik szerelo felvihetne uj egyseget -- es a lista harom nap alatt
 * ot fele "ora" valtozatot tartalmazna.
 */
@Controller("units-of-measure")
export class UnitsController {
  constructor(private readonly service: UnitsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(@Query() query: UnitOfMeasureListQueryDto) {
    return this.service.list(query.kind, query.includeInactive ?? false);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  create(@Body() input: CreateUnitOfMeasureDto) {
    return this.service.create(input);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  update(@Param("id") id: string, @Body() input: UpdateUnitOfMeasureDto) {
    return this.service.update(id, input);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
