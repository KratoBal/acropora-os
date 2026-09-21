import type { SyncQueueRow } from "./sync-queue";

/**
 * A SOR SORRENDJE ES FUGGOSEGEI. A foto ennek EGY ESETE, nem a targya.
 *
 * 2026-09-16 ota a `nextBatch` ALTALANOS szabalyt hordoz: barmelyik sor varhat
 * barmelyik masikra (`dependsOnOperationId`), es a foto ennek a SPECIALIS
 * ESETE. A fajl neve viszont `photo-queue.ts` maradt, tehat aki a sor
 * fuggoseg-szabalyat kereste, nem itt kereste.
 *
 * ATNEVEZVE 2026-09-21-en, kulon korben, ahogy az elozo fejlec elore
 * megmondta. A SZAMA VISZONT ELAVULT: tizenegy hivatkozast igert, es
 * TIZENKETTO lett -- kozben egy uj fogyaszto keletkezett. Ezert all itt a
 * szam helyett az, hogy MI lett atirva: minden import (negy kulonbozo alakban,
 * az `@/` aliast is beleertve), minden NEV SZERINTI komment-hivatkozas, es a
 * `docs/MOBILE-DEVELOPMENT.md`-ben allo mutato.
 *
 * ES EGY CSAPDA, AMIBE BELE IS LEPTEM: a tomeges csere ezt a FEJLECET is
 * atirta, es ettol egy IGAZ mondat ("a fajl neve viszont `photo-queue.ts`
 * maradt") HAMISSA valt. Egy atnevezesnel a regi nevet IDEZO magyarazat nem
 * hivatkozas, hanem TORTENET -- azt nem cserelni kell, hanem megtartani.
 *
 * === A FOTO-SPECIFIKUS RESZEK ITT MARADTAK, ES EZ DONTES ===
 *
 * A modul ketfele dolgot exportal: a sorrend-szabalyt (`nextBatch`,
 * `dependencyOf`, `dependencyResolved`, `batchForPass`) es a foto sorainak
 * payload-segedeit (`PhotoPayload`, `photoOperationId`, `readPhotoPayload`,
 * `describePhotoBacklog`). A ketto SZETVALASZTASA kezenfekvo lenne, es
 * szandekosan nem tortent meg: az TERVEZESI valtozas, amit senki nem kert, es
 * egy atnevezes diffjeben rejtve menne at.
 *
 * Amit a nev igy iger: a modul MAGJA a sorrend. A foto-segedek azert allnak
 * itt, mert a fuggoseget OK allitjak elo -- ha egyszer masik sor-fajta is kap
 * sajat payload-segedet, AKKOR lesz indok a szetvalasztasra, nem elobb.
 *
 * A FOTO A ROGZITES UTAN MEGY -- ES EZ NEM SORREND-IZLES, HANEM FUGGOSEG.
 *
 * Balazs dontese (2026-09-03): "Elmehet a munkalap elobb de menjen utana a foto
 * is amint lehet." A masodik fele a nehezebb, es a merce is abbol jon: NEM az a
 * kerdes, hogy a rogzites felkerul-e, hanem hogy a FOTO KESOBB felkerul-e.
 *
 * Egy rogzites, ami sosem kapja meg a kepeit, SIKERES SZINKRONNAK latszik: a
 * sor kiurult, a jelentes zold, es a kep egyszeruen nincs sehol.
 *
 * === MIERT NEM CSAK SORREND ===
 *
 * A kep egy MAR LETEZO szerver-oldali eszkozhoz kapcsolodik. Amig a rogzites
 * nem ment fel, nincs szerver-azonosito, tehat a kepnek nincs MIHEZ
 * kapcsolodnia. A ket menet (eloszor minden `create`, aztan minden
 * `upload-photo`) tehat nem gyorsitas: e nelkul a kep-feltoltes ELBUKNA.
 */

/** A fotot vivo sor payloadja. A KEP maga a telefonon marad, csak az utja megy. */
export interface PhotoPayload {
  /** A helyi fajl utja, ahogy a kepvalaszto adta. */
  uri: string;
  name: string;
  type: string;
  /**
   * ANNAK A ROGZITESNEK A MUVELET-AZONOSITOJA, amihez a kep tartozik.
   *
   * NEM a szerver-oldali eszkoz-azonosito: az a felvitel felmenetelekor
   * keletkezik, es a kep sorba tetelekor MEG NEM LETEZIK. Ez a mezo koti ossze
   * a kettot, amig a szerver-azonosito meg nincs meg.
   *
   * ELHAGYHATO 2026-09-17 OTA, ES EZ NEM LAZITAS. Egy MAR LETEZO gazdahoz
   * (munkalap, hibajegy, eszkoz) tartozo kep SENKIRE NEM VAR: a szerver-oldali
   * azonosito a sorba tetelkor mar megvan, es a sor `entity_id` mezojebe
   * kerul. Ott ez a mezo nem hianyzik, hanem ERTELMETLEN -- es ha kotelezo
   * maradna, a kitoltese HAZUGSAG lenne: egy nem letezo rogzitesre hivatkozna,
   * amire a sor aztan OROKRE varna.
   */
  recordingOperationId?: string;
}

/**
 * A KEP SOR-AZONOSITOJA IS A TARTALOMBOL SZULETIK, ugyanabbol az okbol, mint a
 * rogzitese (`sync-queue.ts` `operationId`): a ketszer megnyomott gomb ugyanazt
 * a kulcsot adja, es a masodik beszuras csendben elesik ahelyett, hogy ugyanaz
 * a kep KETSZER menne fel.
 *
 * A ROGZITES AZONOSITOJA IS BENNE VAN, nem csak az `uri`. Ugyanaz a fajl ket
 * KULON rogziteshez tartozhat (a szerelo ugyanazt a kepet valasztja ki
 * ketszer, ket eszkozhoz), es azok ket kulon feltoltes.
 */
export function photoOperationId(input: {
  recordingOperationId: string;
  uri: string;
}): string {
  return `asset-photo:${input.recordingOperationId}:${input.uri}`;
}

/**
 * EGY MAR LETEZO GAZDAHOZ TARTOZO KEP SOR-AZONOSITOJA.
 *
 * UGYANAZ AZ ELV, MAS A HORGONY: ott a rogzites muvelet-azonositoja koti meg a
 * kulcsot, itt a gazda SZERVER-oldali azonositoja -- mert az mar letezik.
 *
 * A GAZDA FAJTAJA IS BENNE VAN, nem csak az azonosito. Ket kulonbozo fajta
 * azonositoja elvben egyezhet (kulon tablak, kulon kulcsterek), es akkor
 * ugyanaz a fajl ket kulon feltoltese egyetlen sorra esne ossze -- a masodik
 * csendben elesne.
 */
export function ownerPhotoOperationId(input: {
  entityType: string;
  ownerId: string;
  uri: string;
}): string {
  return `owner-photo:${input.entityType}:${input.ownerId}:${input.uri}`;
}

/**
 * MELYIK ROGZITESEK MENTEK MAR FEL -- ES MIERT EPP A KEP SORA MONDJA MEG.
 *
 * A rogzites sora a szerver nyugtazasakor TOROLVE lesz (ez a protokoll: a
 * helyi bizonyitek csak akkor mehet). Vagyis a "mar felment" tenynek a
 * torles utan EGYETLEN nyoma marad: a kep sorara felirt szerver-oldali
 * azonosito (`entityId`).
 *
 * Ezert nem lehet ezt a halmazt a rogzites-sorok HIANYABOL kikovetkeztetni: a
 * hianyzas azt is jelentheti, hogy a rogzites SOSEM letezett -- es epp az a
 * gazdatlan kep, amit vissza kell tartani.
 */
/**
 * MIRE VAR EZ A SOR -- AZ OSZLOPBOL, VAGY A PAYLOADBOL, HA A SOR REGI.
 *
 * === MIERT KET FORRAS, ES MIERT NEM CSAK AZ OSZLOP ===
 *
 * A `depends_on_operation_id` oszlop 2026-09-16-tol letezik. A keszuleken MAR
 * sorban allo kepeken `null` -- es egy `null`-t "nincs fuggoseg"-nek venni azt
 * jelentene, hogy azok a kepek a rogzitesuk ELOTT indulnanak el. A szerver
 * elutasitana oket, a sor konfliktusnak sorolna, es a kep OROKRE elakadna.
 *
 * Ez FORDITOTT eset, mint a `last_attempt_at`-e: ott a hianyzo ertek helyes
 * alapertelmezese az "esedekes" volt, mert a varakoztatas hianya csak korabbi
 * inditast jelent. Itt a fuggoseg hianya ROSSZ iranyba enged.
 *
 * === MEDDIG KELL ===
 *
 * Amig letezhet olyan sor, ami a migracio ELOTT keletkezett. Ha egyszer
 * biztosak vagyunk benne, hogy nincs (a sor kiurult mindenhol), ez az ag
 * elhagyhato -- de addig NEM csendben all itt, hanem kiirva.
 */
export function dependencyOf(row: SyncQueueRow): string | null {
  if (row.dependsOnOperationId) return row.dependsOnOperationId;
  if (row.operation !== "upload-photo") return null;
  return regiFotoFuggoseg(row.payloadJson);
}

/**
 * A REGI SOR FUGGOSEGE, A KULDES-ALAKTOL FUGGETLENUL.
 *
 * KULON OLVASO, ES EZT EGY PIROS TESZT KERTE (2026-09-17). Eloszor a
 * `readPhotoPayload`-ot hasznaltam ide, es amikor azt SZIGORITOTTAM (a kuldes
 * a `name` es a `type` mezot is igenyli), ez a fuggveny CSENDBEN elvesztette a
 * fuggoseget egy olyan sornal, aminek csak az `uri`-ja es a rogzitese volt meg.
 *
 * ES A KAR NEM ELMELETI: fuggoseg nelkul a sor SZABADNAK latszana, tehat a
 * rogzitese ELOTT indulna el -- a szerver elutasitana, a sor konfliktusnak
 * sorolna, es a kep OROKRE elakadna.
 *
 * A KETTO KET KULON KERDES: mire var ez a sor (csak a rogzites-azonosito
 * kell hozza), es elkuldheto-e (ahhoz a teljes fajl-alak kell). Egy olvaso
 * mind a kettore azt jelenti, hogy a szigoritas az egyiken a masikat is
 * elmozditja.
 */
function regiFotoFuggoseg(json: string): string | null {
  try {
    const p = JSON.parse(json) as { recordingOperationId?: unknown };
    return typeof p.recordingOperationId === "string" &&
      p.recordingOperationId.length > 0
      ? p.recordingOperationId
      : null;
  } catch {
    return null;
  }
}

/**
 * MEGKAPTA-E MAR EZ A SOR AZT AZ AZONOSITOT, AMIRE VART.
 *
 * A VALASZ HELYE A SORON ALL, NEM A FAJTAJAN. Az `attachRecordingResult` ket
 * helyre tud irni, es a sor `depends_on_target` mezoje mondja meg, melyikbe:
 *
 *   entityId (vagy hianyzik)  -> a sor SAJAT `entity_id` mezojebe. A kepek igy,
 *                               es a REGI sorok is, ahol a cel meg nem letezett.
 *   barmi mas                 -> a payload EZEN a kulcsan, mert a hivasnak a
 *                               TORZSBEN kell vinnie a szulot (egy munkalap a
 *                               jegy azonositojat a torzsben kuldi).
 */
export function dependencyResolved(row: SyncQueueRow): boolean {
  const cel = row.dependsOnTarget ?? "entityId";
  if (cel === "entityId") return row.entityId !== null;
  try {
    const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    const ertek = payload[cel];
    return typeof ertek === "string" && ertek.length > 0;
  } catch {
    // SERULT SOR: nem nyugtazott. A kuldes ugyis elbukna rajta, es ott
    // legalabb megnevezett hibat ad.
    return false;
  }
}

/**
 * AMIRE MAR NEM KELL VARNI.
 *
 * === MIERT NEM CSAK A FOTOKAT NEZI (2026-09-17) ===
 *
 * Eddig ez a fuggveny `upload-photo` sorokat keresett, kitoltott `entity_id`
 * mezovel -- vagyis a NYUGTAZAS JELE a fajtahoz volt kotve. A munkalap a jegy
 * alatt MASHOVA kapja az azonositot (a payload `serviceJobId` kulcsara), tehat
 * a regi alak szerint a jegy SOHA nem szamitott volna nyugtazottnak.
 *
 * ES EZ A BUKAS NEM HANGOS: a sor nem hibazik es nem utasitja el senki -- csak
 * nem urul ki soha, a jelentes pedig azt mondja, hogy varakozik. Ami igaz is.
 *
 * A jel mostantol az, hogy a sor MEGKAPTA-E az azonositot (`dependencyResolved`),
 * fuggetlenul attol, melyik mezobe. A fotokra ez beture ugyanazt a halmazt adja.
 */
export function acknowledgedRecordings(
  rows: readonly SyncQueueRow[],
): Set<string> {
  const halmaz = new Set<string>();
  for (const row of rows) {
    const fuggoseg = dependencyOf(row);
    if (fuggoseg === null) continue;
    if (dependencyResolved(row)) halmaz.add(fuggoseg);
  }
  return halmaz;
}

/**
 * MI KULDHETO EL MOST, ES MI NEM.
 *
 * A ket menet ITT dol el, nem a lekerdezes sorrendjeben: eloszor minden
 * rogzites, es a fotok kozul CSAK az, amelyiknek a rogzitese MAR felment.
 *
 * A `felmentRogzitesek` azoknak a muvelet-azonositoit tartalmazza, amiket a
 * szerver nyugtazott -- vagyis amik mar NINCSENEK a sorban.
 */
export function nextBatch(
  rows: readonly SyncQueueRow[],
  felmentRogzitesek: ReadonlySet<string>,
): SyncQueueRow[] {
  /**
   * A MODOSITAS MINDIG MEHET, ES EZ NEM KIVETEL, HANEM A SZABALY MASIK FELE.
   *
   * A ket menet oka a FUGGOSEG: a kep a rogzitesere var, mert amig az fel nem
   * ment, nincs hova kerulnie. A modositas celpontja viszont MAR OTT VAN a
   * szerveren -- kulonben nem lehetne szerkeszteni --, tehat se nem var, se nem
   * varakoztat.
   *
   * EZERT SZEREPEL MINDKET AGBAN. Ha csak az elsoben allna, egy ismetelten
   * elbukó rogzites (ami `failed` allapotban a sorban marad) VEGTELENUL
   * feltartana minden modositast; ha csak a masodikban, akkor egy varakozo
   * rogzites tartana fel oket. Egyik sem igaz rola.
   */
  const modositasok = rows.filter((r) => r.operation === "update");
  /**
   * AMI SENKIRE NEM VAR, AZ MEHET -- ES EZ MOSTANTOL A MUVELET TIPUSATOL
   * FUGGETLEN.
   *
   * Eddig itt `operation === "create"` allt, es a szabaly igy a TIPUSHOZ volt
   * kotve. Egy harmadik szint (munkalap a JEGY alatt, ahol mind a ketto
   * `create`) ebbe nem fert bele: a regi alak MIND A KETTOT elengedte volna
   * ugyanabban a menetben, es a munkalap a meg nem letezo jegyre hivatkozott
   * volna.
   */
  const szabadok = rows.filter(
    (r) => r.operation !== "update" && dependencyOf(r) === null,
  );
  /**
   * AMI BLOKKOL, AZ NEM UGYANAZ, MINT AMI SZABAD -- ES EZ A KULONBSEG
   * 2026-09-17 OTA ALL ITT.
   *
   * A varakoztatas oka a FUGGOSEG: a kep a rogzitesere var, mert amig az fel
   * nem ment, nincs hova kerulnie. Ebbol az kovetkezik, hogy csak az
   * varakoztathat, amire VALAKI VARHAT -- es egy `upload-photo` sorra SOHA
   * senki nem var: a sorban semmi nem hivatkozik egy kep muvelet-azonositojara.
   *
   * MIERT KELLETT: egy MAR LETEZO munkalaphoz tartozo kep fuggoseg nelkuli
   * sor, tehat a regi alak szerint a `szabadok` halmazba esett volna -- es amig
   * ott all (peldaul mert a halozat ismetelten elbukik rajta), MINDEN olyan
   * kep varna, ami a sajat rogzitesere var. Nema karral: a sor nem hibazik,
   * csak nem urul ki.
   *
   * A REGI VISELKEDES VALTOZATLAN minden mas sorra: egy fel nem ment FELVITEL
   * tovabbra is varakoztat, mert arra tenylegesen varnak a kepei.
   */
  const blokkolok = szabadok.filter((r) => r.operation !== "upload-photo");
  const szabadKepek = szabadok.filter((r) => r.operation === "upload-photo");
  if (blokkolok.length > 0) {
    /**
     * AMIG VAN FEL NEM MENT, FUGGETLEN ROGZITES, A VAROK VARNAK. Nem azert,
     * mert lassuk -- hanem mert amire varnak, az meg a sorban all.
     *
     * A fuggoseg nelkuli KEPEK viszont mehetnek ugyanebben a menetben: rajuk
     * senki nem var, es ok sem varnak senkire.
     */
    return [...szabadok, ...modositasok];
  }
  const varok = rows.filter((r) => {
    if (r.operation === "update") return false;
    const fuggoseg = dependencyOf(r);
    /**
     * A GAZDATLAN SOR NEM MEGY EL. Ha amire var, az nincs a felmentek kozott
     * ES nincs a sorban sem, akkor valami elveszett -- es egy ilyen sor
     * elkuldese a szerveren hibat adna, amit a sor konfliktusnak sorolna, es
     * orokre elakadna.
     */
    return fuggoseg !== null && felmentRogzitesek.has(fuggoseg);
  });
  /**
   * A SZABAD KEPEK ITT IS MENNEK -- ES EZT EGY SAJAT PIROS TESZT KERTE.
   *
   * Az elso alakomban ez a sor csak a modositasokat es a varokat adta vissza,
   * a fuggoseg nelkuli kepeket viszont EGYIK ag sem: a felso agat a
   * `blokkolok` ures halmaza zarta ki, az alsobol pedig kimaradtak, mert nem
   * varnak senkire. Vagyis a szukiteesem epp azt a sort tuntette volna el,
   * amiert keszult.
   *
   * A hiba NEM volt hangos: a sor nem hibazik es nem akad el, csak SOHA nem
   * urul ki -- pontosan az az alak, amit ez a modul mashol mar gyujt.
   */
  return [...modositasok, ...szabadKepek, ...varok];
}

/** A sor payloadja fotokent, vagy `null`, ha nem az. */
export function readPhotoPayload(json: string): PhotoPayload | null {
  try {
    const p = JSON.parse(json) as Partial<PhotoPayload>;
    /**
     * A ROGZITES-AZONOSITO MAR NEM KOTELEZO, A FAJL UTJA IGEN.
     *
     * Ami a KULDESHEZ kell, az az `uri`, a `name` es a `type` -- a
     * rogzites-azonosito csak a VARAKOZASHOZ. Egy mar letezo gazdahoz tartozo
     * kepnel nincs mire varni, tehat a kotelezove tetele epp a helyes sort
     * utasitana el, 422-vel, "ertelmezhetetlen payload" cimen.
     */
    return typeof p.uri === "string" &&
      typeof p.name === "string" &&
      typeof p.type === "string"
      ? (p as PhotoPayload)
      : null;
  } catch {
    return null;
  }
}

/**
 * EGY MENET SORAI: amit a `nextBatch` elenged, ES ami ebbe a menetbe tartozik.
 *
 * A SZURES NEM A `nextBatch` MEGISMETLESE. A `nextBatch` a SORRENDET adja; ez
 * a szures azt zarja ki, hogy egy ELBUKOTT rogzites a MASODIK menetben ujra
 * elinduljon. A bukas utan a sor `failed` allapotba kerul, ami tovabbra is
 * kuldheto -- vagyis e nelkul ugyanaz a felvitel KETSZER menne el egyetlen
 * futasban, es a szerveren KET eszkoz keletkezne. (A felviteli vegpont ma nem
 * ismeri a muvelet-azonositot, tehat a masodik peldanyt nem tudna kiszurni.)
 */
export function batchForPass(
  rows: readonly SyncQueueRow[],
  muvelet: SyncQueueRow["operation"],
): SyncQueueRow[] {
  return nextBatch(rows, acknowledgedRecordings(rows)).filter(
    (r) => r.operation === muvelet,
  );
}

/**
 * A MERCE MONDATA: nem az, hogy a rogzites felment, hanem hogy a KEP is.
 *
 * `null`, ha nincs mit mondani -- se rogzites, se kep nem var.
 */
export function describePhotoBacklog(counts: {
  recordings: number;
  photos: number;
}): string | null {
  if (counts.recordings === 0 && counts.photos === 0) return null;
  if (counts.photos === 0) {
    return `${counts.recordings} rögzítés vár feltöltésre.`;
  }
  if (counts.recordings === 0) {
    /**
     * EZ AZ AG A LENYEG. A rogzitesek felmentek, a kepek NEM -- es ez pontosan
     * az az allapot, ami "sikeres szinkronnak" latszana, ha csak a
     * rogziteseket szamolnank.
     */
    return `${counts.photos} fénykép még nem ment fel a már rögzített eszközökhöz.`;
  }
  return `${counts.recordings} rögzítés és ${counts.photos} fénykép vár feltöltésre.`;
}
