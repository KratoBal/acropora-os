/**
 * What a device token has to look like, kept where a test can reach it and
 * where the controller can log the answer either way.
 *
 * The rule used to live on the DTO alone. That refused a bad token correctly,
 * but silently: `ValidationPipe` answers before the controller runs, so a
 * refusal left no trace at all, and a rejected registration looked exactly
 * like an app that was never opened. During a TestFlight round those two are
 * the difference between "the client asks for the wrong token" and "nothing
 * happened", and each wrong guess costs a build.
 */

/** A raw APNs token: 32 bytes, written as 64 hexadecimal characters. */
export function isNativeDeviceToken(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

export const DEVICE_TOKEN_SHAPE_MESSAGE =
  "Az eszköz-token 64 hexadecimális karakter lehet. A telefon a natív APNs tokent kérje, ne az Expo tokenjét.";
