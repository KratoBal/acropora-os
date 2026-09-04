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
export type SyncState =
  | "pending"
  | "syncing"
  | "failed"
  | "conflict"
  | "stalled"
  /**
   * A SZERELO ELVETETTE. A sor NEM megy fel, es NEM tunik el.
   *
   * MIERT NEM TOROLJUK: ha egy sor egyszeruen eltunne a listarol, az kivulrol
   * MEGKULONBOZTETHETETLEN attol, mintha sikeresen kiment volna. Ugyanaz a lap
   * hianyozna a szerverrol, es senki nem tudna megmondani, hogy elvetettek-e
   * vagy elveszett. Az allapot maga a nyom.
   *
   * A KULDESBOL MAGATOL KIESIK: a `KULDHETO` lista csak a `pending` es a
   * `failed` sorokat viszi, tehat ez az allapot nem igenyel kulon kaput a
   * kiuritesben -- de a KEPERNYON igen, kulonben a "varakozo" szakaszba esne,
   * es a kollega azt hinne, hogy meg fel fog menni.
   */
  | "discarded";

/**
 * HANYSZOR PROBALJUK MEG, HA A SZERVER VALASZOL, DE HIBAVAL.
 *
 * Aki nyolcszor 500-at ad, a kilencedikre is azt fogja. A szam a repo sajat
 * mintajabol jon (a szerver-oldali ujraprobalo `MAX_ATTEMPTS=8` erteke,
 * `docs/INVENTORY-CONSISTENCY.md`): egy szam, aminek van tortenete, jobb, mint
 * egy szep kerek szam, amit most talalunk ki.
 *
 * EZ CSAK A SZERVER-HIBAKRA ALL. A halozati hiba (a keres el sem jutott oda)
 * NEM szamit bele: terero nelkul az a normalis allapot, es egy pinceben toltott
 * het utan a felvitel nem adhatja fel.
 */
export const SZERVER_HIBA_HATAR = 8;

/** A varakoztatas alapja es teteje, a szerver-oldali mintat kovetve. */
export const BACKOFF_ALAP_MS = 30 * 1000;
export const BACKOFF_TETO_MS = 30 * 60 * 1000;

/**
 * MENNYIT VARJON A KOVETKEZO KISERLETIG.
 *
 * Exponencialis, tetovel: 30 masodperc, 1 perc, 2 perc, ... legfeljebb fel ora.
 * A kepletet a szerver-oldali ujraprobalo hasznalja, ugyanebben az alakban.
 *
 * AMIT EZ NEM TESZ, es ki kell mondani: NEM idozit. A kiuritest esemeny
 * inditja (app-indulas, halozat visszaterese), tehat ez a szam csak azt dönti
 * el, hogy a KOVETKEZO alkalommal sorra kerul-e a tetel. Ha a telefon egy hetig
 * nem kap halozatot, egyetlen kiserlet sem tortenik -- es ez helyes.
 */
export function backoffMs(attemptCount: number): number {
  if (attemptCount <= 0) return 0;
  const nyers = BACKOFF_ALAP_MS * 2 ** (attemptCount - 1);
  return Math.min(BACKOFF_TETO_MS, nyers);
}

/**
 * A SOR HAROM ENTITAS-FAJTAT ISMER, ES A LISTA A FORRAS, NEM A TIPUS.
 *
 * A `SyncEntityType` union EBBOL a tombbol szuletik, nem forditva. Ez nem
 * stilus: egy kezzel irt union mellett a FUTASIDEJU ellenorzes (`ismertSor` a
 * tarolóban) kulon listat vezetne, es a ketto elcsuszhatna -- egy uj fajta
 * bekerulne a tipusba, a szures pedig CSENDBEN eldobna a sorait. Igy egyetlen
 * helyen all mind a ketto.
 *
 *   asset           uj eszkoz felvitele a helyszinen
 *   worksheet       uj munkalap megnyitasa a helyszinen
 *   worksheet-line  tetel egy MAR LETEZO munkalap piszkozatara
 */
/**
 * A SOR HAROM MUVELETET ISMER, ES UGYANAZERT LISTA, MINT A FAJTAKNAL.
 *
 * A `ismertSor` szures a `operation` oszlopot is olvassa, es egy kezzel irt
 * union mellett az a lista kulon elne: egy uj muvelet bekerulne a tipusba, a
 * szures pedig CSENDBEN eldobna a sorait.
 *
 *   create        uj rekord felvitele
 *   update        MAR LETEZO rekord modositasa
 *   upload-photo  kep egy MAR FELMENT rogziteshez
 */
export const SYNC_OPERATIONS = ["create", "update", "upload-photo"] as const;

export type SyncOperation = (typeof SYNC_OPERATIONS)[number];

/** Ismert muvelet-e, ami a tabla `operation` oszlopabol jott. */
export function isSyncOperation(value: string): value is SyncOperation {
  return (SYNC_OPERATIONS as readonly string[]).includes(value);
}

export const SYNC_ENTITY_TYPES = [
  "asset",
  "worksheet",
  "worksheet-line",
] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

/** Ismert fajta-e, ami a tabla `entity_type` oszlopabol jott. */
export function isSyncEntityType(value: string): value is SyncEntityType {
  return (SYNC_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * TARTOZHAT-E FENYKEP EHHEZ A FAJTAHOZ -- ES MIERT NEM ELEG EGY `!==`.
 *
 * A `queue-runner.ts` ebbol donti el, hogy egy felment `create` sor
 * azonosito NELKUL baj-e. Eszkoznel es munkalapnal IGEN: a sorban allo kepeket
 * a szerver-azonosito nelkul mar semmi nem tudja megcimezni, es ez a szam az
 * EGYETLEN jel rola. Tetelnel NEM: tetelhez nem tartozik kep, es a lap
 * azonositoja amugy is a soron all.
 *
 * `Record`, nem feltetel: egy NEGYEDIK fajta felvetele igy FORDITASI HIBAT ad,
 * nem csendes alapertelmezest. Pontosan ez a hiba tortent 2026-09-03-ig a
 * `sectionOf` fuggvenyben, ahol az uj allapot magatol a "varakozo" szakaszba
 * esett.
 */
const FENYKEP_GAZDA: Record<SyncEntityType, boolean> = {
  asset: true,
  worksheet: true,
  "worksheet-line": false,
};

export function canOwnPhotos(entityType: SyncEntityType): boolean {
  return FENYKEP_GAZDA[entityType];
}

export interface SyncQueueRow {
  /** A KLIENS-generalt muvelet-azonosito. Ez az idempotencia kulcsa. */
  id: string;
  /**
   * MI EZ A SOR. A `create` egy felvitel, az `update` egy MAR LETEZO rekord
   * modositasa, az `upload-photo` egy kep, ami egy MAR FELMENT rogziteshez
   * tartozik.
   *
   * EGY OSZLOP, HAROM MENET -- nem harom tabla. A kozos szabalyok (idempotencia,
   * a negy allapot, az ujraprobalas) igy EGY helyen allnak; kulon sorokkal
   * tobbszor kellene oket karbantartani, es elcsuszhatnanak. A sorrendet a
   * `photo-queue.ts` `nextBatch` fuggvenye adja, nem a tabla szerkezete.
   *
   * AZ `update` ABBAN TER EL A MASIK KETTOTOL, HOGY NEM VAR SENKIRE ES NEM IS
   * VARAKOZTAT SENKIT. A kep a rogzitesere var, mert amig az fel nem ment,
   * nincs hova kerulnie. A modositas celpontja viszont MAR OTT VAN a szerveren
   * (kulonben nem lehetne szerkeszteni), tehat a sorban allo tobbi tetel nem
   * befolyasolja.
   */
  operation: SyncOperation;
  /**
   * MELYIK ENTITASROL VAN SZO. EGY SOR VISZI MINDET, es ez dontes: a negy
   * allapot, az idempotencia es a ket menet szabalya UGYANAZ, tehat kulon
   * tablakat kulon kellene karbantartani, es azok elcsuszhatnanak.
   *
   * A KULONBSEG A KULDESBEN VAN, nem a sorban: az eszkoz a felviteli
   * vegpontra megy, a munkalap a sajatjara, a tetel a lap sor-vegpontjara. Ezt
   * a `use-queue-drain.ts` donti el, es MINDEGYIK ugyanazt a kliens-kulcsot
   * viszi, amit a szerver 2026-09-03 ota ismer.
   */
  entityType: SyncEntityType;
  /**
   * A SZERVER-OLDALI AZONOSITO, HA MAR VAN. Uj felvitelnel `null`.
   *
   * A `worksheet-line` sorokon SZANDEKOSAN NEM `null` mar a sorba tetelkor: ott
   * ez a GAZDA lap azonositoja, ami mar letezik (tetelt csak meglevo lapra lehet
   * felvenni). Ugyanaz a mezo ket iranyban: az eszkoznel es a munkalapnal a
   * felmenetel TOLTI KI, a tetelnel a felmenetel HASZNALJA.
   */
  entityId: string | null;
  payloadJson: string;
  createdAt: string;
  attemptCount: number;
  lastError: string | null;
  /**
   * MIKOR PROBALTUK UTOLJARA. `null`, amig egyszer sem -- es a mezo elott
   * keszult sorokon is, ezert a varakoztatas a hianyt ESEDEKESNEK veszi.
   */
  lastAttemptAt: string | null;
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
 * A MODOSITAS KULCSA: AZ ESZKOZ ES AZ A VERZIO, AMIT A SZERELO LATOTT.
 *
 * === MIERT NEM A TARTALOMBOL, MINT A FELVITELNEL ===
 *
 * A felvitelnel ket kulon beolvasas ket kulon muvelet, meg ha a mezok egyeznek
 * is. A modositasnal FORDITVA: ha ugyanarrol a verziorol ketszer indul
 * szerkesztes, az EGY szandek ket lepesben, nem ket muvelet. A kulcsbol ezert
 * szandekosan kimarad a torzs.
 *
 * Ennek az az ara, hogy az azonos kulcsu masodik szerkesztest a sorba tetelnek
 * OSSZE KELL FESULNIE az elsovel (`mergeQueuedAssetUpdate`), nem eldobnia es
 * nem is felulirnia. Egy `INSERT OR IGNORE` itt az ELSO szerkesztest tartana
 * meg es a masodikat nyelne el; egy `REPLACE` forditva. Mindketto NEMA
 * adatvesztes lenne, es a szerelo egyiket sem latna.
 *
 * === MIERT A VERZIO, ES NEM CSAK AZ ESZKOZ AZONOSITOJA ===
 *
 * Ha egy sorban allo modositas felmegy, az eszkoz uj verziot kap. Egy EZUTAN
 * kezdett szerkesztes mar arrol a friss verziorol szol, tehat kulon muvelet:
 * mas a kulcsa, es nem fesulodik bele az elozobe.
 */
export function assetUpdateOperationId(input: {
  assetId: string;
  expectedUpdatedAt: string;
}): string {
  return `asset-update:${input.assetId}:${input.expectedUpdatedAt}`;
}

/**
 * MI KOVETKEZIK EGY ALLAPOTBOL. A tabla nem a kod egy reszlete: ez a protokoll
 * maga, es azert all itt, hogy egyetlen helyen lehessen elolvasni.
 *
 *   pending  -> syncing        a szinkron felveszi
 *   syncing  -> (torles)       a szerver nyugtazta, a helyi bizonyitek mehet
 *   syncing  -> failed         atmeneti hiba, ujraprobalhato
 *   syncing  -> conflict       a szerver ELUTASITOTTA (pl. a kod mar all)
 *   syncing  -> stalled        a szerver HIBAT adott, sokadszorra is
 *   failed   -> syncing        ujraprobalas
 *   conflict -> (csak ember)   automatikus atmenet NINCS
 *   stalled  -> (csak ember)   automatikus atmenet NINCS
 *
 * A `stalled` KULON ALL A `conflict`-TOL, es ez nem szormentes megkulonboztetes.
 * A conflict azt jelenti, hogy a szerver ELUTASITOTTA a felvitelt (a kod mar
 * all, az adat hibas): ott a teendo a felvitel javitasa. A stalled azt, hogy a
 * szerver HIBAT adott, ujra es ujra: ott a felvitellel semmi baj, a szerverrel
 * van. Egy kozos allapot mellett a felulet az egyik esetben HAZUDNA -- es a
 * szerelo a sajat adatat kezdene javitani egy szerver-hiba miatt.
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
