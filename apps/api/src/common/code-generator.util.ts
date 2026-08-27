import { randomUUID } from "node:crypto";

/// Human-readable, sortable document code: PREFIX-yyyymmdd-hhmmss-XXXX.
/// Used for leltár/korrekció numbers and POS sale numbers alike.
/// The random tail, as its own function so a test can control it.
///
/// Sixteen bits of real randomness (the first two bytes of a v4 UUID), which is
/// what makes two codes minted in the same second differ. Measured 2026-08-26:
/// 200 000 draws produced 62 428 of the 65 536 possible values, i.e. a uniform
/// draw rather than a counter.
export function randomCodeSuffix(): string {
  return randomUUID().slice(0, 4).toUpperCase();
}

/// The seam exists for ONE reason: a collision must be reproducible on demand.
///
/// Two documents collide when they are minted in the same second AND draw the
/// same tail. Waiting for that to happen by chance is not a test - it is a
/// 1-in-65 536 hope. So the tail is a parameter, defaulted to the real random
/// source, and only a test ever passes anything else.
///
/// It is deliberately NOT a general extension point: whatever is passed must
/// still produce the documented shape (four uppercase hex characters), because
/// the label prints the last two blocks and the asset search matches on a
/// substring of the whole code. A caller that supplies a different shape breaks
/// two other places, and that is asserted in this module's spec.
export function generateCode(
  prefix: string,
  randomSuffix: () => string = randomCodeSuffix,
  stamp: CodeStamp = "utc",
): string {
  const now = new Date();
  return `${prefix}-${formatStamp(now, stamp)}-${randomSuffix()}`;
}

/**
 * MELYIK ORA SZERINT ALL A BELYEG.
 *
 * `utc` -- a mai, valtozatlan alak minden csaladra. A `toISOString` UTC-t ad,
 * tehat a belyeg NYARON ket oraval a magyar fali ora mogott jar, es este 22:00
 * utan a DATUM is egy nappal korabbi.
 *
 * `local-marked` -- helyi ido, es az idopont-blokk vegen egy `h`. CSAK ott
 * hasznaljuk, ahol egy EMBER olvassa le a szamot a cimkerol.
 */
export type CodeStamp = "utc" | "local-marked";

/**
 * A CIMKE ORAJA: Europe/Budapest, es a valtas JELOLVE.
 *
 * MIERT KELL JELOLES. A mar kiadott eszkozszamok visszamenoleg NEM valtoznak,
 * tehat a sorozatban van egy pont, ahol a belyeg jelentese megvaltozik.
 * Jeloles nelkul ugyanaz a mezo ket dolgot jelentene, kivulrol
 * megkulonboztethetetlenul -- es az rosszabb, mint az egysegesen rossz ertek,
 * mert azt legalabb at lehet szamolni.
 *
 * MIERT AZ IDOPONT-BLOKK VEGERE, ES NEM A DATUMEBA. A cimkere a szam UTOLSO
 * KET blokkja kerul (l. `labelAssetNumber` a mobil oldalan), tehat egy
 * datum-blokkba tett jelolo pontosan annak az embernek lenne lathatatlan,
 * akinek szol.
 *
 * MIERT KISBETU. A szam vege csupa NAGYBETUS hexa, tehat a kisbetu az egyetlen
 * karakter a kodban, ami nem illik a mintaba: ranezesre elut, magyarazat
 * nelkul.
 *
 * A BLOKK-SZERKEZET VALTOZATLAN (negy blokk, ugyanaz az elvalaszto), tehat a
 * mobil szetvagas, a `contains` kereses es a rendezes ugyanugy mukodik.
 */
const LABEL_TIME_ZONE = "Europe/Budapest";

function formatStamp(now: Date, stamp: CodeStamp): string {
  if (stamp === "utc")
    return now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);

  /**
   * A zonat az Intl oldja fel, NEM a rendszer ora eltolasa.
   *
   * Merve 2026-08-20: a konteneр zonafajlja nulla bajtos volt, es a glibc
   * ilyenkor CSENDBEN nulla eltolasra esik vissza, kozben a zona NEVET
   * megtartja. A node sajat ICU adatot hasznal, tehat ez a hivas akkor sem
   * hazudott. Ezert all itt Intl es nem `toLocaleString` a rendszer zonajaval.
   */
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LABEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error(`A(z) ${type} resz hianyzik a belyegbol.`);
    return part.value;
  };

  const date = `${value("year")}${value("month")}${value("day")}`;
  const time = `${value("hour")}${value("minute")}${value("second")}`;
  return `${date}-${time}h`;
}
