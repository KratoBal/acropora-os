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
import { AssetCategoriesService } from "./asset-categories.service.js";
import {
  AssetCategoryListQueryDto,
  CreateAssetCategoryDto,
  UpdateAssetCategoryDto,
} from "./dto/asset-category.dto.js";

/**
 * A KATEGORIA-TORZSADAT VEGPONTJAI.
 *
 * A KET JOGKOR KULON, es ez ugyanaz a bontas, amit a mertekegysegnel Balazs
 * mar jovahagyott: az OLVASAS a valasztoke (aki eszkozt vesz fel, annak latnia
 * kell a listat), az IRAS viszont torzsadat-karbantartas, ami a Beallitasok ala
 * tartozik.
 *
 * ES ITT EZ TOBB, MINT ELV: ha az iras is `SERVICE_VIEW` lenne, barmelyik
 * felvivo felvehetne uj kategoriat -- es pontosan az allna vissza, ami miatt
 * ez a tabla letrejott (tiz ertek hat helyett, negy elgepeles).
 */
@Controller("asset-categories")
export class AssetCategoriesController {
  constructor(private readonly service: AssetCategoriesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(@Query() query: AssetCategoryListQueryDto) {
    return this.service.list(query.includeInactive ?? false);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  create(@Body() input: CreateAssetCategoryDto) {
    return this.service.create(input);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  update(@Param("id") id: string, @Body() input: UpdateAssetCategoryDto) {
    return this.service.update(id, input);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  retire(@Param("id") id: string) {
    return this.service.retire(id);
  }
}
