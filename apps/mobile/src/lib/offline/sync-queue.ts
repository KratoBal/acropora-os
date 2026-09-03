/**
 * AZ OFFLINE IRAS SORA: az allapotok es az idempotencia-kulcs.
 *
 * A `docs/MOBILE-DEVELOPMENT.md` protokollja szerint, pontrol pontra:
 * szerver-azonositok PLUSZ kliens-generalt muvelet-azonositok; explicit
 * pending/syncing/failed/conflict allapotok; automatikus ujraprobalas CSAK
 * idempotens muveletre; a helyi bizonyitek megorzese a szerver nyugtazasaig.
 *
 * === MIERT TISZTA MODUL, ES MIERT NEM A KEPERNYOBEN ===
 *
 * A telefonon nincs komponens-teszt. Ami a kepernyo torzseben marad, azt csak
 * kezzel, eszkozon lehet kiprobalni -- es epp ez az a resz, amit a legdragabb
 * kezzel probalni: a pinceben, terero nelkul, egy felig lefutott szinkron utan.
 */

/**
 * A NEGY ALLAPOT. Nem szabad szoveg: a `conflict` KULON all a `failed`-tol, mert
 * a teendo mas. Egy `failed` sor ujraprobalhato; egy `conflict` sor EMBERT
 * igenyel, es amig nincs eldontve, a helyi bizonyitek marad.
 */
export type SyncState = "pending" | "syncing" | "failed" | "conflict";

export interface SyncQueueRow {
  /** A KLIENS-generalt muvelet-azonosito. Ez az idempotencia kulcsa. */
  id: string;
  /**
   * MI EZ A SOR. A `create` egy eszkoz felvitele, az `upload-photo` egy kep,
   * ami egy MAR FELMENT rogziteshez tartozik.
   *
   * EGY OSZLOP, KET MENET -- nem ket tabla. A kozos szabalyok (idempotencia, a
   * negy allapot, az ujraprobalas) igy EGY helyen allnak; ket sorral ketszer
   * kellene oket karbantartani, es a ketto elcsuszhatna. A sorrendet a
   * `photo-queue.ts` `nextBatch` fuggvenye adja, nem a tabla szerkezete.
   */
  operation: "create" | "upload-photo";
  /**
   * MELYIK ENTITASROL VAN SZO. EGY SOR VISZI MIND A KETTOT, es ez dontes:
   * a negy allapot, az idempotencia es a ket menet szabalya UGYANAZ, tehat ket
   * tabla ketszer kellene karbantartani, es a ketto elcsuszhatna.
   *
   * A KULONBSEG A KULDESBEN VAN, nem a sorban: az eszkoz a felviteli
   * vegpontra megy, a munkalap a sajatjara. Ezt a `use-queue-drain.ts` donti
   * el, es MIND A KETTO ugyanazt a kliens-kulcsot viszi (`clientOperationId`),
   * amit a szerver 2026-09-03 ota ismer.
   */
  entityType: "asset" | "worksheet";
  /** A szerver-oldali azonosito, ha mar van. Uj felvitelnel `null`. */
  entityId: string | null;
  payloadJson: string;
  createdAt: string;
  attemptCount: number;
  lastError: string | null;
  state: SyncState;
}

/**
 * A MUVELET-AZONOSITO A TARTALOMBOL SZULETIK, NEM VELETLENBOL.
 *
 * Ha veletlen azonositot adnank, egy ketszer megnyomott gomb KET sort tenne a
 * sorba, es a szerver ket eszkozt hozna letre -- pontosan az a kettos felvitel,
 * ami ellen az egesz szelet szol. A tartalombol szarmaztatott kulcs mellett a
 * masodik nyomas ugyanazt a sort adja, es a beszuras eldonti, hogy mar ott van.
 *
 * AMIT EZ NEM OLD MEG, kimondva: ha a kollega SZANDEKOSAN ket azonos eszkozt
 * visz fel (ugyanaz a matricakod nelkul, ugyanazokkal a mezokkel), a masodikat
 * ez elnyeli. Ezert van a `scannedAt` a kulcsban: ket kulon beolvasas ket kulon
 * muvelet, meg ha a mezok egyeznek is.
 */
export function operationId(input: {
  qrToken: string;
  scannedAt: string;
}): string {
  return `asset-create:${input.qrToken}:${input.scannedAt}`;
}

/**
 * MI KOVETKEZIK EGY ALLAPOTBOL. A tabla nem a kod egy reszlete: ez a protokoll
 * maga, es azert all itt, hogy egyetlen helyen lehessen elolvasni.
 *
 *   pending  -> syncing        a szinkron felveszi
 *   syncing  -> (torles)       a szerver nyugtazta, a helyi bizonyitek mehet
 *   syncing  -> failed         atmeneti hiba, ujraprobalhato
 *   syncing  -> conflict       a szerver ELUTASITOTTA (pl. a kod mar all)
 *   failed   -> syncing        ujraprobalas
 *   conflict -> (csak ember)   automatikus atmenet NINCS
 */
export function canRetryState(state: SyncState): boolean {
  return state === "pending" || state === "failed";
}

/**
 * A KONFLIKTUS NEM HIBA, ES EZ A KULONBSEG A LENYEG.
 *
 * Egy halozati hiba utan ujraprobalunk; egy elutasitas utan NEM. Ha a kettot
 * egyformán kezelnenk, egy "ez a matricakod mar all egy eszkozon" valasz
 * vegtelen ujraprobalast inditana, es a kollega azt latna, hogy a felvitel
 * "meg dolgozik" -- holott soha nem fog atmenni.
 *
 * A NEVBEN AZERT ALL A `State`, mert a `canRetry` szo MAR FOGLALT ebben az
 * appban: a `lib/assets/scan-failure.ts`-ben egy MEZO viseli, mas jelentessel
 * (egy beolvasasi hiba ujraprobalhato-e). Nem utkoznek -- kulon modulok --, de
 * aki ra keres, ket kulonbozo dolgot talal. Ha valaki egyszer vissza akarna
 * nevezni, ez a bekezdes mondja meg, miert ne tegye.
 */
export function classifyFailure(httpStatus: number): SyncState {
  if (httpStatus === 409 || httpStatus === 422) return "conflict";
  return "failed";
}

/**
 * A SOR MEGORZI A BIZONYITEKOT, AMIG A SZERVER NEM NYUGTAZ.
 *
 * NINCS ALLAPOT, AMIBOL A TORLES KOVETKEZIK -- ezert nincs is ilyen fuggveny.
 * A sort EGYETLEN esemeny torolheti: a szerver nyugtazasa, es azt a hivo latja,
 * nem az allapotgep. Egy `failed` vagy `conflict` sor a keszuleken marad, mert
 * az a felvitel egyetlen letezo peldanya.
 *
 * (Elso valtozatban allt itt egy `isDiscardable` fuggveny. Kivettem: minden
 * bemenetre hamisat adott volna, tehat nem dontott semmit -- egy fuggveny, ami
 * ugy NEZ KI, mintha szabaly lenne, es nem az.)
 */

/**
 * A MUNKALAP MUVELET-AZONOSITOJA, UGYANABBOL AZ OKBOL A TARTALOMBOL.
 *
 * A partner es a nyitas idopontja adja: ketszer megnyomott gomb ugyanazt a
 * sort adja, ket KULON lap viszont ket kulcsot kap, meg akkor is, ha ugyanahhoz
 * a partnerhez tartoznak.
 *
 * A SZERVER IS EZT KAPJA MEG (`clientOperationId`), tehat ha a valasz elveszik
 * es a sor ujrakuld, a szerver a MEGLEVO lapot adja vissza -- nem masodikat
 * hoz letre.
 */
export function worksheetOperationId(input: {
  customerId: string;
  startedAt: string;
}): string {
  return `worksheet-create:${input.customerId}:${input.startedAt}`;
}
