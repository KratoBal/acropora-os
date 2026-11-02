import { IsBoolean } from "class-validator";

/** „Papíron megvan” jelölés be- vagy kikapcsolása egy bejövő számlán. */
export class IncomingPaperOriginalDto {
  @IsBoolean()
  marked!: boolean;
}
