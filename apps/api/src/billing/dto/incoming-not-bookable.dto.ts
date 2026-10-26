import { IsBoolean } from "class-validator";

/** „Nem könyvelendő” jelölés be- vagy kikapcsolása egy bejövő számlán. */
export class IncomingNotBookableDto {
  @IsBoolean()
  notBookable!: boolean;
}
