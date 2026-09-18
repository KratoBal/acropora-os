/**
 * A MAR LEZART LAPOKHOZ UTOLAG KESZULO KIADOTT MUNKALAP -- a dontesi resze.
 *
 * === A MERT HIANY ===
 *
 * A kiadott lapot a `close()` allitja elo, a lezarasi tranzakcion belul, es a
 * lezaras EGYSZERI es vegleges. A kepesseg 2026-09-18 14:09:31-kor olvadt be
 * (#847); az elesen addigra NEGY lezart munkalap allt, mind korabbrol, es
 * GENERATED_SHEET dokumentum az egesz adatbazisban NULLA volt. Ez a negy lap
 * magatol SOHA nem kapna kiadott peldanyt.
 *
 * Balazs jovahagyta az eles futast (2026-09-18 18:49:23 UTC, Discord fo
 * csatorna, message_id 1550549311371223092, szo szerint: "Igen").
 *
 * === MIERT KULON MODUL A PARANCSTOL ===
 *
 * Ez a resz dontes (mely verziohoz kell lap, mit jelent a lefedettseg), a
 * parancs pedig lekerdezes es iras. Osszekeverve a dontes csak eles
 * adatbazissal lenne merheto -- vagyis gyakorlatilag sehogy.
 *
 * ES A LEFEDETTSEGI SOR VISSZAOLVASOJA IS ITT ALL, nem a tesztben. A
 * `document-thumbnail-backfill` elso alakjaban a parser a spec belsejeben
 * volt, ahol Postgres nelkul nem merheto -- es csak a NEM-URES mondatot
 * ismerte, holott az alapvonal epp URES allapotban keszul. A hiba nem billego
 * volt, hanem szerkezeti, es csak a CI-ben latszott.
 */

/**
 * A LEZART VERZIO, AHOGY A PARANCS LATJA A SOR IRASA ELOTT.
 *
 * A `worksheetNumber` azert all itt, mert a lap NEVE ebbol epul
 * (`formatWorksheetVersionLabel`), es szam nelkul a fajl `munkalap-piszkozat`
 * nevet kapna. A szam hianya tehat KIHAGYASI ok, nem hiba -- de meg kell
 * nevezni, kulonben a lefedettseg csendben nem er el szazat.
 */
export interface WorksheetSheetBackfillRow {
  worksheetId: string;
  /** A lap szama. `null`, ha meg nem kapott -- akkor nincs mibol nevet adni. */
  worksheetNumber: string | null;
  /** A LEZART verzio azonositoja; a dokumentum ERRE fog mutatni. */
  versionId: string;
  /** Van-e MAR kiadott lap EHHEZ a verziohoz. */
  hasSheet: boolean;
}

export interface WorksheetSheetBackfillPlan {
  /** Lezart verzio, aminek nincs lapja, es VAN szama. */
  candidates: WorksheetSheetBackfillRow[];
  /** Lezart verzio, aminek MAR van lapja. */
  covered: number;
  /**
   * Lezart verzio SZAM NELKUL. KULON szam, es nem a "lefedett" resze: ezekhez
   * ma nem lehet lapot adni, tehat egy kozos szam azt allitana, hogy a
   * lefedettseg sosem lehet teljes -- holott a szam megjottevel lehet.
   */
  skippedNoNumber: WorksheetSheetBackfillRow[];
}

/**
 * MELY LEZART VERZIOHOZ KELL UTOLAG LAP.
 *
 * A BEMENET MAR SZURT: a hivo csak olyan verziot ad at, amelyik atment a
 * `close()`-on (`closedAt` kitoltve). Ez a fuggveny a MARADEK ket kerdest
 * donti el: van-e mar lapja, es van-e mibol nevet adni.
 */
export function planWorksheetSheetBackfill(
  rows: readonly WorksheetSheetBackfillRow[],
): WorksheetSheetBackfillPlan {
  const candidates: WorksheetSheetBackfillRow[] = [];
  const skippedNoNumber: WorksheetSheetBackfillRow[] = [];
  let covered = 0;

  for (const row of rows) {
    if (row.hasSheet) {
      covered += 1;
      continue;
    }
    if (!row.worksheetNumber) {
      skippedNoNumber.push(row);
      continue;
    }
    candidates.push(row);
  }

  return { candidates, covered, skippedNoNumber };
}

/**
 * A LEFEDETTSEG EMBERI ALAKBAN.
 *
 * A NEVEZO A LEZART VERZIOK SZAMA, es a szam nelkuli sorok KULON allnak --
 * beszamolva a lefedettseg sosem erne el a szazat, es akkor a szam nem mondana
 * meg, mikor vagyunk keszen.
 */
export function describeWorksheetSheetCoverage(
  plan: WorksheetSheetBackfillPlan,
): string {
  const lezart =
    plan.covered + plan.candidates.length + plan.skippedNoNumber.length;
  if (lezart === 0) return "lezart verzio: 0 (nincs mit lefedni).";
  const szazalek = Math.round((plan.covered / lezart) * 100);
  return (
    `lezart verzio: ${lezart}, ebbol kiadott lappal: ${plan.covered} (${szazalek}%), ` +
    `hianyzik: ${plan.candidates.length}. Szam nelkul: ${plan.skippedNoNumber.length}`
  );
}

export interface WorksheetSheetCoverageNumbers {
  lezart: number;
  lefedve: number;
  hianyzik: number;
  szamNelkul: number;
}

const URES_ALAK = /lezart verzio: 0 \(nincs mit lefedni\)\./;
const TELJES_ALAK =
  /lezart verzio: (\d+), ebbol kiadott lappal: (\d+) \(\d+%\), hianyzik: (\d+)\. Szam nelkul: (\d+)/;

/**
 * A KIIRT LEFEDETTSEGI SOR VISSZAOLVASASA -- `null`, ha nincs ilyen sor.
 *
 * KET ALAKOT ISMER, es ez nem elovigyazatossag: az URES allapotnak sajat
 * mondata van, es epp abban az allapotban keszul az integracios suite
 * alapvonala (a takaritas utan, a fixturak letrehozasa ELOTT).
 */
export function parseWorksheetSheetCoverage(
  kimenet: string,
): WorksheetSheetCoverageNumbers | null {
  if (URES_ALAK.test(kimenet))
    return { lezart: 0, lefedve: 0, hianyzik: 0, szamNelkul: 0 };

  const t = TELJES_ALAK.exec(kimenet);
  if (!t) return null;
  return {
    lezart: Number(t[1]),
    lefedve: Number(t[2]),
    hianyzik: Number(t[3]),
    szamNelkul: Number(t[4]),
  };
}
