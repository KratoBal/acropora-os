import { IsString, Matches, MaxLength } from "class-validator";

/**
 * The run-out reminder's request bodies (ReefClub V3.2, endpoints). Real classes: the global `ValidationPipe` refuses an unknown
 * field. The ids are checked for shape only; whether the aquarium is the member's is the access function's answer (the one 404),
 * whether the product exists is the foreign key's.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ID_MESSAGE =
  "Az azonosító 1-64 karakter lehet: betű, szám, kötőjel és aláhúzás.";

export class ReefClubRunOutEnableDto {
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  productId!: string;

  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  aquariumId!: string;

  /** The version of the consent text the page showed; only the server's current one records anything. */
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,40}$/)
  consentVersion!: string;
}

/** The key of a mail's unsubscribe link (`<reminder id>.<HMAC>`); its content is checked by the service, not here. */
export class ReefClubRunOutUnsubscribeDto {
  @IsString()
  @MaxLength(200)
  key!: string;
}
