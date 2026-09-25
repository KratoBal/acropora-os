/**
 * A `WorksheetAssetPicker` TISZTA RÉSZE: mit mutat a lista, milyen sorrendben.
 *
 * Balázs 2026-09-25 16:15-i telefonos képe (a #1139 kiadása után): a
 * helyszín TELJES eszközlistája egy véget nem érő, kereső nélküli listaként
 * jelent meg, kijelölt tétel nélküli rendezésben -- egy tucatnyi eszközös
 * helyszínen (BIO/ETB) ez használhatatlan görgetést jelentett. Ez a fájl a
 * DÖNTÉST tartalmazza (mi látszik, milyen sorrendben), mert ott MÉRHETŐ --
 * a képernyőn csak a hívás és a kirajzolás marad.
 */

/** Csak amit a szűrés és a rendezés használ -- lásd `JegyEszkoz` hasonló
 * mintáját a `worksheet-inherit-from-ticket.ts`-ben. */
export interface KereshetoEszkoz {
  id: string;
  name: string;
  assetNumber: string;
  partnerInternalCode?: string;
}

/**
 * A KIJELÖLT TÉTEL AKKOR IS LÁTSZIK, HA A KERESÉS NEM TALÁLNÁ MEG -- a
 * szerelő így mindig lát visszaigazolást a saját választásáról, és nem kell
 * a keresést törölnie ahhoz, hogy ellenőrizze, mi van bepipálva. A
 * KIJELÖLETLEN RÉSZT viszont SZŰRI a keresés, mert épp az a célja: új tétel
 * MEGTALÁLÁSA egy nagy listában.
 *
 * A SORREND A BEMENETI LISTA SORRENDJÉT ŐRZI MINDKÉT CSOPORTON BELÜL --
 * nincs kitalált másodlagos rendezés (pl. ábécé), mert a szerver válasza
 * eddig sem ígért ilyet, és egy hozzáadott rendezés a szervertől kapott
 * sorrendet (amiről nem tudni, mit hordoz) csendben felülírná.
 */
export function partitionEszkozokAValasztohoz<
  T extends KereshetoEszkoz,
>(bemenet: {
  osszes: readonly T[];
  kivalasztottIdk: readonly string[];
  kereses: string;
}): { kivalasztottak: T[]; kijeloletlenTalalatok: T[] } {
  const kifejezes = bemenet.kereses.trim().toLowerCase();
  const egyezik = (szoveg: string | undefined): boolean =>
    (szoveg ?? "").toLowerCase().includes(kifejezes);

  const kivalasztottak: T[] = [];
  const kijeloletlenTalalatok: T[] = [];
  for (const jelolt of bemenet.osszes) {
    if (bemenet.kivalasztottIdk.includes(jelolt.id)) {
      kivalasztottak.push(jelolt);
      continue;
    }
    if (
      kifejezes.length === 0 ||
      egyezik(jelolt.name) ||
      egyezik(jelolt.assetNumber) ||
      egyezik(jelolt.partnerInternalCode)
    ) {
      kijeloletlenTalalatok.push(jelolt);
    }
  }
  return { kivalasztottak, kijeloletlenTalalatok };
}

/**
 * EGY HOSSZÚ LISTA ELSŐ SZELETE, ÉS A REJTETT DARABSZÁM.
 *
 * `mindetMutat` esetén a teljes lista látszik -- ez a "Továbbiak" gomb
 * megnyomása utáni állapot, nem egy külön lapozás. A hívó dönti el, mikor
 * kapcsol át (lásd a komponens `tobbitMutat` állapotát).
 */
export function lathatoReszlet<T>(
  lista: readonly T[],
  limit: number,
  mindetMutat: boolean,
): { lathato: T[]; rejtettSzam: number } {
  if (mindetMutat || lista.length <= limit) {
    return { lathato: [...lista], rejtettSzam: 0 };
  }
  return {
    lathato: lista.slice(0, limit),
    rejtettSzam: lista.length - limit,
  };
}

/**
 * MONDAT A KERESÉS NULLA TALÁLATÁRA -- csak akkor, ha VAN mit keresni (a
 * helyszínen legalább egy eszköz áll) és a keresés szövege nem üres. Ez
 * KÜLÖNBÖZIK a `describeSelectableAssets` "nincs felvett eszköz a
 * helyszínen" mondatától: az a helyszín tulajdonsága, ez a keresésé.
 */
export function keresesNullaTalalatUzenet(bemenet: {
  vanEszkozAHelyszinen: boolean;
  kereses: string;
  kivalasztottakSzama: number;
  kijeloletlenTalalatokSzama: number;
}): string | null {
  if (!bemenet.vanEszkozAHelyszinen) return null;
  if (bemenet.kereses.trim().length === 0) return null;
  if (bemenet.kivalasztottakSzama > 0 || bemenet.kijeloletlenTalalatokSzama > 0)
    return null;
  return "A keresésre nincs találat ezen a helyszínen.";
}
