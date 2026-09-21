import { createPrivateKey, sign } from "node:crypto";

import type { FcmConfig } from "./fcm.config.js";

/**
 * A GOOGLE FELÉ KÜLDŐ, A HTTP v1 API-n: egy hozzáférési jegy és egy POST.
 *
 * KÉZZEL ÍRVA, NEM KÖNYVTÁRRAL -- ugyanaz a döntés, mint az Apple-oldalon, és
 * ugyanabból az okból: a protokoll egy aláírt JWT és egy POST, egy közbeiktatott
 * könyvtár viszont egy újabb karbantartandó függőség lenne, és a tesztjeink az
 * Ő viselkedését írnák le a miénk helyett.
 *
 * === EGY KÉRÉS EGY CÍMZETTNEK, ÉS EZ A v1 TULAJDONSÁGA ===
 *
 * A régi (`/fcm/send`) felületen egy hívás több címzettnek ment, és a válasz
 * 200 lehetett úgy, hogy közben címzettenként állt benne hiba. A v1-ben egy
 * üzenet EGY tokennek megy: a válasz státusza ARRÓL az egy címzettről szól.
 *
 * Ez nem menti fel a hívót a számolás alól, csak megmondja, hol áll a számláló:
 * a hívó címzettenként hívja ezt a metódust, és a küldés sikerét a VÁLASZONKÉNTI
 * eredményből összegzi -- soha nem abból, hogy a hívás visszatért-e.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWT_LIFETIME_S = 3600;
/** A jegyet jóval a lejárat előtt cseréljük, ugyanúgy, mint az Apple-oldalon. */
const TOKEN_REFRESH_MS = 45 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface FcmMessage {
  /** A nyers eszköz-token, ahogy a telefon jelentette. */
  deviceToken: string;
  title: string;
  body: string;
  /** A koppintás célja; a v1 csak szöveges értékeket enged. */
  data?: Record<string, string>;
}

export type FcmResult =
  | { ok: true }
  /**
   * A token nem a miénk, vagy már nem létezik. CSAK ez a két válasz jelenti
   * azt, hogy „ne őrizd tovább" -- a hívó ebből dolgozik, anélkül hogy a
   * protokollt ismernie kellene.
   */
  | { ok: false; retired: true; reason: string }
  | { ok: false; retired: false; reason: string };

function base64url(value: object | Buffer): string {
  const raw = Buffer.isBuffer(value)
    ? value
    : Buffer.from(JSON.stringify(value));
  return raw.toString("base64url");
}

/**
 * A HOZZÁFÉRÉSI JEGYHEZ VEZETŐ ALÁÍRT KÉRÉS.
 *
 * `RS256`, mert a Google szolgáltatásfiók kulcsa RSA -- szemben az Apple ES256
 * kulcsával. A `dsaEncoding` itt ezért NEM kell: az a beállítás az ECDSA r||s
 * alakjáról szól, és RSA-nál nincs mit választani.
 */
function assertionFor(config: FcmConfig, issuedAtMs: number): string {
  const iat = Math.floor(issuedAtMs / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: TOKEN_ENDPOINT,
    iat,
    exp: iat + JWT_LIFETIME_S,
  };
  const unsigned = `${base64url(header)}.${base64url(payload)}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: createPrivateKey(config.privateKey),
  });
  return `${unsigned}.${base64url(signature)}`;
}

/**
 * MELYIK HIBA JELENTI AZT, HOGY A TOKENT EL KELL DOBNI.
 *
 * === AZ `INVALID_ARGUMENT` KÉT DOLGOT JELENTHET, ÉS EZ A LÉNYEG ===
 *
 * Jelentheti azt, hogy a token értelmezhetetlen (soha nem volt a miénk), és
 * jelentheti azt, hogy MI küldtünk rossz alakú üzenetet. Ha mind a kettőre
 * törölnénk a tokent, egy SAJÁT hibánk venné le a kollégát az értesítésekről --
 * csendben, és épp azon a napon, amikor a hiba bekerült.
 *
 * Ezért a mező-hivatkozást nézzük: a Google megnevezi, MELYIK mező rossz
 * (`message.token`). Ha a token a hibás, eldobjuk; ha bármi más, akkor ez a mi
 * hibánk, és a token marad.
 *
 * A két tévedés ára nem egyforma: a fölösleges megtartás HANGOS (a naplóban
 * ismétlődő hiba), a fölösleges törlés NÉMA -- a telefon egyszer csak nem kap
 * többet, és senki nem keresi, miért.
 */
export function shouldRetire(input: {
  status: number;
  errorStatus: string | null;
  fields: readonly string[];
}): boolean {
  // A készülék végleg elment: az app törölve, vagy a token lejárt.
  if (input.status === 404 || input.errorStatus === "UNREGISTERED") return true;
  // A token egy MÁSIK küldőhöz tartozik -- az Apple `DeviceTokenNotForTopic` párja.
  if (input.errorStatus === "SENDER_ID_MISMATCH") return true;
  if (input.errorStatus === "INVALID_ARGUMENT")
    return input.fields.some((field) => field.endsWith("token"));
  return false;
}

/** A hibaválasz megnevezett része, ha van benne. */
export function readFcmError(body: string): {
  errorStatus: string | null;
  message: string | null;
  fields: string[];
} {
  const ures = { errorStatus: null, message: null, fields: [] as string[] };
  if (!body) return ures;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return ures;
  }
  if (!parsed || typeof parsed !== "object") return ures;
  const error = (parsed as { error?: unknown }).error;
  if (!error || typeof error !== "object") return ures;
  const rekord = error as Record<string, unknown>;
  const fields: string[] = [];
  const details = rekord.details;
  if (Array.isArray(details))
    for (const detail of details) {
      if (!detail || typeof detail !== "object") continue;
      const violations = (detail as { fieldViolations?: unknown })
        .fieldViolations;
      if (!Array.isArray(violations)) continue;
      for (const violation of violations) {
        if (!violation || typeof violation !== "object") continue;
        const field = (violation as { field?: unknown }).field;
        if (typeof field === "string") fields.push(field);
      }
    }
  return {
    errorStatus: typeof rekord.status === "string" ? rekord.status : null,
    message: typeof rekord.message === "string" ? rekord.message : null,
    fields,
  };
}

export class FcmClient {
  private token: { value: string; issuedAt: number } | null = null;

  constructor(
    private readonly config: FcmConfig,
    private readonly now: () => number = Date.now,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * A JEGY MEGSZERZÉSE, gyorsítótárazva.
   *
   * A hiba itt NEM dobás, hanem `null`: a küldés hívója egy hibaválaszt vár, és
   * egy kivétel innen a teljes értesítés-kört vinné el -- azt a kört, ami több
   * címzettnek is küld.
   */
  private async accessToken(): Promise<string | null> {
    const now = this.now();
    if (this.token && now - this.token.issuedAt < TOKEN_REFRESH_MS)
      return this.token.value;

    const valasz = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: assertionFor(this.config, now),
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!valasz.ok) return null;
    const torzs: unknown = await valasz.json();
    const ertek =
      torzs && typeof torzs === "object"
        ? (torzs as { access_token?: unknown }).access_token
        : null;
    if (typeof ertek !== "string" || ertek.length === 0) return null;
    this.token = { value: ertek, issuedAt: now };
    return ertek;
  }

  async send(message: FcmMessage): Promise<FcmResult> {
    let jegy: string | null;
    try {
      jegy = await this.accessToken();
    } catch (cause) {
      return {
        ok: false,
        retired: false,
        reason: cause instanceof Error ? cause.message : "token request failed",
      };
    }
    if (!jegy)
      return { ok: false, retired: false, reason: "no FCM access token" };

    try {
      const valasz = await this.fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${this.config.projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${jegy}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: message.deviceToken,
              notification: { title: message.title, body: message.body },
              ...(message.data ? { data: message.data } : {}),
            },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );

      if (valasz.status === 200) return { ok: true };

      const torzs = await valasz.text();
      const hiba = readFcmError(torzs);
      const reason =
        hiba.errorStatus ?? hiba.message ?? `HTTP ${valasz.status}`;
      return {
        ok: false,
        retired: shouldRetire({
          status: valasz.status,
          errorStatus: hiba.errorStatus,
          fields: hiba.fields,
        }),
        reason,
      };
    } catch (cause) {
      /**
       * A HÁLÓZATI HIBA SOSEM NYUGDÍJAZ. Egy megszakadt kapcsolat vagy egy
       * időtúllépés semmit nem mond a tokenről, és egy perc múlva ugyanaz a
       * token működhet.
       */
      return {
        ok: false,
        retired: false,
        reason: cause instanceof Error ? cause.message : "request failed",
      };
    }
  }
}
