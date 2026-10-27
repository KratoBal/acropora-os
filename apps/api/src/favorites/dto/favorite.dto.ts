import { IsString } from "class-validator";

/**
 * A SZERVER CSAK AZ ALAKOT ELLENŐRZI A SZERVIZBEN (`isFavoriteHref`), mert a
 * hibaüzenet magyar mondat, nem validátor-kód; itt csak az kell, hogy szöveg
 * érkezzen.
 */
export class FavoriteHrefDto {
  @IsString({ message: "A kedvenc oldal útvonalát meg kell adni." })
  href!: string;
}
