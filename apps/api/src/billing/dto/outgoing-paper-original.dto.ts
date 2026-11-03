import { IsBoolean } from "class-validator";

/** „Papíron megvan” jelölés be- vagy kikapcsolása egy kimenő számlán. */
export class OutgoingPaperOriginalDto {
  @IsBoolean()
  marked!: boolean;
}
