/**
 * MIÉRT NEM MENT EL A KÉRÉS -- annyi, amennyit a telefon tud.
 *
 * === A MÉRT HIBA, 2026-09-17 ===
 *
 * A fénykép-feltöltés két képernyőn elhal, és a szerelő EGYETLEN mondatot lát:
 * „A szerver jelenleg nem érhető el." Balázs 11:13-kor megerősítette, hogy a
 * telefonról MÉG SOHA nem ment fel kép -- tehát nem elromlott valami, hanem ez
 * az út egyszer sem futott végig készüléken.
 *
 * ÉS A KERESÉST ÉPP AZ A MONDAT AKASZTOTTA MEG. A `fetch` MAGA hasalt el, a
 * szerver naplójában nulla sor áll, és a hiba OKÁT az `ApiNetworkError` már
 * hordozza (`cause`) -- csak senki nem írja ki. Ugyanaz az alak, mint ma reggel
 * a matricakódnál: a válasz a KÉRDÉSRŐL szólt, nem a világról, és emiatt kellett
 * a gazdának lefényképeznie azt, amit a képernyő megmondhatott volna.
 *
 * === MIÉRT NEM AZ `ApiNetworkError` SZÖVEGÉT ÍRTAM ÁT ===
 *
 * A `client.ts` szándékosan normalizál: egy nyers `fetch`-hiba KÉRÉS-RÉSZLETEKET
 * ágyazhat be, és az minden hívóhoz eljutna. Az a döntés nem az enyém, és nem is
 * kell hozzányúlni: a `cause` ott áll az objektumon, tehát az a HÍVÓ dolga, hogy
 * ahol a diagnózis többet ér, ott kimondja. A fénykép-feltöltés ilyen hely.
 *
 * === A HATÁRA, KIMONDVA ===
 *
 * Ez a modul NEM javítja a feltöltést, és nem is állítja, hogy tudja, mi a baj.
 * Azt teszi, hogy a KÖVETKEZŐ próbálkozás megmondja -- készülék nélkül ugyanis
 * egyikünk sem tudja lefuttatni, és egy tippre állított határ ugyanolyan néma
 * lenne, mint a mai állapot.
 */

/** Mennyit mutatunk meg a mögöttes hibából. */
export const OK_MINTA_HOSSZ = 120;

/**
 * A MÖGÖTTES HIBA SZÖVEGE, EMBERI ALAKBAN -- vagy `null`, ha nincs.
 *
 * A SORTÖRÉS ÉS A SOK SZÓKÖZ EGYETLENRE MEGY, és a hossz meg van vágva: egy
 * natív hibalánc több soros is lehet, és a képernyőn szétdobná a mondatot.
 */
export function describeFailureCause(error: unknown): string | null {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const szoveg =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : null;
  if (szoveg === null) return null;
  const egy = szoveg.replace(/\s+/g, " ").trim();
  if (egy === "") return null;
  return egy.length <= OK_MINTA_HOSSZ
    ? egy
    : `${egy.slice(0, OK_MINTA_HOSSZ)}...`;
}

/**
 * A FÁJL HIVATKOZÁSÁNAK SÉMÁJA -- `file`, `ph`, `content`, `assets-library`.
 *
 * MIÉRT EZ AZ EGY MEZŐ, ÉS MIÉRT NEM A TELJES ÚT: a séma az, ami eldönti, hogy
 * a natív hálózati réteg meg tudja-e NYITNI a fájlt. A teljes út a felhasználó
 * készülékéről szóló adat, és a diagnózishoz nem kell.
 *
 * `"nincs"`, ha a hivatkozás nem hordoz sémát -- az önmagában lelet.
 */
export function uriScheme(uri: string): string {
  const m = uri.trim().match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  return m?.[1]?.toLowerCase() ?? "nincs";
}

/**
 * MIT MOND A KÉPERNYŐ EGY ELHALT FELTÖLTÉSRŐL.
 *
 * HÁROM DOLGOT, ÉS MINDHÁRMAT AZÉRT, MERT A KÖVETKEZŐ PRÓBA EBBŐL DŐL EL:
 *
 *   hogy a kérés el sem ért a szerverig (ez a mai mondat, és igaz);
 *   MIT panaszol a natív réteg (`cause`) -- ma ezt senki nem látja;
 *   MILYEN SÉMÁJÚ hivatkozást küldtünk, mert a legerősebb mai jelölt az, hogy
 *     a natív réteg nem tudja megnyitni a képválasztó által adott fájlt.
 *
 * A SÉMÁK EGYSZER SZEREPELNEK, sorrendben: tíz képnél tízszer ugyanaz a szó
 * nem információ, hanem zaj.
 */
export function describeUploadTransportFailure(input: {
  error: unknown;
  uris: readonly string[];
}): string {
  const semak = [...new Set(input.uris.map(uriScheme))];
  const ok = describeFailureCause(input.error);
  const reszek = [
    "A feltöltés el sem jutott a szerverig.",
    ok ? `A telefon ezt mondja: ${ok}` : "A telefon nem mondta meg, miért.",
    `A kép hivatkozása: ${semak.join(", ")}.`,
    "Ezt a három adatot küldd el nekünk: ebből derül ki, mi akad el.",
  ];
  return reszek.join(" ");
}

/**
 * AMIT A FELTÖLTÉS BUKÁSÁRÓL MONDUNK -- a két eset KÜLÖN.
 *
 * A SZERVER VÁLASZOLT      -> az ő üzenete a helyes, és az meg is mondja, mi a
 *                             baj (túl nagy fájl, rossz formátum, nincs jog).
 * A KÉRÉS EL SEM MENT      -> a szerver üzenete nem létezik, és a mai mondat
 *                             („nem érhető el") elhallgatja, MIT panaszol a
 *                             telefon. Ez az az ág, ami 2026-09-17-ig három
 *                             körben vakon kereste, mi hal el.
 *
 * A `networkFailure` KÍVÜLRŐL JÖN, nem itt dől el: az `ApiNetworkError`
 * osztálya a `client.ts`-ben áll, ami `@/config/env`-et importál, tehát a
 * teszt-fordítás alatt nem hivatkozható. Ugyanaz a megfontolás, mint a
 * `request-auth.ts` és a `json-content-type.ts` esetében.
 */
export function describeUploadFailure(input: {
  error: unknown;
  uris: readonly string[];
  networkFailure: boolean;
}): string {
  if (input.networkFailure)
    return describeUploadTransportFailure({
      error: input.error,
      uris: input.uris,
    });
  return input.error instanceof Error
    ? input.error.message
    : "A feltöltés nem sikerült. Próbáld újra.";
}
