/**
 * What to do with what the system answered, kept away from the native module
 * so a test can reach it.
 *
 * Every branch here ends the same way for the person holding the phone:
 * nothing on screen. A colleague who declines notifications has declined them,
 * and an app that argues about it is worse than one that stays quiet. The
 * outcomes exist so the caller can log the difference, not so it can nag.
 */
import type { DevicePlatform } from "./push-platform";

export type PushRegistrationOutcome =
  /** A token was obtained and can be sent to the server. */
  | { status: "ready"; token: string }
  /** The person said no, or has not been asked and cannot be. */
  | { status: "declined" }
  /** No push on this device at all: a simulator, or a build without the entitlement. */
  | { status: "unavailable" }
  /** Something answered wrongly. Worth a log line, not a screen. */
  | { status: "failed"; reason: string };

export interface PermissionAnswer {
  granted: boolean;
  canAskAgain: boolean;
}

/**
 * A token from Apple is 32 bytes, written as 64 hexadecimal characters.
 *
 * This is checked on the phone as well as on the server, and not out of
 * distrust: `expo-notifications` can hand back an Expo token
 * (`ExponentPushToken[...]`) from the neighbouring call, and a build that
 * asked for the wrong one would register happily and then never receive
 * anything. The failure would surface months later, in production, as
 * "notifications do not work" with nothing to point at.
 */
export function isNativeDeviceToken(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

/**
 * BEFOGADHATO-E EZ A TOKEN EZEN A PLATFORMON.
 *
 * === SZANDEKOSAN UGYANAZ AZ ALAK, MINT A SZERVEREN ===
 *
 * A parja: `apps/api/src/notifications/device-token.rules.ts`, ugyanezzel a
 * nevvel es ugyanezekkel az okokkal. Ez nem masolas kenyelembol: a ket oldal
 * UGYANAZT A SZABALYT futtatja, es 2026-09-21-ig mind a ketto 64 hexet kovetelt,
 * platform-ag nelkul. Ha a ket alak elcsuszik, a kovetkezo ember az egyiket
 * fogja megtalalni, es azt hiszi, kesz.
 *
 * === AZ ANDROID AG NEM IR ELO MINTAT ===
 *
 * Hogy egy FCM token pontosan milyen alaku, az a Firebase-rol szolo tudas, nem
 * errol a kodrol. Ezert az ag csak azt zarja ki, amirol TUDJUK, hogy rossz: az
 * Expo-tokent, ami az eredeti hiba volt.
 *
 *   egy SZUK minta      CSENDBEN dobna el a valodi tokent, es megint nulla
 *                       androidos eszkozunk lenne, ugyanazzal a tunettel
 *   egy TAG kizaras     legfeljebb beenged valamit, ami a KULDESNEL hasal el --
 *                       es ott HANGOS, mert az FCM valasza megnevezi
 *
 * HOSSZHATAR NINCS, es ez dontes (acrobot, 2026-09-21): egy hosszhatar, amit
 * nem mertunk, ugyanugy neman dob, mint a 64-hex. A felso hatart a szerver DTO
 * adja (1..512). Az URES eset viszont bent van: az nem hosszhatar, hanem az az
 * allitas, hogy az ures ertek nem token.
 */
export type DeviceTokenAcceptance =
  { ok: true } | { ok: false; reason: "empty" | "expo-token" | "not-apns" };

export function acceptDeviceToken(input: {
  token: string;
  platform: DevicePlatform;
}): DeviceTokenAcceptance {
  if (input.token.trim().length === 0) return { ok: false, reason: "empty" };

  // AZ EXPO-TOKEN MINDKET PLATFORMON ROSSZ, ezert all az ag ELOTT. Ez volt az
  // eredeti hiba: a telefon az Expo tokenjet kerte a nativ helyett.
  if (input.token.startsWith("ExponentPushToken"))
    return { ok: false, reason: "expo-token" };

  if (input.platform === "IOS")
    return isNativeDeviceToken(input.token)
      ? { ok: true }
      : { ok: false, reason: "not-apns" };

  // ANDROID: mintat nem irunk elo -- lasd a fenti bekezdest.
  return { ok: true };
}

/**
 * A TOVABBKULDOTT ALAK. CSAK AZ APNS TOKEN KISBETUS.
 *
 * MERT HIBA, 2026-09-21: ez a fuggveny eddig nem letezett, es a
 * `registrationOutcome` MINDEN tokenre `toLowerCase()`-t hivott. Hexadecimalis
 * erteknel ez artalmatlan normalizalas; egy FCM token viszont KIS- ES
 * NAGYBETURE ERZEKENY, tehat ugyanez a hivas elrontotta volna -- mielott a
 * token egyaltalan elindul a szerver fele.
 *
 * ES AMIERT EZ ITT IS KELL, NEM CSAK A SZERVEREN: a szerver ugyanezt a hibat
 * javitotta ugyanaznap. Ha csak ott javulna, a telefon MAR KISBETUSITVE kuldene
 * -- a szerver pedig valtozatlanul tarolna egy elrontott tokent. A ket javitas
 * kulon-kulon nem eleg.
 */
export function storedTokenForm(input: {
  token: string;
  platform: DevicePlatform;
}): string {
  return input.platform === "IOS" ? input.token.toLowerCase() : input.token;
}

/**
 * A HAROM ELUTASITASI OK HAROM KULON MONDATA.
 *
 * A kozos "not a native APNs token" ANDROIDON HAMIS lenne: ott nem ez a
 * szabaly. Egy igaznak latszo, de rossz magyarazat rosszabb a hianyzonal -- aki
 * olvassa, a rossz iranyba indul el. Ugyanaz a szetvalasztas, mint a szerveren.
 */
const ELUTASITAS_OKA: Record<
  Exclude<DeviceTokenAcceptance, { ok: true }>["reason"],
  string
> = {
  empty: "empty token",
  "expo-token": "an Expo push token, not the native one",
  "not-apns": "not a native APNs token",
};

/**
 * MILYEN ALAKU EZ A TOKEN -- A TOKEN KIIRASA NELKUL.
 *
 * === MIERT KELL (merve 2026-09-21) ===
 *
 * Elesen NULLA androidos eszkoz-token all, harom iOS mellett. A fenti
 * `isNativeDeviceToken` 64 hexadecimalis karaktert kovetel, es ez a szabaly a
 * KLIENSEN ES A SZERVEREN IS platform-fuggetlenul fut -- vagyis barmi, ami nem
 * APNs-alaku, elbukik rajta.
 *
 * AMIT A REPOBOL BIZONYITANI TUDOK: a szabaly mindent elutasit, ami nem 64 hex.
 * AMIT NEM: hogy az Android (FCM) token pontosan milyen alaku -- az nem errol
 * a kodrol szolo kerdes. Ez a fuggveny epp ezt teszi merhetove a KESZULEKEN.
 *
 * === A TOKEN MAGA NEM KERUL KI ===
 *
 * Csak a HOSSZ es a karakterkeszlet megy ki. Ennyi eleg a harom alak
 * szetvalasztasahoz (APNs: 64 hex; Expo: `ExponentPushToken[...]`; FCM: hosszu,
 * kettosponttal es alahuzassal), es egy tokent a kepernyore kiirni ugyanaz a
 * fajta hiba, mint naploba irni.
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

/**
 * A PLATFORM KOTELEZO PARAMETER, NEM ALAPERTELMEZETT `"IOS"`.
 *
 * Ugyanaz a dontes, mint a szerver `recipients()` hivasanal (#716): egy
 * alapertelmezes azt a hivot vedi meg, aki ugyis figyel, a MASODIK platform
 * viszont epp attol lesz veszelyes, hogy valaki elfelejti atallitani. Igy a
 * fordito kerdezi meg, minden hivohelyen.
 */
export function registrationOutcome(input: {
  supported: boolean;
  permission: PermissionAnswer;
  token: string | null;
  platform: DevicePlatform;
}): PushRegistrationOutcome {
  if (!input.supported) return { status: "unavailable" };
  if (!input.permission.granted) return { status: "declined" };
  if (!input.token) return { status: "failed", reason: "missing token" };

  const befogadas = acceptDeviceToken({
    token: input.token,
    platform: input.platform,
  });
  if (!befogadas.ok)
    return {
      status: "failed",
      /*
        A NEV ES AZ ALAK EGYUTT. A puszta ok IGAZ, de nem mondja meg, MI JOTT
        helyette -- es epp ez a kulonbseg valasztja szet az Expo tokent (rossz
        hivas) az FCM tokentol (masik platform, masik szabaly).
      */
      reason: `${ELUTASITAS_OKA[befogadas.reason]} (${describeTokenShape(
        input.token,
      )})`,
    };

  return {
    status: "ready",
    token: storedTokenForm({ token: input.token, platform: input.platform }),
  };
}

/**
 * MIT LASSON A KEPERNYON, AKI BEKAPCSOLTA -- MEROESZKOZ, NEM VEGLEGES FELIRAT.
 *
 * === A MERT HIBA, ES EZ NEM A HIANYZO UZENET ===
 *
 * A beallitasok lapja ma EGY mondatot ad minden nem-sikeres kimenetelre:
 * "nincs engedély vagy nincs push a készüléken". Androidon ez ma
 * VALOSZINULEG HAMIS: ha a keszulek ad tokent, de az nem APNs-alaku, akkor
 * VAN engedely ES van push -- csak az alak-szabaly utasitja el.
 *
 * Egy hamis magyarazat rosszabb a hianyzonal: aki elolvassa, az engedelyeket
 * fogja piszkalni, es soha nem jut el az igazi okig.
 *
 * A NEGY KIMENETEL NEGY KULON MONDAT, mert negy kulon teendot ad.
 */
export function describeRegistrationOutcome(
  outcome: PushRegistrationOutcome,
): string | null {
  switch (outcome.status) {
    case "ready":
      return null;
    case "declined":
      return "MÉRÉS: a készülék nem adott engedélyt az értesítésekre. A beállítás elmentve, de ide most nem érkezik értesítés.";
    case "unavailable":
      return "MÉRÉS: ezen a készüléken nincs push (szimulátor, vagy hiányzik a jogosultság a buildből). A beállítás elmentve.";
    case "failed":
      return `MÉRÉS: a készülék ADOTT választ, de a regisztráció elakadt. Az ok: ${outcome.reason}`;
  }
}
