/**
 * RELATIV UT, NEM `@/` ALIAS -- a `tsconfig.test.json` nem hordoz `paths`
 * bejegyzest (lasd a `list-scope.ts` fejlecet).
 */

/**
 * MIERT NEM RAJZOLODIK KI EGY KEP -- MEROESZKOZ, NEM JAVITAS.
 *
 * === A MERT HIBA (Balazs, 2026-09-21 08:59:34 UTC, Android) ===
 *
 * Szo szerint: "az anfroidos keszuleken nem jelennek meg a kepek. latszik, hogy
 * van kep de nem jelenik meg se a kis se ha rakkatintasz a nagy kep". Vagyis a
 * LISTA betoltodik, a KEP nem -- mind a csempen, mind a teljes nezetben.
 *
 * === MIERT MEROESZKOZ, ES MIERT NEM JAVITAS ===
 *
 * Ot dolog adja pontosan ezt a kepet, es kivulrol MEGKULONBOZTETHETETLENEK:
 *
 *   1. a fejlec el sem megy a natív betoltovel (Android)
 *   2. a fejlec elmegy, de a valasz hibas (401, 403, 5xx)
 *   3. a forras `null`, mert a token lekerdezese meg nem allt keszen
 *   4. a `Content-Disposition: attachment` zavarja a dekodolast
 *   5. a `Cache-Control: no-store` melletti ujratoltes fut idotullepesre
 *
 * Egy vak javitas EGYET old meg, NEGYET erintetlenul hagy -- es kozben ugy
 * nez ki, mintha kesz lenne. Ezert eloszor azt kerdezzuk meg a keszulektol,
 * amit csak o tud: a natív hibauzenetet.
 *
 * === A KET ESET KULON All, MERT MAS A TEENDOJUK ===
 *
 * A HIANYZO FORRAS nem halozati hiba: ilyenkor el sem indult keres. Ha ezt
 * "nem tolthető be" alakban mutatnank (ahogy eddig), a ketto egyforman nezne
 * ki a kepernyon, es a valasz, amit Balazstol kapunk, nem zarna ki semmit.
 */

/** A hianyzo forras esete: a token meg nem volt keszen, keres el sem indult. */
export const HIANYZO_FORRAS_UZENET =
  "MÉRÉS: nincs forrás (a bejelentkezési token még nem állt készen). Ez NEM hálózati hiba.";

/**
 * A NATIV HIBAUZENET, TELJES SZOVEGGEL -- SAJAT ATIRAT NELKUL.
 *
 * A React Native `Image` `onError` esemenye `{ nativeEvent: { error } }`
 * alakban adja at, es az `error` platformonkent MAS TIPUSU: Androidon
 * tipikusan sztring vagy `Error`, iOS-en objektum. A tipust ezert nem
 * feltetelezzuk, hanem HARMAS agon olvassuk ki, es ha egyik sem all, azt is
 * KIMONDJUK -- egy ures mondat ugyanolyan hasznalhatatlan valasz lenne, mint a
 * mai ures csempe.
 *
 * AMIT NEM CSINALUNK: nem forditjuk le, nem rovidítjuk, es nem soroljuk be
 * (nincs "halozati hiba" cimke). A hibauzenetek FAJTAJA az, amibol a kulonbseg
 * latszik -- egy 401, egy dekodolasi hiba es egy idotulles harom kulonbozo
 * szoveg, es mind a harom mas kovetkezo lepest ad.
 */
export function kepHibaSzovege(esemeny: unknown): string {
  const nyers = kinyerNyersHibat(esemeny);
  return nyers
    ? `MÉRÉS: a kép betöltése elhasalt. A készülék üzenete: ${nyers}`
    : "MÉRÉS: a kép betöltése elhasalt, és a készülék NEM adott üzenetet (üres hiba-objektum).";
}

function kinyerNyersHibat(esemeny: unknown): string | null {
  if (typeof esemeny !== "object" || esemeny === null) return null;

  const nativeEvent = (esemeny as { nativeEvent?: unknown }).nativeEvent;
  if (typeof nativeEvent !== "object" || nativeEvent === null) return null;

  const error = (nativeEvent as { error?: unknown }).error;
  if (typeof error === "string") return error.trim() || null;
  if (error instanceof Error) return error.message.trim() || null;
  if (typeof error === "object" && error !== null) {
    /*
      ISMERETLEN ALAK: a TELJES objektumot kiirjuk, nem egy kivalasztott mezot.
      Egy mezo-nev, amit en talalok ki, epp azt a platformot hagyna ki, amit
      merni akarunk.
    */
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return null;
}
