import { IsBoolean } from "class-validator";

/** A feed visszatöltése (6fd8c574): `apply: false` a száraz kör (csak kérdez), `true` a behúzás. */
export class FeedBackfillDto {
  @IsBoolean()
  apply!: boolean;
}
