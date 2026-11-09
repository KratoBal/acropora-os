import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  Matches,
} from "class-validator";

/**
 * A behúzandó számok: PONTOS számlaszámok (`ACRW-2026/00469`, `2026/00083`), legfeljebb 10 egy kérésben, mert minden
 * szám egy Számlázz.hu-lekérdezés. `apply`: false a száraz előnézet, true a behúzás.
 */
export class FeedPullDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Matches(/^(?:[A-Z]+-)?\d{4}\/\d+$/, {
    each: true,
    message: "Pontos számlaszám kell, például ACRW-2026/00469.",
  })
  numbers!: string[];

  @IsBoolean()
  apply!: boolean;
}
