/**
 * MIT NYIT MEG EGY ERTESITESRE ADOTT KOPPINTAS.
 *
 * === MIERT VAN EZ A MODUL, ES MIERT NEM EGY SOR A GYOKER ELRENDEZESBEN ===
 *
 * Merve 2026-09-03: a szerver a munkalap-kiosztas ertesitesehez ODATESZI a lap
 * azonositojat (`data: { worksheetId }`, es az APNs torzsben az `aps` melle
 * kerul), a telefonon viszont SEMMI nem olvasta ki. Nem hianyzo kepesseg volt,
 * hanem be nem kotott: az ertesites megerkezett, latszott, es a koppintas nem
 * vitt sehova.
 *
 * A bekotes harom DONTEST igenyel, es egyik sem trivialis:
 *
 *   1. AZ AZONOSITO NEM MEGBIZHATO BEMENET. A `content.data` szabad JSON, a
 *      tipusa nem garantalt. Egy hibas ertesites egy ures utvonalra navigalna.
 *   2. A BEJELENTKEZES SORRENDJE. Amig a munkamenet helyreallitasa fut vagy a
 *      keperno zarva van, a navigacio a bejelentkezesre iranyulna at, es A CEL
 *      ELVESZNE. Ilyenkor NEM navigalunk, es NEM is jegyezzuk fel kezeltnek --
 *      igy ugyanaz a valasz kesobb, mar bejelentkezve, meg hat.
 *   3. UGYANAZ A VALASZ TOBBSZOR IS MEGJELENIK. A `useLastNotificationResponse`
 *      MINDEN renderelesnel ugyanazt az objektumot adja vissza, amig ujabb nem
 *      jon. Ors nelkul minden render ujranavigalna.
 *
 * A kulcs a NOTIFICATION SAJAT AZONOSITOJA, nem a munkalape: ugyanarrol a lapról
 * jogosan johet ket ertesites (ujra kiosztottak), es azt ket kulon koppintassal
 * ket kulon megnyitas illeti.
 *
 * A tipusok SAJAT, szerkezeti alakok: ez a fajl a teszt-forditasba is bekerul,
 * az pedig nem ismeri az `@/` aliast, es nem hivhatja be az Expo futasidot.
 */

/** Annyi az `expo-notifications` valaszabol, amennyit ez a modul olvas. */
export interface PushResponseLike {
  notification: {
    request: {
      identifier?: unknown;
      content?: { data?: unknown };
    };
  };
}

/**
 * AMIRE EGY ERTESITES VIHET. MA EGY ERTEK, ES EZ SZANDEKOS.
 *
 * Balazs kerese (2026-09-03 20:20): hibajegy-keperno ma nincs a telefonon,
 * tehat oda nem lehet vinni senkit -- de az ALAK legyen olyan, hogy a masodik
 * tipus ne kivanjon atirast. Ez ma egy elagazas EGY aggal.
 */
export const PUSH_TARGET_TYPES = ["worksheet"] as const;

export type PushTargetType = (typeof PUSH_TARGET_TYPES)[number];

export interface PushTarget {
  type: PushTargetType;
  id: string;
}

export type PushNavigationDecision =
  | { navigate: true; target: PushTarget; key: string }
  | {
      navigate: false;
      reason:
        "no-response" | "no-target" | "not-authenticated" | "already-handled";
    };

/** A valasz azonositoja, amivel a mar kezelt koppintas felismerheto. */
export function pushResponseKey(
  response: PushResponseLike | null | undefined,
): string | null {
  const id = response?.notification?.request?.identifier;
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  return trimmed ? trimmed : null;
}

function szoveg(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * A CELPONT A TORZSBOL, ha van es hasznalhato.
 *
 * A `data` szabad JSON: minden lepesnel ellenorizni kell. Egy `undefined`
 * azonositoval osszerakott utvonal nem hibazna, csak egy ures lapra vinne.
 *
 * === KET ALAKOT OLVAS, ES A SORREND NEM MINDEGY ===
 *
 * ELOSZOR a tipusos part (`targetType` + `targetId`). Ez a mai alak.
 *
 * MASODSZOR, es CSAK HA TIPUS NINCS, a regi `worksheetId` mezot. Az ertesitesi
 * kozpontban MA is allhat bontatlan ertesites, ami csak azt hordozza: egy
 * koppintas rajta a frissites UTAN tortenne, es fallback nelkul sehova nem
 * vinne. Ez elo eset, nem elmeleti.
 *
 * ES AMI NEM ESIK VISSZA: az ISMERETLEN tipus. Ha egyszer jon egy hibajegy-
 * ertesites, es egy REGI app kapja meg, az NEM nyithatja meg helyette a
 * munkalapot. Inkabb ne vigyen sehova, mint rossz helyre -- egy rossz kepernyo
 * az ugyfel elott rosszabb, mint egy nem mukodo koppintas.
 *
 * MIKOR HAGYHATO EL A VISSZAESES: ha egyszer biztosak vagyunk benne, hogy
 * egyetlen keszuleken sem all bontatlan, tipus nelkuli ertesites.
 */
export function pushTarget(
  response: PushResponseLike | null | undefined,
): PushTarget | null {
  const data = response?.notification?.request?.content?.data;
  if (typeof data !== "object" || data === null) return null;
  const row = data as Record<string, unknown>;

  const rawType = row.targetType;
  if (rawType !== undefined && rawType !== null) {
    const type = szoveg(rawType);
    if (!type) return null;
    if (!(PUSH_TARGET_TYPES as readonly string[]).includes(type)) return null;
    const id = szoveg(row.targetId);
    return id ? { type: type as PushTargetType, id } : null;
  }

  const legacy = szoveg(row.worksheetId);
  return legacy ? { type: "worksheet", id: legacy } : null;
}

export function decidePushNavigation(input: {
  response: PushResponseLike | null | undefined;
  /** Az `AuthProvider` allapota. Csak a bejelentkezett allapot navigal. */
  status: string;
  /** A legutobb MAR kezelt valasz kulcsa, vagy `null`. */
  handledKey: string | null;
}): PushNavigationDecision {
  const key = pushResponseKey(input.response);
  if (!key) return { navigate: false, reason: "no-response" };

  const target = pushTarget(input.response);
  if (!target) return { navigate: false, reason: "no-target" };

  /**
   * A SORREND ITT SZAMIT, ES SZANDEKOS: eloszor a bejelentkezes, csak azutan a
   * "mar kezeltuk" kerdes. Forditva egy nem bejelentkezett allapotban erkezo
   * valasz kezeltnek szamitana, es a bejelentkezes utan MAR NEM hatna -- epp az
   * a hiba, ami ellen ez az ag keszult.
   */
  if (input.status !== "authenticated")
    return { navigate: false, reason: "not-authenticated" };

  if (input.handledKey === key)
    return { navigate: false, reason: "already-handled" };

  return { navigate: true, target, key };
}
