import type { WebshopOrderLineEdit } from "@acropora/types";
import {
  IsIn,
  IsInt,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

/** Egy tételművelet törzse; a `kind` dönti el, mi kötelező. */
export class WebshopOrderLineEditDto {
  @IsIn(["quantity", "remove", "replace"])
  kind!: WebshopOrderLineEdit["kind"];

  @ValidateIf((body: WebshopOrderLineEditDto) => body.kind !== "remove")
  @IsInt()
  @Min(1)
  quantity?: number;

  @ValidateIf((body: WebshopOrderLineEditDto) => body.kind === "replace")
  @IsString()
  @MinLength(1)
  variantId?: string;
}

/** A validált törzs a művelet alakjára. */
export function lineEditOf(
  body: WebshopOrderLineEditDto,
): WebshopOrderLineEdit {
  if (body.kind === "remove") return { kind: "remove" };
  if (body.kind === "replace")
    return {
      kind: "replace",
      variantId: body.variantId!,
      quantity: body.quantity!,
    };
  return { kind: "quantity", quantity: body.quantity! };
}
