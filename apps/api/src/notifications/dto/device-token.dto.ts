import {
  IsIn,
  IsOptional,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

const PLATFORMS = ["IOS", "ANDROID"] as const;

export class RegisterDeviceTokenDto {
  /**
   * The raw APNs device token: 64 hexadecimal characters.
   *
   * The pattern is here to catch the one mistake that would otherwise only
   * surface in production. Expo hands out a token of its own shaped like
   * `ExponentPushToken[...]`, and a client asking for the wrong one would
   * register happily and never receive anything. This refuses it at the door,
   * and the message says which one to ask for.
   */
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message:
      "Az eszköz-token 64 hexadecimális karakter lehet. A telefon a natív APNs tokent kérje, ne az Expo tokenjét.",
  })
  token!: string;

  /**
   * Which app variant the token belongs to. Three exist (hu.acropora.os and
   * its .dev and .preview siblings), and a notification sent with the wrong
   * one is refused by Apple.
   */
  @MinLength(3, { message: "Az alkalmazás azonosítója kötelező." })
  @MaxLength(200, {
    message: "Az alkalmazás azonosítója legfeljebb 200 karakter lehet.",
  })
  bundleId!: string;

  @IsOptional()
  @IsIn(PLATFORMS, { message: "Ismeretlen eszköz-típus." })
  platform?: (typeof PLATFORMS)[number];
}
