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
 *
 * === 2026-09-21: A SZABÁLY PLATFORM-ÁGRA BOMLIK ===
 *
 * Élesen nulla androidos eszköz-token állt három iOS mellett. Az ok nem a
 * telefon engedélye és nem a Firebase beállítás volt, hanem EZ a szabály: 64
 * hexadecimális karaktert követelt, platform-ág nélkül, tehát bármi, amit az
 * Android visszaad, elbukott rajta.
 *
 * AMIT A REPÓBÓL BIZONYÍTANI LEHET: hogy a régi szabály mindent elutasít, ami
 * nem 64 hex. AMIT NEM: hogy egy FCM token pontosan milyen alakú -- az a
 * Firebase-ről szóló tudás, nem a mi kódunkról.
 *
 * EZÉRT AZ ANDROID ÁG NEM ÍR ELŐ MINTÁT. Csak azt zárja ki, amiről TUDJUK,
 * hogy rossz: az Expo-tokent, ami az eredeti hiba volt. A két tévedés ára itt
 * sem egyforma, és fordítva áll, mint a küldőnél:
 *
 *   egy SZŰK minta      CSENDBEN dobná el a valódi tokent, és megint nulla
 *                       androidos eszközünk lenne, ugyanazzal a tünettel
 *   egy TÁG kizárás     legfeljebb beenged valamit, ami a KÜLDÉSNÉL hasal el --
 *                       és ott HANGOS, mert az FCM válasza megnevezi
 *
 * A HOSSZ NEM ITT ÁLL, és ez szándékos: a `RegisterDeviceTokenDto` már
 * korlátozza (1..512). Egy második hosszhatár itt ugyanazt a megkötést vinné
 * két helyen, és a kettő egyszer elcsúszna.
 */

export type DeviceTokenPlatform = "IOS" | "ANDROID";

/** A raw APNs token: 32 bytes, written as 64 hexadecimal characters. */
export function isNativeDeviceToken(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

/**
 * MILYEN ALAKÚ EZ A TOKEN -- A TOKEN KIÍRÁSA NÉLKÜL.
 *
 * SZÁNDÉKOSAN UGYANAZ AZ ALAK, mint a telefonon (`push-registration.ts`,
 * `describeTokenShape`, murena, 2026-09-21). A két oldal leírása így
 * ÖSSZEVETHETŐ: ha a készülék azt mondja, amit a szerver, akkor a token
 * változatlanul ért át; ha nem, akkor a különbség maga a lelet.
 *
 * A TOKEN MAGA SOSEM KERÜL NAPLÓBA. Hitelesítő adat valakinek a telefonjához,
 * és a naplót többen olvassák, mint az eszköz-táblát -- ugyanaz a szabály,
 * amit a kiosztási esemény is követ.
 *
 * ÉS EZ TÖBB, MINT NAPLÓZÁS: ettől a SZERVER mondja meg, milyen alakú az első
 * valódi androidos token, amint egy készülék regisztrál. Nem kell megvárni,
 * hogy valaki felolvassa egy képernyőről -- és ha kiderül, hogy a tényleges
 * alak szűkebb, a szabály UTÁNA szűkíthető, méréssel.
 */
export function describeTokenShape(value: string): string {
  const hossz = value.length;
  const jelek: string[] = [];
  if (/^[0-9a-fA-F]+$/.test(value)) jelek.push("csak hexadecimális");
  if (value.includes(":")) jelek.push("kettőspontot tartalmaz");
  if (value.includes("_")) jelek.push("aláhúzást tartalmaz");
  if (value.includes("-")) jelek.push("kötőjelet tartalmaz");
  if (value.startsWith("ExponentPushToken")) jelek.push("Expo-token");
  return jelek.length
    ? `${hossz} karakter, ${jelek.join(", ")}`
    : `${hossz} karakter`;
}

export type DeviceTokenAcceptance =
  { ok: true } | { ok: false; reason: "expo-token" | "not-apns" };

/**
 * BEFOGADHATÓ-E EZ A TOKEN EZEN A PLATFORMON.
 *
 * Az OK megnevezve tér vissza, nem igen/nem alakban: a hívónak két különböző
 * mondatot kell mondania. Az Expo-token azt jelenti, hogy a telefon ROSSZ
 * hívást használ; a nem-APNs alak iOS-en azt, hogy a token nem az, aminek
 * hisszük. A két teendő más, és egy közös mondat egyikre sem igaz.
 */
export function acceptDeviceToken(input: {
  token: string;
  platform: DeviceTokenPlatform;
}): DeviceTokenAcceptance {
  /**
   * AZ EXPO-TOKEN MINDKÉT PLATFORMON ROSSZ, és ezért áll az ág ELŐTT.
   *
   * Ez volt az eredeti hiba: a telefon az Expo tokenjét kérte a natív helyett.
   * Egy platformonként megismételt tiltólista ugyanazt a szabályt vinné két
   * helyen -- és egyszer az egyik maradna le.
   */
  if (input.token.startsWith("ExponentPushToken"))
    return { ok: false, reason: "expo-token" };

  if (input.platform === "IOS")
    return isNativeDeviceToken(input.token)
      ? { ok: true }
      : { ok: false, reason: "not-apns" };

  // ANDROID: mintát nem írunk elő -- lásd a fájl fejlécét.
  return { ok: true };
}

/**
 * A TÁROLT ALAK. CSAK AZ APNS TOKEN KISBETŰS.
 *
 * MÉRT HIBA LETT VOLNA: a vezérlő eddig MINDEN tokenre `toLowerCase()`-t hívott.
 * Hexadecimális értéknél ez ártalmatlan normalizálás; egy FCM token viszont
 * KIS- ÉS NAGYBETŰRE ÉRZÉKENY, tehát ugyanez a hívás elrontaná -- és a hiba
 * csak a küldésnél derülne ki, egy `INVALID_ARGUMENT` alakjában, ami úgy néz
 * ki, mintha a készülék adott volna rossz tokent.
 */
export function storedTokenForm(input: {
  token: string;
  platform: DeviceTokenPlatform;
}): string {
  return input.platform === "IOS" ? input.token.toLowerCase() : input.token;
}

export const DEVICE_TOKEN_SHAPE_MESSAGE =
  "Az eszköz-token 64 hexadecimális karakter lehet. A telefon a natív APNs tokent kérje, ne az Expo tokenjét.";

/**
 * AZ EXPO-TOKEN SAJÁT MONDATA.
 *
 * A mai közös mondat („64 hexadecimális karakter lehet") ANDROIDON HAMIS
 * lenne: ott nem ez a szabály. Egy igaznak látszó, de rossz magyarázat rosszabb
 * a hiányzónál -- aki olvassa, a rossz irányba indul el, és sosem jut el az
 * igazi okhoz. Ugyanaz a fajta hiba, amit a telefon beállítás-képernyőjén is
 * javítani kellett.
 */
export const DEVICE_TOKEN_EXPO_MESSAGE =
  "A telefon az Expo push tokenjét küldte. A natív eszköz-token kell helyette (iOS-en APNs, Androidon FCM).";
