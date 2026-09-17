import { unasRawRows } from "./unas-raw-list.js";

/**
 * A KAPCSOLAT-HIVATKOZASOK KIOLVASASA A TAROLT PILLANATKEPBOL.
 *
 * === MIERT KELL, HOLOTT A KLIENS IS KIOLVASSA ===
 *
 * A kliens az XML-fabol dolgozik (`XmlNode`), a `UnasProductSnapshot.rawPayload`
 * viszont JSON: a `nodePayload` rekurziv lekepezese, CamelCase kulcsokkal. A ket
 * BEMENET alakja kulonbozik, tehat egy kozos olvaso nem lehetseges anelkul,
 * hogy az egyik oldalt at ne alakitanank.
 *
 * AMI VISZONT KOZOS LEHET, AZ A SZABALY: a mezonevek es az `Id` kotelezosege.
 * Azok ITT allnak, egy helyen, es egy orzo (`unas-kapcsolat-hivatkozasok.spec.ts`)
 * meri, hogy a kliens forrasa UGYANEZEKET a neveket hasznalja.
 *
 * === A KET CSAPDA, AMIT EZ AZ OLVASO KIKERUL ===
 *
 * 1. EGY GYEREK ESETEN A `nodePayload` OBJEKTUMOT AD, nem egyelemu tombot. Egy
 *    csak tombre iro olvaso ilyenkor CSENDBEN nullat adna -- es epp az egy
 *    kapcsolatot viselo termek a leggyakoribb. Ezert megy az `unasRawRows`-on.
 * 2. A KIEGESZITO MEZO NEVE NEM "Accessory". Az export `AdditionalProducts` /
 *    `AdditionalProduct` neven adja; aki az "accessory" szora keres a forrasban,
 *    NULLAT kap. A kanonikus nev (`accessoryProducts`) csak nalunk letezik.
 */
export const KAPCSOLAT_MEZOK = {
  SIMILAR: { szulo: "SimilarProducts", elem: "SimilarProduct" },
  ACCESSORY: { szulo: "AdditionalProducts", elem: "AdditionalProduct" },
} as const;

export type KapcsolatFajta = keyof typeof KAPCSOLAT_MEZOK;

/** Egy hivatkozas, ugyanabban az alakban, amit a szinkron is hasznal. */
export interface KapcsolatHivatkozas {
  externalId: string;
  sku: string;
  name: string | null;
}

export interface KapcsolatOlvasas {
  hivatkozasok: KapcsolatHivatkozas[];
  /**
   * OLVASHATO VOLT-E A PILLANATKEP -- ES EZ NEM UGYANAZ, MINT A NULLA HIVATKOZAS.
   *
   * A ket eset TEENDOJE mas, es ezert nem szabad osszemosni:
   *
   *   olvashato, nulla hivatkozas   a forrasban NINCS kapcsolat. Amit nalunk
   *                                 talalunk, az elavult -- torolni kell.
   *   NEM olvashato                 nem tudjuk, mi van a forrasban. Itt a
   *                                 torles ADATVESZTES lenne, egy olyan
   *                                 allitas alapjan, amit meg sem mertunk.
   *
   * A hianyzo `SimilarProducts` mezo OLVASHATO: az azt jelenti, hogy a termek
   * nem visel kapcsolatot. A hianyzo vagy nem-objektum `rawPayload` viszont
   * nem.
   *
   * === ES EZ MERT FELTETEL, NEM MAGATOL ERTETODO (acrobot, 2026-09-17) ===
   *
   * A mezo CSAK azt nezi, hogy a `rawPayload` objektum-e. Egy REGEBBI
   * kinyeresbol valo pillanatkep ettol meg olvashato lenne -- es ha abban nincs
   * kapcsolat-mezo, a torlo ag HELYES sorokat vinne el. A kerdes tehat az, hogy
   * a HIANYZO kulcs ma mit jelent, es erre az adat valaszolt, ket fuggetlen
   * meressel az acropora_staging adatbazison:
   *
   *   pillanatkep osszesen                      1897
   *   SimilarProducts kulccsal                  1310
   *   AdditionalProducts kulccsal               1012
   *   nem-objektum rawPayload                      0
   *
   *   1. AZ IDOK ATFEDNEK: a kulcs NELKULI sorok legkorabbi irasa
   *      2026-09-04 05:39:59.643, a kulcsosake 05:39:59.227 -- ugyanaz a
   *      masodperc. A kulcs hianya tehat NEM regi alakot jelent.
   *   2. NINCS URES TAROLO: az 1310 kozott NULLA olyan van, ahol a
   *      `SimilarProducts` ott all, de nincs benne gyerek. Az export SOHA nem ir
   *      ki ures tarolot.
   *
   * VAGYIS MA a hianyzo kulcs azt jelenti, hogy a terméknek NINCS kapcsolata --
   * nem azt, hogy nem kerdeztuk meg.
   *
   * A FELTETEL, AMI EZT MEGFORDITANA: ha a kinyeres valaha RESZLEGESSE valik --
   * vagyis ugy irunk pillanatkepet, hogy a kapcsolat-mezoket nem kerdezzuk le
   * --, akkor ugyanaz a hiany mar azt jelentene, hogy NEM TUDJUK, es a torlo ag
   * helyes sorokat vinne el. Aki ilyen valtozast vezet be, ezt a mezot is
   * atirja: az `olvashato` akkor mar nem a payload alakjarol szol, hanem arrol,
   * hogy a kapcsolat-mezoket LEKERDEZTUK-e.
   */
  olvashato: boolean;
  /**
   * HANY HIVATKOZAS MARADT KI AZONOSITO NELKUL -- SZAMKENT, NEM CSENDBEN.
   *
   * A kliens ugyanezt teszi: `Id` nelkul a hivatkozas feloldhatatlan, tehat
   * kimarad. De egy nemán eldobott hivatkozas ugy nez ki, mint egy termek,
   * aminek nincs is kapcsolata -- es akkor senki nem keresne tovabb.
   */
  azonositoNelkul: number;
}

function szoveg(ertek: unknown): string {
  return typeof ertek === "string" ? ertek.trim() : "";
}

/**
 * A tarolt pillanatkep egy fajta kapcsolat-hivatkozasai.
 *
 * A HIANYZO MEZO URES LISTA, NEM HIBA: egy termeknek lehet, hogy nincs
 * kapcsolata, es az ugyanolyan ervenyes allapot, mint a tobbi.
 */
export function kapcsolatHivatkozasok(
  rawPayload: unknown,
  fajta: KapcsolatFajta,
): KapcsolatOlvasas {
  const mezok = KAPCSOLAT_MEZOK[fajta];
  const olvashato = Boolean(
    rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload),
  );
  const gyoker = olvashato ? (rawPayload as Record<string, unknown>) : {};
  const szulo = gyoker[mezok.szulo];
  const sorok =
    szulo && typeof szulo === "object" && !Array.isArray(szulo)
      ? unasRawRows((szulo as Record<string, unknown>)[mezok.elem])
      : [];

  const hivatkozasok: KapcsolatHivatkozas[] = [];
  let azonositoNelkul = 0;
  for (const sor of sorok) {
    const externalId = szoveg(sor.Id);
    if (!externalId) {
      azonositoNelkul += 1;
      continue;
    }
    hivatkozasok.push({
      externalId,
      sku: szoveg(sor.Sku),
      // A NEV ELHAGYHATO, es a hianya `null`, nem ures sztring: a szinkron
      // ugyanezt az alakot hasznalja, es a ketto kulonbozik -- az ures sztring
      // azt allitana, hogy a nev ISMERT es ures.
      name: szoveg(sor.Name) || null,
    });
  }
  return { hivatkozasok, azonositoNelkul, olvashato };
}
