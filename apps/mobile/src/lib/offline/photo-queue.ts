import type { SyncQueueRow } from "./sync-queue";

/**
 * EZ A MODUL MAR NEM CSAK A FOTOKROL SZOL, ES A NEVE EZT NEM MONDJA MEG.
 *
 * 2026-09-16 ota a `nextBatch` ALTALANOS szabalyt hordoz: barmelyik sor varhat
 * barmelyik masikra (`dependsOnOperationId`), es a foto ennek a SPECIALIS
 * ESETE. A fajl neve viszont `photo-queue.ts` maradt -- vagyis aki a sor
 * fuggoseg-szabalyat keresi, nem itt fogja keresni.
 *
 * AZ ATNEVEZES TUDATOSAN MARADT KI EBBOL A KORBOL: tizenegy hivatkozast
 * mozgatna, ugyanabban a valtozasban, ami a sor VISELKEDESET irja at -- es a
 * ket fajta diff egymast fedne el pont akkor, amikor az atnezes a legtobbet
 * er. Kulon kartyan all.
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
   */
  recordingOperationId: string;
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
  return readPhotoPayload(row.payloadJson)?.recordingOperationId ?? null;
}

export function acknowledgedRecordings(
  rows: readonly SyncQueueRow[],
): Set<string> {
  const halmaz = new Set<string>();
  for (const row of rows) {
    if (row.operation !== "upload-photo" || row.entityId === null) continue;
    const payload = readPhotoPayload(row.payloadJson);
    if (payload !== null) halmaz.add(payload.recordingOperationId);
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
  if (szabadok.length > 0) {
    /**
     * AMIG VAN FEL NEM MENT, FUGGETLEN SOR, A VAROK VARNAK. Nem azert, mert
     * lassuk -- hanem mert amire varnak, az meg a sorban all.
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
  return [...modositasok, ...varok];
}

/** A sor payloadja fotokent, vagy `null`, ha nem az. */
export function readPhotoPayload(json: string): PhotoPayload | null {
  try {
    const p = JSON.parse(json) as Partial<PhotoPayload>;
    return typeof p.uri === "string" &&
      typeof p.recordingOperationId === "string"
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
