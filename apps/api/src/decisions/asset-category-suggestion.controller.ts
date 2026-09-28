import { Body, Controller, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ASSET_KINDS } from "../service-assets/dto/asset.dto.js";
import { requireInternalWriter } from "../worksheets/worksheet-internal-write.js";
import { AssetCategorySuggestionService } from "./asset-category-suggestion.service.js";

/**
 * AZ URLAP MEZOI, AMIKBOL A VETULET EPUL -- a letrehozo DTO reszhalmaza, ugyanazzal
 * a `clientOperationId`-alakkal, mint a letrehozasnal (lasd `CreateAssetDto`).
 */
export class AssetCategorySuggestionDto {
  @Matches(/^[A-Za-z0-9_.:-]{8,128}$/)
  clientOperationId!: string;
  @IsString() @MinLength(1) @MaxLength(300) name!: string;
  @IsString() @IsOptional() @MaxLength(300) manufacturer?: string;
  @IsString() @IsOptional() @MaxLength(300) model?: string;
  @IsIn(ASSET_KINDS) @IsOptional() kind?: (typeof ASSET_KINDS)[number];
  @IsString() @IsOptional() @MaxLength(40) performance?: string;
  @IsString() @IsOptional() performanceUnitId?: string;
  @IsString() @IsOptional() @MaxLength(40) powerConsumption?: string;
  @IsString() @IsOptional() parentAssetId?: string;
  @IsString() @IsOptional() departmentId?: string;
}

/**
 * A KATEGORIA-JAVASLAT A LETREHOZO URLAPHOZ (Jev V1 pilot, #1199 P-012/P-013).
 *
 * CSAK BELSO FELHASZNALO: a pilot a belso webes felulet (P-013); a partner
 * portal es a mobil kimarad. A `SERVICE_MANAGE` jogot a partner szerviz
 * szerep is viseli, ezert kulon szukites all ra.
 *
 * A VALASZ SOHA NEM HIBA: kikapcsolt pilot, Jev-hiba vagy idotullepes egyarant
 * `categoryId: null`, es az urlap ugy halad tovabb, mint javaslat nelkul.
 */
@Controller("service/assets/category-suggestion")
export class AssetCategorySuggestionController {
  constructor(private readonly service: AssetCategorySuggestionService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  suggest(
    @Body() input: AssetCategorySuggestionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    requireInternalWriter(user, "A kategória-javaslat");
    const { clientOperationId, ...fields } = input;
    return this.service.suggest(clientOperationId, fields);
  }
}
