/**
 * MELYIK KÓD FUT ÉPPEN.
 *
 * A kérdés Balázsé (2026-08-26 este), és aznap NÉGYSZER került elő: a telefonon,
 * a weben, a próbarendszeren és a fő ágon is. A telefonon konkrétan egy kört
 * vitt el: nem lehetett eldönteni, hogy egy éteren küldött javítás megérkezett-e,
 * és emiatt meg kellett kérdezni a felhasználót, hogy bezárta-e az alkalmazást.
 *
 * AMIÉRT A VERZIÓSZÁM ÖNMAGÁBAN HASZONTALAN LENNE, és ez MÉRT tény: a 6-os, a
 * 7-es és a 8-as build verziója EGYARÁNT `0.1.0`. Ha csak azt írnánk ki, a régin
 * és az újon ugyanaz látszana, és a felirat pont akkor mondana csődöt, amikor
 * kellene. Ezért NEM a verzió kerül a képernyőre, hanem az, ami tényleg
 * KÜLÖNBÖZIK: a build száma, és hogy a futó csomag a buildbe ágyazott kód-e vagy
 * egy letöltött frissítés.
 *
 * A MODUL SZÁNDÉKOSAN NEM OLVAS SEMMIT. A tényeket a hívó adja át, mert az
 * `expo-updates` és az `expo-constants` csak készüléken létezik: egy modul, ami
 * maga olvasná őket, csak eszközön lenne mérhető, tehát sehol.
 */

export type RunningVersionFacts = {
  /** A natív build száma. A verziótól eltérően ez KÜLÖNBÖZIK a buildek között. */
  buildNumber: string | null;
  /** Igaz, ha a buildbe ágyazott csomag fut, hamis, ha egy letöltött frissítés. */
  isEmbeddedLaunch: boolean;
  /** A futó frissítés azonosítója. Beágyazott indulásnál is van értéke. */
  updateId: string | null;
  /** A futó frissítés keletkezési ideje. */
  updateCreatedAt: Date | null;
};

/** Az azonosítóból ennyi karakter elég a felismeréshez. */
const SHORT_ID_LENGTH = 8;

/**
 * A FRISSÍTÉS AZONOSÍTÓJÁNAK RÖVID ALAKJA.
 *
 * Ugyanaz az elv, mint a címkén álló eszközszámnál: a teljes azonosító nem fér
 * ki olvashatóan, a rövidítés viszont a teljes érték ELEJE, tehát összefüggő
 * részlete marad, és a hosszú alakkal összevethető.
 */
export function shortUpdateId(updateId: string | null): string | null {
  if (!updateId) return null;
  return updateId.slice(0, SHORT_ID_LENGTH);
}

/**
 * A KÉPERNYŐRE KERÜLŐ EGYETLEN SOR.
 *
 * Amit szándékosan NEM tartalmaz: a commit azonosítóját. A build idején ismert
 * commitot bele lehetne égetni a konfigurációba, de az a BUILD commitját
 * nevezné meg akkor is, amikor egy KÉSŐBBI, éteren érkezett csomag fut -- vagyis
 * pont az a fajta felirat lenne, ami nem azonos azzal, amit jelöl. A futó
 * csomagot a frissítés azonosítója és időpontja egyértelműen megnevezi.
 */
export function runningVersionLine(facts: RunningVersionFacts): string {
  const build = facts.buildNumber
    ? `${facts.buildNumber}. build`
    : "ismeretlen build";

  if (facts.isEmbeddedLaunch) return `${build} · beépített kód`;

  const parts = [build, "éteri frissítés"];
  const short = shortUpdateId(facts.updateId);
  if (short) parts.push(short);
  if (facts.updateCreatedAt)
    parts.push(
      facts.updateCreatedAt.toLocaleString("hu-HU", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  return parts.join(" · ");
}
