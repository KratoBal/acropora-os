import { Module } from "@nestjs/common";

import { AssetCategorySuggestionController } from "./asset-category-suggestion.controller.js";
import { AssetCategorySuggestionService } from "./asset-category-suggestion.service.js";
import { DecisionRunRepository } from "./decision-run.repository.js";

/**
 * A JEV-DONTESEK (V1 pilot, #1199 P-012). Az eszkoz-modul importalja, hogy a
 * letrehozas utan a futast feloldhassa; a javaslat-vegpont itt all.
 */
@Module({
  controllers: [AssetCategorySuggestionController],
  providers: [DecisionRunRepository, AssetCategorySuggestionService],
  exports: [AssetCategorySuggestionService],
})
export class DecisionsModule {}
