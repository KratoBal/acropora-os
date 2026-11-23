import { IsString, Matches, MaxLength } from "class-validator";

/**
 * A "NEM A MI FIÓKUNK" ÍTÉLET VISSZAVONÁSA (acrobot 58207): a sorozat neve, ahogy a lap mutatja (`ACRW-2026` vagy az előtag nélküli
 * `2026`). Szabad szöveg nem fogadott: a név alakja kötött, mert egy tábla-sor törlését vezérli.
 */
export class FeedBackfillRecheckDto {
  @IsString()
  @MaxLength(40)
  @Matches(/^(?:[A-Za-z0-9]+-)?\d{4}$/, {
    message: "A sorozat neve ELŐTAG-ÉÉÉÉ vagy ÉÉÉÉ alakú.",
  })
  series!: string;
}
