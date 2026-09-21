/**
 * A KIKULDES ALAIRASRA -- A DONTESEK, TISZTA FUGGVENYBEN.
 *
 * Balazs specje, 2026-09-18 07:01 UTC (Discord, Acropora OS mobilalkalmazas
 * szal), szo szerint: "Az elozo oldalon az a Alairas gomb ala Elkuldom
 * alairasra gomb. Utana felugro ablak es kivalaszthatom minek kuldom el a
 * partner alairoibol alatta gomb Elkuldom alairasra."
 *
 * MIERT TISZTA FUGGVENY, ES NEM A KEPERNYON: a telefon `node --test`-tel fut
 * leforditott JS-en, renderelo nelkul -- egy kepernyobe irt feltetelre
 * SEMMILYEN allitas nem tud elsulni. Ugyanez az alak, mint a `worksheet-
 * handover.ts` es a `worksheet-signature.ts`.
 */

/**
 * KIKULDHETO-E MOST EZ A LAP ALAIRASRA.
 *
 * HAROM feltetel, es MINDHAROM a szerveren is all:
 *
 *   `worksheetsManage`          a vegpont `SERVICE_MANAGE` joghoz kotott
 *   `AWAITING_SIGNATURE`        a repository mast elutasit ("Csak kiallitott
 *                               munkalap kuldheto ki alairasra")
 *   `sentForSignatureAt` null   ami mar kint van, azt nem kuldjuk ki megint
 *
 * A HARMADIK NEM SZERVER-OLDALI TILTAS, HANEM A GOMB DOLGA, es ezt ki kell
 * mondani: a szerver az ujrakuldest ATENGEDNE (a `sendForSignature` nem nezi a
 * mezot, csak az allapotot). A gomb megis eltunik, mert Balazs epp azt a
 * tunetet nevezte meg, hogy a szerelo "ketszer kuldi el" -- a valasz a
 * `kikuldesAllapotSora`, ami kiirja, KINEK ment ki.
 *
 * Ha valaha KELL az ujrakuldes (a cimzett kilep a cegtol, rossz embert
 * valasztottunk), az UJRA DONTES lesz, nem hiba: akkor ez a feltetel esik ki,
 * es a felirat valtozik. Ezert all kulon sorban, sajat allitassal.
 */
export function kikuldhetoAlairasra(input: {
  status: string;
  sentForSignatureAt: string | null;
  worksheetsManage: boolean;
}): boolean {
  return (
    input.worksheetsManage &&
    input.status === "AWAITING_SIGNATURE" &&
    input.sentForSignatureAt === null
  );
}

/**
 * A LAP TETEJEN ALLO ALLAPOT-SOR, VAGY `null`, HA MEG NEM KULDTUK KI.
 *
 * Balazs dontese, 2026-09-21 14:00:58 UTC (Discord, fo csatorna, message_id
 * 1551594090242510969), egy betu: "b". A kerdes az volt, latszodjon-e a lapon,
 * KINEK kuldtuk el alairasra: csak a naploban, vagy a lap tetejen is.
 *
 * Az indok, amit elfogadott: a szerelo NEM a naplot olvassa, amikor azt
 * kerdezi, hogy ezzel most mi van. Ha nem latja ranezesre, ketszer kuldi el
 * vagy feleslegesen telefonal.
 *
 * A DATUM DONT, NEM A NEV. A cimzett fiokja torolheto (`SetNull` a semaban), a
 * kikuldes tenye viszont megmarad -- nev nelkul is kiirjuk, hogy kiment.
 * Ha a nevre kapuznank, egy torolt cimzett CSENDBEN eltuntetne az egesz sort,
 * es a lap ugy nezne ki, mintha soha nem kuldtuk volna ki.
 */
export function kikuldesAllapotSora(input: {
  sentForSignatureAt: string | null;
  sentForSignatureToName: string | null;
}): string | null {
  if (input.sentForSignatureAt === null) return null;
  return input.sentForSignatureToName === null
    ? "Kiküldve aláírásra"
    : `Kiküldve aláírásra: ${input.sentForSignatureToName}`;
}
