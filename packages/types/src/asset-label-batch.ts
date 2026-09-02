/**
 * KODOK GENERALASA: hany kod keszuljon, es milyen alakban.
 *
 * A KOD ALAKJA BALAZSE (egy betu es negy szam, pelda V2196, a `42056ab0`
 * kartyan). Amit ITT eldontunk, az csak annyi, hogy a negy szamjegyet es a
 * betut HOGYAN valasztjuk ki.
 *
 * VELETLEN, NEM SORFOLYTONOS -- es ez dontes, nem szokas. Ket oka van:
 *
 * 1. AMIT MEGFIGYELTUNK: a Balazstol kapott pelda `V2196`. Egy sorfolytonos
 *    kiadas `A0001`-tol indulna, tehat az elso iv csupa `A`-val kezdodne. A
 *    megfigyelt alak veletlenszeru.
 * 2. AMI VISZONT NEM INDOK: a kitalalhatosag. Ot karakter 260 ezer lehetoseg,
 *    ami vegigprobalhato -- a vedelem NEM a kod erossege, hanem a
 *    tulajdon-ellenorzes a lekerdezesen (`detailByLabelCode`). Ezt azert kell
 *    kimondani, mert kulonben valaki egyszer "biztonsagi okbol" hosszabb kodot
 *    javasolna, es kozben ugy hinne, hogy ez volt a vedelem.
 *
 * A SORFOLYTONOS ALAK IS MUKODNE, es fizikai iven olvashatobb is lenne. Ha
 * egyszer valaki azt keri, ez a fuggveny az egyetlen hely, ami valtozik.
 */
const BETUK = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Egy kod-jelolt. A hivo dolga eldonteni, hogy szabad-e meg. */
export function randomAssetLabelCode(
  random: () => number = Math.random,
): string {
  const betu = BETUK[Math.floor(random() * BETUK.length)] ?? "A";
  const szam = Math.floor(random() * 10000)
    .toString()
    .padStart(4, "0");
  return `${betu}${szam}`;
}

/**
 * A KERT DARABSZAM HATARAI.
 *
 * A felso hatar nem onkenyes: egy iv veges, es egy elgepelt szam (10 helyett
 * 1000) FIZIKAI kovetkezmennyel jar -- valaki kinyomtatja. A hatar itt all, egy
 * helyen, hogy a szerver es a felulet ne mondhasson mast.
 */
export const ASSET_LABEL_BATCH_MIN = 1;
export const ASSET_LABEL_BATCH_MAX = 500;

/** Egy generalasi tetel, ahogy a lista mutatja. */
export interface AssetLabelBatchSummary {
  id: string;
  /** ISO idopont. A felulet PERCRE pontosan mutatja. */
  createdAt: string;
  /** Hany kod keszult ebben a tetelben. */
  count: number;
  /**
   * Hany szabad meg BELOLE.
   *
   * A MEG NEM REGISZTRALT kodok szama, vagyis ahol nincs eszkoz. NEM azonos
   * azzal, hogy hany matrica van meg KINYOMTATATLANUL vagy felragasztatlanul:
   * a nyomtatas tenyet ma sehol nem rogzitjuk, tehat arra a kerdesre NINCS
   * forrasunk. Ha egyszer felmerul, az hianyzo adat, nem szamitasi kerdes.
   */
  freeCount: number;
}

/**
 * A NYOMTATHATO LISTA, PONTOSAN ABBAN AZ ALAKBAN, AMIT MAR HASZNALUNK.
 *
 * NEM UJ FORMATUM: az elso, eles iv (2026-09-02, tiz kod) igy nezett ki, es a
 * nyomtato oldal erre van beallitva. A szerkezetet MERTEM, nem emlekezetbol
 * irtam: `exchange/qr-kodok-2026-09-02/qr-kodok-proba-10-rovid.csv`.
 *
 * HAROM RESZLET, AMI NEM SZEPSEGHIBA, HA ELVESZ:
 *
 *   BOM (`﻿`)   -- enelkul az Excel az ekezetes szoveget elrontja. Ma
 *                       nincs ekezet a fajlban, de a fejlec vagy a felirat
 *                       oszlop barmikor kaphat -- es akkor MAR keso.
 *   CRLF sorvege     -- windowsos eszkoz nyitja meg. LF-fel a sorok
 *                       osszecsuszhatnak.
 *   PONTOSVESSZO     -- nem vesszo. Magyar podorendszerben az Excel a
 *                       pontosvesszot varja oszlopvalasztonak; vesszovel az
 *                       egesz sor EGY cellaba kerul.
 *
 * Mindharomra all allitas a tesztben. Egy kesobbi "takaritas" (ki hasznal ma
 * BOM-ot?) enelkul csendben elvinne oket, es a hiba a NYOMTATASNAL derulne ki.
 *
 * A KET OSZLOP MA UGYANAZ (`kod;felirat`), es ez SZANDEKOS masolat: nem tudjuk,
 * mire hasznalja a nyomtato oldal a masodikat, tehat nem vonjuk ossze eggyé.
 */
export function assetLabelCsv(codes: readonly string[]): string {
  const sorok = ["kod;felirat", ...codes.map((code) => `${code};${code}`)];
  return "﻿" + sorok.join("\r\n") + "\r\n";
}
