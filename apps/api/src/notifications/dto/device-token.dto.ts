import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

const PLATFORMS = ["IOS", "ANDROID"] as const;

export class RegisterDeviceTokenDto {
  /**
   * The raw APNs device token.
   *
   * Only the coarse shape is checked here. The 64-hexadecimal rule lives in
   * `device-token.rules.ts` and is applied by the controller, so that a
   * refusal can be written to the log: `ValidationPipe` answers before the
   * controller runs, and a rejection that leaves no trace is
   * indistinguishable from an app that was never opened. That difference is
   * what a TestFlight round is buying.
   */
  @IsString({ message: "Az eszköz-token megadása kötelező." })
  @MinLength(1, { message: "Az eszköz-token megadása kötelező." })
  @MaxLength(512, { message: "Az eszköz-token túl hosszú." })
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

/**
 * A telefon kikapcsolja magarol az ertesitest.
 *
 * A token a TORZSBEN erkezik, nem az utvonalban, es ez nem stilus: a token
 * hitelesito adat egy valaki telefonjahoz, az utvonal viszont bekerul a
 * hozzaferesi naplokba. Ugyanaz a szabaly, amiert a vezerlo sem naplozza.
 */
export class ForgetDeviceTokenDto {
  @IsString({ message: "Az eszköz-token megadása kötelező." })
  @MinLength(1, { message: "Az eszköz-token megadása kötelező." })
  @MaxLength(512, { message: "Az eszköz-token túl hosszú." })
  token!: string;
}
