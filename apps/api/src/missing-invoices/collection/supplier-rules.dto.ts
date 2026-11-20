import type { AcceptWithRuleInput, SupplierRuleKind } from "@acropora/types";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class AcceptWithRuleDto implements AcceptWithRuleInput {
  @IsIn(["TAX", "NAME"]) kind!: SupplierRuleKind;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendorName?: string;

  @IsOptional()
  @IsBoolean()
  alsoPending?: boolean;
}
