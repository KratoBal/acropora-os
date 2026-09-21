/**
 * A GOOGLE OLDALI KÜLDÉS BEÁLLÍTÁSA -- egyetlen titokból.
 *
 * Az Apple-oldal NÉGY változót olvas (kulcs, kulcs-azonosító, csapat,
 * környezet), mert az APNs négy külön dolgot kér. A Google oldalán mind a
 * három szükséges adat EGY fájlban áll: a szolgáltatásfiók JSON-ja hordozza a
 * projekt azonosítóját, a fiók e-mail címét és a privát kulcsot. Négy változóra
 * bontani annyit tenne, hogy a telepítő szétszed egy fájlt, és a három darab
 * közül egy elcsúszhat.
 *
 * A NÉV BASE64-ET ÁLLÍT, A KÓD MÉGIS FELISMERI AZ ALAKOT -- ugyanaz a döntés,
 * mint az `APNS_PRIVATE_KEY_BASE64`-nél, és ugyanabból az okból: egy ide
 * illesztett nyers JSON base64-dekódolva szemétté válna, és a hibaüzenet nem
 * azt mondaná, hogy rossz a beállítás, hanem egy értelmezhetetlen
 * elemzési hibát.
 *
 * A HIÁNY ÉS A HIBÁS ÉRTÉK KÉT KÜLÖN VÁLASZ, ugyanúgy, mint az Apple-oldalon:
 * egy beállítatlan rendszer rendben van (fejlesztői gépen nincs kulcs), egy
 * beállított, de értelmezhetetlen érték viszont hiba, és mást kell tenni vele.
 */

export interface FcmConfig {
  /** A Firebase projekt azonosítója; a küldési cím ebből épül. */
  projectId: string;
  /** A szolgáltatásfiók e-mail címe: a hozzáférési jegy alanya. */
  clientEmail: string;
  /** A PEM alakú privát kulcs, amivel a jegykérést aláírjuk. */
  privateKey: string;
}

export type FcmConfigResult =
  | { configured: true; config: FcmConfig }
  | { configured: false; missing: string[]; invalid: string[] };

/** A változó neve, egy helyen -- a sablon-háló és a hibaüzenet is ezt mondja. */
export const FCM_SERVICE_ACCOUNT_ENV = "FCM_SERVICE_ACCOUNT_BASE64";

/**
 * A NYERS ÉRTÉKBŐL JSON SZÖVEG.
 *
 * Kettőt fogad el, és ez nem engedékenység: a titkot ember illeszti be egy
 * webes mezőbe. A base64 az elvárt alak; a nyers JSON azért megy át, mert
 * különben az a beillesztés base64-dekódolva értelmezhetetlen bájtokká válna,
 * és a hiba a JSON-elemzőben jelenne meg -- ott, ahol a telepítő már nem tudja,
 * hogy a beállítás volt rossz.
 */
export function readServiceAccountJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
    return decoded.startsWith("{") ? decoded : null;
  } catch {
    return null;
  }
}

export function readFcmConfig(
  environment: NodeJS.ProcessEnv = process.env,
): FcmConfigResult {
  const raw = environment[FCM_SERVICE_ACCOUNT_ENV]?.trim();
  if (!raw)
    return {
      configured: false,
      missing: [FCM_SERVICE_ACCOUNT_ENV],
      invalid: [],
    };

  const json = readServiceAccountJson(raw);
  if (json === null)
    return {
      configured: false,
      missing: [],
      invalid: [FCM_SERVICE_ACCOUNT_ENV],
    };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      configured: false,
      missing: [],
      invalid: [FCM_SERVICE_ACCOUNT_ENV],
    };
  }

  if (!parsed || typeof parsed !== "object")
    return {
      configured: false,
      missing: [],
      invalid: [FCM_SERVICE_ACCOUNT_ENV],
    };

  const fields = parsed as Record<string, unknown>;
  const projectId =
    typeof fields.project_id === "string" ? fields.project_id : "";
  const clientEmail =
    typeof fields.client_email === "string" ? fields.client_email : "";
  const privateKey =
    typeof fields.private_key === "string" ? fields.private_key : "";

  /**
   * A HÁROM MEZŐ EGYÜTT KELL, ÉS A HIÁNYUK `invalid`, NEM `missing`.
   *
   * A változó OTT VAN: a telepítő beállított valamit. Ha ezt hiányként
   * jelentenénk, a Coolify felületén hiába keresné a változót, ami ott áll --
   * pontosan az a félrevezetés, amit az Apple-oldal megjegyzése is nevesít.
   */
  if (!projectId || !clientEmail || !privateKey)
    return {
      configured: false,
      missing: [],
      invalid: [FCM_SERVICE_ACCOUNT_ENV],
    };

  return {
    configured: true,
    config: { projectId, clientEmail, privateKey },
  };
}
