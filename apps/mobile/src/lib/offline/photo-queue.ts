import type { SyncQueueRow } from "./sync-queue";

/**
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
  const rogzitesek = rows.filter((r) => r.operation === "create");
  if (rogzitesek.length > 0) {
    /**
     * AMIG VAN FEL NEM MENT ROGZITES, A FOTOK VARNAK. Nem azert, mert lassuk --
     * hanem mert egy kep, aminek a rogzitese meg a sorban all, nem tud hova
     * felkerulni.
     */
    return [...rogzitesek, ...modositasok];
  }
  const kepek = rows.filter((r) => {
    if (r.operation !== "upload-photo") return false;
    const payload = readPhotoPayload(r.payloadJson);
    /**
     * A GAZDATLAN KEP NEM MEGY EL. Ha a hozza tartozo rogzites nincs a
     * felmentek kozott ES nincs a sorban sem, akkor valami elveszett -- es egy
     * ilyen kep feltoltese a szerveren hibat adna, amit a sor konfliktusnak
     * sorolna, es a kep orokre elakadna.
     */
    return (
      payload !== null && felmentRogzitesek.has(payload.recordingOperationId)
    );
  });
  return [...modositasok, ...kepek];
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
