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
 * AMIRE EGY ERTESITES VIHET.
 *
 * A MASODIK ERTEK 2026-09-18-AN KERULT FEL, es a felvetel FELTETELE teljesult,
 * nem lejart: a hibajegy-keperno 2026-09-16 ota letezik a telefonon
 * (`app/service-jobs/[id].tsx`, a 735 pull requestben). Addig a tipus felvetele
 * annyit tett volna, hogy a koppintas egy ures utvonalra visz, es az rosszabb
 * lett volna a nem mukodo koppintasnal.
 *
 * A SZERVER MAR 2026-09-14 OTA KULDI (`deliverServiceJobAssignment`:
 * `targetType: "serviceJob"`), tehat a ket oldal negy napig ELTERT: az
 * ertesites megjelent a zarolt kepernyon, es a koppintas nem vitt sehova.
 * Ez a ket lista most merve is egyutt mozog, lasd
 * `apps/api/src/mobile/push-targets.spec.ts`.
 *
 * A HARMADIK ERTEK, `materialRequest`, 2026-09-23-AN KERULT FEL, UGYANAZZAL
 * A SZABALLYAL: a felvetel feltetele (letezik-e kepernyo, ahova vinni lehet)
 * ekkor teljesult, a mobil szelettel egyutt. A szerver KET esemenyre kuldi
 * (`deliverMaterialRequestCreated`, `deliverMaterialRequestReceived`), a
 * `targetId` mindkettonel a MUNKALAP azonositoja, nem az igenye -- lasd a
 * `PUSH_TARGET_ROUTES` fejleceit, miert.
 */
export const PUSH_TARGET_TYPES = [
  "worksheet",
  "serviceJob",
  "materialRequest",
] as const;

export type PushTargetType = (typeof PUSH_TARGET_TYPES)[number];

/**
 * MELYIK TIPUS MELYIK KEPERNYOT NYITJA -- ES EZ AZ A HELY, AHOL A FORDITO
 * TENYLEG SZOL.
 *
 * === MIERT NEM `switch`, HOLOTT EDDIG AZ VOLT ===
 *
 * A `usePushNavigation.ts`-ben egy `switch` allt, es a komment fole azt
 * allitotta, hogy "a `PushTargetType` zart halmaz, tehat a fordito MEG FOGJA
 * MONDANI, ha egy uj tipus bekerul es ez a hely nem kezeli".
 *
 * EZT 2026-09-18-AN LEMERTEM, ES NEM IGAZ: felvettem a `serviceJob` erteket a
 * listara, a `switch`-hez NEM nyultam, es a mobil `typecheck` ZOLDEN futott le
 * (kilepesi kod 0). Nem is szolhatott: a `switch` egy `void` visszateresu
 * callback torzseben all, default ag nelkul, tehat a hianyzo ag egyszeruen
 * kiesik az aljan. Kimerito-ellenorzes nelkul a `switch` NEM orzo.
 *
 * Egy komment, ami egy NEM LETEZO vedelmet ir le, rosszabb a semminel: aki
 * olvassa, nem epit melle igazit.
 *
 * === AMIT A `satisfies` AD, ES AMIT NEM ===
 *
 * AD: ha egy uj tipus kerul a `PUSH_TARGET_TYPES` listajara es ide nem kerul
 * utvonal, a fordulas ELHASAL. Ez a kimerito-ellenorzes, amit a `switch` csak
 * igert.
 *
 * NEM AD: azt nem tudja, hogy a leirt utvonalhoz VAN-E kepernyo-fajl. Egy
 * elgepelt ut ugyanugy `string`. Azt a fajlrendszeren kell merni, es meri is:
 * `apps/api/src/mobile/push-targets.spec.ts`.
 *
 * AZ ERTEKEK EXPO-ROUTER UTVONAL-ALAKOK (`/mappa/[id]`), es a horog adja at a
 * `router.push`-nak. A tipusuk az `as const` miatt SZUK literal-unio, tehat a
 * tipusos utvonalak ellenorzese a hivas helyen megmarad.
 */
/**
 * A `materialRequest` NEM MEHET A `/worksheets/[id]` UTVONALRA, HOLOTT
 * SZEMANTIKAILAG ODA KELLENE VINNIE.
 *
 * A LENTI TESZT ("ket tipus nem visz ugyanarra a kepernyore") ERTEKKENT
 * MERI a tablat: ket kulcs UGYANAZT az utvonal-sztringet nem hordozhatja.
 * Ha ide is a `/worksheets/[id]` kerulne, a mar letezo `worksheet` kulccsal
 * UTKOZNE -- nem hiba, csak ez az orzo szandekosan nem tudja megkulonboztetni
 * a "ket tipus egy dolog fele mutat SZANDEKOSAN" es a "masolassal bennmaradt a
 * regi ut" esetet.
 *
 * EZERT KULON, VEKONY UTVONAL: `/material-requests/[id]`, amit a
 * `app/material-requests/[id].tsx` kepernyo AZONNAL tovabbiranyit a
 * megfelelo munkalapra (`Redirect href={{ pathname: "/worksheets/[id]",
 * params: { id } }}`). A `targetId` ezert a MUNKALAP azonositoja, nem az
 * anyagigenye -- a cel a munkalap, nem egy nem letezo reszletlap.
 */
export const PUSH_TARGET_ROUTES = {
  worksheet: "/worksheets/[id]",
  serviceJob: "/service-jobs/[id]",
  materialRequest: "/material-requests/[id]",
} as const satisfies Record<PushTargetType, string>;

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
 * ES AMI NEM ESIK VISSZA: az ISMERETLEN tipus. Ha a szerver egyszer egy
 * HARMADIK tipust kezd kuldeni, es egy REGI app kapja meg, az NEM nyithatja
 * meg helyette a munkalapot. Inkabb ne vigyen sehova, mint rossz helyre -- egy
 * rossz keperno az ugyfel elott rosszabb, mint egy nem mukodo koppintas.
 *
 * EZ NEM ELMELETI: pontosan ez tortent a `serviceJob` tipussal 2026-09-14 es
 * 2026-09-18 kozott. A szerver kuldte, a telefon nem ismerte, es a koppintas
 * nem vitt sehova -- de legalabb nem vitt ROSSZ helyre.
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
