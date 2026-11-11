import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";

/**
 * `apply` IS `false` WHEN IT IS MISSING: the route answers what WOULD change and writes nothing. The
 * `Transform` is needed because a query is always text: `"false"` through `Boolean(...)` would be true
 * (the same trap `UnasProductSyncQueryDto` names).
 */
export class UnasWebshopSellableReconcileQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  apply = false;
}
