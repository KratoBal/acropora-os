import type { UnitOfMeasure } from "@acropora/types";

/**
 * A MÉRTÉKEGYSÉG-KARBANTARTÁS TISZTA RÉSZE.
 *
 * MIÉRT KÜLÖN FÁJL: a képernyő minden döntése, amit érdemes állítani, itt áll
 * -- így a tesztje renderelés nélkül fut, és nem a jelölésről szól, hanem a
 * szabályról. A komponens csak összeköti őket.
 */

/**
 * MIT MOND A KEZELŐNEK EGY ELUTASÍTOTT TÖRLÉS.
 *
 * A szerver a HASZNÁLATBAN lévő egységre 409-et ad, mert a törlés némán
 * ürítené ki az eszközök mezőit. A kezelőnek viszont nem a hibakód a teendő:
 * a KIVEZETÉS az az út, ami ugyanazt éri el (kiesik a választóból), és a
 * meglévő értékeket békén hagyja.
 *
 * Ezért a mondat nem azt mondja, hogy „nem sikerült", hanem azt, MIT tegyen.
 */
export const TORLES_HELYETT_KIVEZETES =
  "Ez a mértékegység használatban van, ezért nem törölhető. " +
  "Vezesd ki helyette: kiesik a választóból, de a meglévő értékek mellett olvasható marad.";

/**
 * A FELVITELI ŰRLAP HIBÁJA, VAGY `null`.
 *
 * A SZERVER UGYANEZT MÉG EGYSZER ELDÖNTI, és ez nem duplikáció: ez a
 * visszajelzés gyorsasága (a kezelő a mező mellett látja), a szerveré a
 * szabály. Ha csak itt állna, egy másik kliens megkerülné; ha csak ott, a
 * kezelő egy hálózati kör után tudná meg, hogy lemaradt egy betű.
 */
export function unitFormProblem(input: {
  code: string;
  name: string;
}): string | null {
  if (input.code.trim() === "") return "A rövid jel nem maradhat üresen.";
  if (input.code.trim().length > 16)
    return "A rövid jel legfeljebb 16 karakter lehet.";
  if (input.name.trim() === "") return "A név nem maradhat üresen.";
  if (input.name.trim().length > 80)
    return "A név legfeljebb 80 karakter lehet.";
  return null;
}

/**
 * A LISTA SORRENDJE A KÉPERNYŐN.
 *
 * A SZERVER MÁR RENDEZVE ADJA (`sortOrder`, majd `code`), és ez a függvény
 * mégsem fölösleges: a kivezetés vagy az átnevezés UTÁN a lista helyben
 * frissül, új lekérdezés nélkül. Enélkül egy most kivezetett sor ott maradna,
 * ahol volt, és a következő betöltéskor ugrana egyet -- a kezelő azt látná,
 * hogy „magától" mozog valami.
 */
export function sortUnits(units: readonly UnitOfMeasure[]): UnitOfMeasure[] {
  return [...units].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, "hu"),
  );
}
