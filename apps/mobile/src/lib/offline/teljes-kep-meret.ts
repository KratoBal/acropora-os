/**
 * MIT IGER A TELJES KEPEK GOMBJA -- ES MIT NEM.
 *
 * === A KET KIKOTES, AMI EZT A MODULT KIVALTOTTA (acrobot, 2026-09-21) ===
 *
 * 1. „AMIT A GOMB IGER, AZ AZ ATVITT ADAT LEGYEN, ne a teljes keszlet." Ha egy
 *    kep mar lent van, ne szamoljon bele -- kulonben a masodik megnyomas
 *    UGYANAZT a szamot mutatja, es a felhasznalo azt hiszi, semmi nem tortent.
 *
 * 2. „HA A MERET NEM ISMERT, A GOMB NE MONDJON SZAMOT." Egy hianyzo meret nulla
 *    megabajtnak latszik, es a nulla itt azt IGERI, hogy ingyen van. Inkabb ne
 *    alljon ott szam, mint hogy rossz alljon.
 *
 * === A MASODIKROL EGY MERES, MERT A KIKOTES TOBBET FELTETELEZ A MAI VALOSAGNAL ===
 *
 * A sema szerint az `AssetDocument.sizeBytes` NEM NULLAZHATO (`Int`, kotelezo),
 * tehat egy letezo csatolmany-sorhoz MA MINDIG tartozik meret. A „nem ismert"
 * eset ezert nem eloallo allapot, hanem OVINTEZKEDES: ha a mezo egyszer
 * nullazhatova valik, vagy egy regebbi valasz nem hordozza, a gomb ne kezdjen
 * el hazudni.
 *
 * Ezt azert irom ide, hogy a kovetkezo olvaso ne keresse a hibat, ami ezt az
 * agat kivaltotta: nincs ilyen hiba. Ez egy nyitva hagyott ajto, nem egy
 * befoltozott lyuk.
 */
export interface AtvitelOsszege {
  /** Hany kepet vinnenk at. A mar lementettek NINCSENEK benne. */
  darab: number;
  /** Az atvitt bajtok, ha MINDEGYIK meret ismert. */
  bytes: number;
  /**
   * IGAZ, ha barmelyik meret hianyzik vagy ertelmetlen. Ilyenkor a `bytes`
   * NEM hasznalhato: a hivo ne irjon szamot a gombra.
   */
  ismeretlen: boolean;
}

export function atvitelOsszege(
  kepek: readonly { sizeBytes: number }[],
): AtvitelOsszege {
  let bytes = 0;
  let ismeretlen = false;
  for (const kep of kepek) {
    /*
      A NULLA IS ISMERETLENNEK SZAMIT, es ez dontes: egy nulla bajtos fajl
      nem letezik a gyakorlatban, viszont a hianyzo mezo alapertelmezese
      pontosan nulla lenne. A ket eset kozul a valoszinubbet valasztjuk, es a
      kar iranya is ezt tamogatja -- egy nem kiirt szam bosszanto, egy
      "0 B" felirat azt igeri, hogy ingyen van.
    */
    if (!Number.isFinite(kep.sizeBytes) || kep.sizeBytes <= 0) {
      ismeretlen = true;
      continue;
    }
    bytes += kep.sizeBytes;
  }
  return { darab: kepek.length, bytes, ismeretlen };
}
