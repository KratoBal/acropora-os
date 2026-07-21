import { Type } from "class-transformer";
import { IsNumber, Min } from "class-validator";

export class UpdateInventoryCountLineDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  countedQty!: number;
}
