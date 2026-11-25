import { IsIn } from "class-validator";
import type { PartnerSeenArea } from "@acropora/types";

/** Which list the partner opened (card 28f31715, PR 2). */
export class PartnerSeenDto {
  @IsIn(["TICKETS", "WORKSHEETS"])
  area!: PartnerSeenArea;
}
