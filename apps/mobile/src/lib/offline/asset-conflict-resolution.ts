import { ASSET_CRITICALITY_LABELS } from "../assets/asset-criticality";
import { ASSET_STATUS_LABELS } from "../assets/asset-status";
import type { UpdateAssetInput } from "../assets/asset-fields";
import type { QueuedAssetUpdateBase } from "./asset-update-queue";

/**
 * MELYIK ÉRTÉK MARADJON: AZ ENYÉM VAGY A MÁSIKÉ.
 *
 * === MI TÖRTÉNT, ÉS MIÉRT NEM ELÉG AZ ÚJRAKÜLDÉS ===
 *
 * A szerelő a helyszínen átírt néhány mezőt, a javítás a sorban várt, és
 * közben valaki más ugyanazokhoz a mezőkhöz nyúlt. A szerver ezért elutasította
 * (`FIELD_CONFLICT`), és a törzs VÁLTOZATLAN újraküldése ugyanezt adná vissza:
 * a benne álló `expectedUpdatedAt` végleg elavult.
 *
 * Egy javító gomb tehát olyat ígérne, ami soha nem tud sikerülni -- és a
 * flotta szabálya erre pontos: egy feloldhatatlan ütközésnél azt kell
 * felkínálni, MELYIK ÉRTÉK MARADJON, nem egy újraküldést.
 *
 * === HÁROM ÉRTÉK KELL HOZZÁ, NEM KETTŐ ===
 *
 * Az első változat a beírt és a MOSTANI értéket vetette össze, és ez ROSSZ
 * KÉRDÉST tett fel a sorok többségén. Ha a szerelő Wilóról Grundfosra írta át a
 * gyártót, és rajta kívül senki nem nyúlt hozzá, a friss eszközön még mindig
 * Wilo áll -- ez ELTÉRÉSNEK látszik, holott nincs mit eldönteni. És ha a
 * szerelő zavarában a másikat választja, a SAJÁT javítása tűnik el csendben.
 *
 * A kérdés tehát csak HÁROM értékből dönthető el: amit LÁTOTT, amit BEÍRT, és
 * ami MOST áll. Az elsőt a sor hordozza (`QueuedAssetUpdate.base`).
 *
 * ÜTKÖZÉS az, ahol a mostani érték eltér attól, amit a szerelő LÁTOTT: ott
 * MÁS is hozzányúlt. Ahol nem tér el, ott a javítás simán átmegy, és a
 * képernyőnek nincs mit kérdeznie (acrobot kikötése, 2026-09-04: csak az
 * ütköző mezők kerüljenek a listára).
 *
 * === MIÉRT NEM A SZERVERTŐL KÉRJÜK EL AZ ÜTKÖZŐ MEZŐKET ===
 *
 * Mert a telefonon MEGVAN mind a három érték, tehát nincs szükség se új
 * végpontra, se új mezőre a válaszban -- és nem keletkezik olyan képesség sem,
 * amit senki nem hív. A szerver a saját esemény-naplójából dolgozna, ami egy
 * oda-vissza írt mezőt is ütközésnek látna; a szerelő kérdésére a látott érték
 * a pontosabb válasz.
 *
 * === AMIT A KIMENET NEM DÖNT EL ===
 *
 * Ez a modul ÖSSZEVET és ÚJRAÉPÍT. Hogy a képernyő melyik sort mutatja meg
 * elsőnek, vagy hogy alapból melyik érték legyen bejelölve, a képernyő dolga --
 * és szándékosan nem itt áll: egy alapértelmezett választás azt jelentené, hogy
 * a döntést a kód hozza meg a szerelő helyett.
 */

/** Amennyit a FRISS eszközből ez a modul olvas. Szándékosan szűk, szerkezeti. */
export interface CurrentAssetLike {
  updatedAt: string;
  status: string;
  criticality: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  partnerInternalCode?: string | null;
  description?: string | null;
  notes?: string | null;
  /**
   * AZ ESZKOZON MOST ALLO MATRICA KODJA.
   *
   * MIERT KERULT BE IDE IS: a `ComparableField` a `UpdateAssetInput` kulcsaibol
   * szarmazik, tehat a matricakod felvetelevel AUTOMATIKUSAN osszehasonlithato
   * mezo lett -- a fordito koveteli meg, hogy legyen mihez hasonlitani. Ez jol
   * van igy: ha a sorban allo modositas matricat ir, a szerelo lassa, mi all
   * MOST az eszkozon.
   *
   * ES AMIT EZ NEM CSINAL: a SZERVER nem jelez matrica-utkozest. A
   * `conflictingFields` az `Asset` OSZLOPAIT hasonlitja, a matrica pedig nem
   * oszlop, hanem masik tabla sora -- oda soha nem kerul be. Ez a sor tehat
   * akkor latszik, ha a valasz MAS mezo miatt lett utkozes. Szandekos:
   * a leszakadt szerelo a FIZIKAI matricat latja a gepen, tehat az o erteke a
   * valoszinubb, es a felszabadult kod visszakerul a keszletbe -- nem vesz el.
   */
  labelCode?: string | null;
  /**
   * A MOSTANI TELJESITMENY ES A MERTEKEGYSEGE.
   *
   * UGYANAZ AZ OK, MINT A MATRICANAL: a `ComparableField` a
   * `UpdateAssetInput` kulcsaibol szarmazik, tehat a par felvetelevel
   * AUTOMATIKUSAN osszehasonlithato mezo lett -- a fordito koveteli meg, hogy
   * legyen mihez hasonlitani. Ez jol van igy: ha a sorban allo modositas
   * teljesitmenyt ir, a szerelo lassa, mi all MOST az eszkozon.
   *
   * AZ EGYSEG OBJEKTUMKENT jon a szervertol (`performanceUnit`), a torzs
   * viszont AZONOSITOT visz -- ezert kell kulon leképezes, ugyanugy, mint a
   * helyszinnel.
   */
  performance?: string | null;
  performanceUnit?: { id: string; code: string } | null;
  /** A mostani helyszín, ha van. A NEVE kell, nem az azonosítója. */
  unit?: { id: string; name: string } | null;
  /**
   * A MOSTANI KATEGORIA -- AZ AZONOSITO ES A NEVE IS.
   *
   * KET MEZO, ES NEM PAZARLAS: az OSSZEVETES az azonositon megy (egy
   * atnevezett kategoria kulonben valtozasnak latszana), a KIIRAS viszont a
   * neven (`cat_01M...` alaku karakterlanc a kepernyon nem dontest segit).
   * Ugyanaz a ketosseg, ami a helyszinnel es a mertekegyseggel all -- ott
   * objektumban, itt ket mezoben, mert a szerver is igy adja (`AssetDetail`).
   */
  categoryId?: string | null;
  category?: string | null;
  /**
   * A MOSTANI FUNKCIO -- AZ AZONOSITO ES A NEVE IS, FUGGETLENUL A
   * KATEGORIATOL. Ugyanaz a ketosseg, mint felette. Kanban 68add892,
   * 2026-09-22.
   */
  functionId?: string | null;
  function?: string | null;
  /**
   * A MOSTANI TERFOGAT ES FOGYASZTAS -- FUGGETLEN A TELJESITMENYTOL, kanban
   * 8c77cf3e, 2026-09-23. Ugyanaz az ok, ami a matricanal es a teljesitmenynel
   * all: a `ComparableField` a `UpdateAssetInput` kulcsaibol szarmazik.
   */
  volume?: string | null;
  powerConsumption?: string | null;
  /** A fogyasztas eredeti szovege -- lasd a `powerConsumption` fejleceit. */
  powerConsumptionRaw?: string | null;
  /**
   * A tablazat elso oszlopa, felulet-felirata "FP / Elektromos" (Balazs
   * dontese, 2026-09-23 18:59). A FORRAS oszlop neve ket alakban all,
   * lapfuggoen: a Biodom lapjain "FP kod / Elektromos", az LSS-lapokon es
   * az osszevont Teljes listan "MAT kod / Elektromos" -- ugyanaz az
   * oszlop, ket cimkevel. Kanban 8c77cf3e, 2026-09-23.
   */
  electricalCode?: string | null;
}

/** A törzsből összevethető mezők. A `expectedUpdatedAt` nem tartozik ide. */
export type ComparableField = Exclude<
  keyof UpdateAssetInput,
  "expectedUpdatedAt"
>;

export interface ConflictFieldRow {
  field: ComparableField;
  /** A mező neve magyarul, ahogy a szerkesztő képernyőn is áll. */
  label: string;
  /** Amit a szerelő beírt, olvasható alakban. */
  mine: string;
  /** Ami MOST a szerveren áll, ugyanabban az alakban. */
  theirs: string;
  /** Eltér-e a beírt és a mostani érték. MEGJELENÍTÉSI adat, nem döntés. */
  differs: boolean;
  /**
   * HOZZÁNYÚLT-E MÁS IS EHHEZ A MEZŐHÖZ.
   *
   * EZ dönti el, hogy a képernyő KÉRDEZ-e. Nem a `differs`: az akkor is igaz,
   * amikor egyedül a szerelő írt át valamit, és ott nincs mit eldönteni.
   *
   * HIÁNYZÓ ALAPÉRTÉKNÉL IGAZ, és ez szándékos: a 2026-09-04 délelőttjén sorba
   * tett módosításokon nincs alapérték, tehát nem tudjuk. Ilyenkor a képernyő
   * TÖBBET kérdez a kelleténél -- ami kellemetlen, de nem hallgat el semmit.
   * A fordított alapértelmezés (nem kérdezünk) csendben felülírná a másik
   * ember szándékos változtatását.
   */
  conflicting: boolean;
}

const MEZO_NEVE: Record<ComparableField, string> = {
  status: "Státusz",
  criticality: "Kritikusság",
  departmentId: "Helyszín",
  categoryId: "Kategória",
  functionId: "Funkció",
  manufacturer: "Gyártó",
  model: "Modell",
  serialNumber: "Sorozatszám",
  partnerInternalCode: "Partner azonosítója",
  description: "Leírás",
  notes: "Megjegyzés",
  labelCode: "Matrica kódja",
  performance: "Teljesítmény",
  performanceUnitId: "Teljesítmény mértékegysége",
  volume: "Térfogat",
  powerConsumption: "Fogyasztás",
  powerConsumptionRaw: "Fogyasztás (eredeti bejegyzés)",
  electricalCode: "FP / Elektromos",
};

/** Az üres érték NEVE. Egy üres cella nem mondja meg, hogy törlésről van szó. */
const URES = "nincs megadva";

/**
 * A SORBAN ÁLLÓ TÖRZS ÉS A FRISS ESZKÖZ MEZŐNKÉNTI ÖSSZEVETÉSE.
 *
 * CSAK AZOK A MEZŐK, AMIKET A SZERELŐ TÉNYLEGESEN ÁTÍRT. A törzs eleve csak a
 * megváltozott mezőket viszi, tehát a listát maga a törzs adja -- egy teljes
 * mezőlista itt azt kérdezné a szerelőtől, amihez hozzá sem nyúlt.
 */
export function compareQueuedUpdate(input: {
  patch: UpdateAssetInput;
  current: CurrentAssetLike;
  /**
   * A HELYSZÍNEK NEVE AZONOSÍTÓ SZERINT, ha a képernyő be tudta tölteni.
   *
   * A törzsben a helyszín AZONOSÍTÓ áll, mert a szerver azt várja. A szerelő
   * viszont nevet választott, és egy `unit_01M...` alakú karakterlánc a
   * képernyőn nem döntést segít, hanem elbizonytalanít.
   */
  unitNames?: Record<string, string>;
  /**
   * A KATEGORIAK NEVE AZONOSITO SZERINT, ha a kepernyo be tudta tolteni.
   *
   * Ugyanaz az indok, ami a helyszineknel all felette: a torzsben AZONOSITO
   * all, a szerelo viszont NEVET valasztott. Es ha a lista nem jott meg (a
   * feloldas gyakran epp terero nelkul tortenik), a `helyszin`-hez hasonloan
   * az azonosito kerul ki -- egy nema visszaeses a „nincs megadva" szovegre
   * azt allitana, hogy a szerelo TOROLNI akarja a kategoriat, holott epp
   * beallitott egyet.
   */
  categoryNames?: Record<string, string>;
  /**
   * A FUNKCIOK NEVE AZONOSITO SZERINT -- FUGGETLENUL A KATEGORIAKTOL, ugyanaz
   * az indok, mint felette.
   */
  functionNames?: Record<string, string>;
  /** Amit a szerelő LÁTOTT. Hiányozhat: a mező előtt keletkezett sorokon nincs. */
  base?: QueuedAssetUpdateBase;
}): ConflictFieldRow[] {
  const rows: ConflictFieldRow[] = [];

  for (const field of Object.keys(MEZO_NEVE) as ComparableField[]) {
    if (!(field in input.patch)) continue;
    const mine = enyem(
      field,
      input.patch,
      input.unitNames,
      input.categoryNames,
      input.functionNames,
    );
    const theirs = ovek(field, input.current, input.unitNames);
    rows.push({
      field,
      label: MEZO_NEVE[field],
      mine,
      theirs,
      differs: mine !== theirs,
      conflicting: masIsHozzanyult(field, input.current, input.base),
    });
  }

  return rows;
}

/**
 * MÁS IS HOZZÁNYÚLT-E: a MOSTANI nyers érték eltér-e attól, amit a szerelő látott.
 *
 * NYERS ÉRTÉKEN hasonlít, nem a kiírt szövegen: a helyszínnél a törzs
 * azonosítót visz, a képernyő nevet mutat, és egy átnevezett helyszín így
 * változásnak látszana, holott ugyanaz a helyszín.
 */
function masIsHozzanyult(
  field: ComparableField,
  current: CurrentAssetLike,
  base?: QueuedAssetUpdateBase,
): boolean {
  if (!base || !(field in base)) return true;
  return nyersMost(field, current) !== nyersAlap(field, base);
}

function nyersMost(
  field: ComparableField,
  current: CurrentAssetLike,
): string | null {
  if (field === "status") return current.status;
  if (field === "criticality") return current.criticality;
  if (field === "departmentId") return current.unit?.id ?? null;
  // A KATEGORIANAL IS AZ AZONOSITO dont, nem a nev: a torzsadaton a nev
  // atirhato, es egy atnevezes kulonben ugy latszana, mintha mas hozzanyult
  // volna az eszkozhoz.
  if (field === "categoryId") return uresNull(current.categoryId);
  // A FUNKCIONAL IS AZ AZONOSITO dont, ugyanabbol az okbol, mint a kategorianal.
  if (field === "functionId") return uresNull(current.functionId);
  // A PAR EGYSEG-FELE OBJEKTUMKENT all a valaszban, azonositokent a torzsben.
  if (field === "performanceUnitId") return current.performanceUnit?.id ?? null;
  return uresNull(current[field]);
}

function nyersAlap(
  field: ComparableField,
  base: QueuedAssetUpdateBase,
): string | null {
  if (field === "status") return base.status ?? null;
  if (field === "criticality") return base.criticality ?? null;
  if (field === "departmentId") return base.departmentId ?? null;
  return uresNull(base[field]);
}

/**
 * AZ ÜRES SZÖVEG ÉS A HIÁNY UGYANAZ AZ ÁLLAPOT. A szerver a törlést `null`-ként
 * tárolja, egy űrlap viszont üres karakterláncot adhat: ha a kettőt
 * megkülönböztetnénk, egy üres mező „változásnak" látszana.
 */
function uresNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim() === "" ? null : value;
}

/**
 * A MEGTARTOTT MEZŐKBŐL ÚJ TÖRZS, A FRISS VERZIÓVAL.
 *
 * === A FRISS `expectedUpdatedAt` AZ EGÉSZ MŰVELET LÉNYEGE ===
 *
 * A régi törzsben egy elavult verzió áll, és amíg az ott van, a küldés
 * ugyanazt a 409-et kapja vissza. A feloldás tehát nem attól működik, hogy a
 * szerelő választott, hanem attól, hogy az új törzs a MOST letöltött állapotra
 * hivatkozik.
 *
 * === AMIT A SZERELŐ NEM TART MEG, AZ KIMARAD, NEM NULLÁZÓDIK ===
 *
 * A hiányzó mező azt jelenti, hogy „hagyd békén"; a `null` azt, hogy „töröld".
 * Ha a nem választott mezőket `null`-ra írnánk, a szerelő döntése („maradjon a
 * másiké") TÖRLÉSSÉ változna -- pontosan az ellenkezőjévé.
 */
export function rebuildResolvedPatch(input: {
  patch: UpdateAssetInput;
  /** Amelyik mezőknél a SZERELŐ értéke maradjon. */
  keepMine: readonly ComparableField[];
  /** A frissen letöltött eszköz verziója. */
  freshUpdatedAt: string;
}): UpdateAssetInput {
  const rebuilt: UpdateAssetInput = { expectedUpdatedAt: input.freshUpdatedAt };
  for (const field of input.keepMine) {
    if (!(field in input.patch)) continue;
    /**
     * A MÁSOLÁS MEZŐNKÉNT MEGY, ÉS NEM `Object.assign`-nal: a törzs egy mezője
     * lehet `null` (törlés), és egy „csak az igaz értékeket vidd" alakú másolás
     * CSENDBEN elhagyná a törléseket.
     */
    assignField(rebuilt, field, input.patch);
  }
  return rebuilt;
}

/**
 * MARADT-E BÁRMI A TÖRZSBEN.
 *
 * Ha a szerelő MINDEN mezőnél a másikét választja, a küldés értelmetlen: egy
 * üres törzs annyit tenne, hogy megérintjük a rekordot, és a `updatedAt`
 * mozdulna anélkül, hogy bármi változna. Ilyenkor a helyes lépés az ELVETÉS, és
 * a képernyőnek ezt kell felkínálnia.
 */
export function resolutionIsEmpty(patch: UpdateAssetInput): boolean {
  return (
    Object.keys(patch).filter((key) => key !== "expectedUpdatedAt").length === 0
  );
}

function assignField(
  target: UpdateAssetInput,
  field: ComparableField,
  source: UpdateAssetInput,
): void {
  switch (field) {
    case "status":
      target.status = source.status;
      return;
    case "criticality":
      target.criticality = source.criticality;
      return;
    case "departmentId":
      target.departmentId = source.departmentId;
      return;
    case "manufacturer":
      target.manufacturer = source.manufacturer;
      return;
    case "model":
      target.model = source.model;
      return;
    case "serialNumber":
      target.serialNumber = source.serialNumber;
      return;
    case "partnerInternalCode":
      target.partnerInternalCode = source.partnerInternalCode;
      return;
    case "description":
      target.description = source.description;
      return;
    case "notes":
      target.notes = source.notes;
      return;
    case "categoryId":
      target.categoryId = source.categoryId;
      return;
    case "functionId":
      target.functionId = source.functionId;
      return;
    /**
     * EZ A HAROM AG HIANYZOTT, ES A KIMERITO-ORZO HOZTA ELO (2026-09-22).
     *
     * A `MEZO_NEVE` mind a harmat felsorolja, tehat a feloldo kepernyon SOR
     * KELETKEZETT rajuk, es a szerelo valaszthatta, hogy az OVE maradjon. A
     * `keepMine` bele is tette a listaba -- csak itt nem tortent semmi.
     *
     * A KOVETKEZMENY NEM HIBA VOLT, HANEM CSEND: a szerelo beirt matricakodja
     * vagy teljesitmenye egyszeruen kimaradt az ujrakuldott torzsbol, es a
     * kepernyo ugy nezett ki, mintha a dontese atment volna. Ha ez volt az
     * EGYETLEN megtartott mezo, a `resolutionIsEmpty` uresnek latta, es a
     * kepernyo ELVETEST kinalt fel -- ott legalabb latszik valami.
     *
     * Egyetlen teszt sem fogta meg: a spec csak a `manufacturer` mezot tartja
     * meg, ami a lefedett agak kozott van.
     */
    case "labelCode":
      target.labelCode = source.labelCode;
      return;
    case "performance":
      target.performance = source.performance;
      return;
    case "performanceUnitId":
      target.performanceUnitId = source.performanceUnitId;
      return;
    case "volume":
      target.volume = source.volume;
      return;
    case "powerConsumption":
      target.powerConsumption = source.powerConsumption;
      return;
    case "powerConsumptionRaw":
      target.powerConsumptionRaw = source.powerConsumptionRaw;
      return;
    case "electricalCode":
      target.electricalCode = source.electricalCode;
      return;
    default:
      /**
       * A SWITCH NEM KIMERITO-ELLENORZES ONMAGABAN, ES EZ A SOR TESZI AZZA.
       *
       * Enelkul egy UJ mezo felvetele a `UpdateAssetInput`-ba CSENDBEN
       * kimaradna innen: a fordito nem szol, a feloldott torzs pedig nem
       * vinne at a szerelo valasztasat -- vagyis a dontese eltunne, es a
       * kepernyo ugy nezne ki, mintha minden rendben ment volna.
       *
       * A `never` hozzarendeles pontosan itt bukik el, forditaskor, es
       * MEGNEVEZI a hianyzo mezot.
       */
      return kimaradtMezo(field);
  }
}

function kimaradtMezo(field: never): never {
  throw new Error(`nem kezelt mezo a feloldasban: ${String(field)}`);
}

function enyem(
  field: ComparableField,
  patch: UpdateAssetInput,
  unitNames?: Record<string, string>,
  categoryNames?: Record<string, string>,
  functionNames?: Record<string, string>,
): string {
  if (field === "status") return szoveg(ASSET_STATUS_LABELS, patch.status);
  if (field === "criticality")
    return szoveg(ASSET_CRITICALITY_LABELS, patch.criticality);
  if (field === "departmentId") return helyszin(patch.departmentId, unitNames);
  if (field === "categoryId") return kategoria(patch.categoryId, categoryNames);
  if (field === "functionId") return kategoria(patch.functionId, functionNames);
  return ures(patch[field] as string | null | undefined);
}

function ovek(
  field: ComparableField,
  current: CurrentAssetLike,
  unitNames?: Record<string, string>,
): string {
  if (field === "status") return szoveg(ASSET_STATUS_LABELS, current.status);
  if (field === "criticality")
    return szoveg(ASSET_CRITICALITY_LABELS, current.criticality);
  if (field === "departmentId")
    return current.unit
      ? (unitNames?.[current.unit.id] ?? current.unit.name)
      : URES;
  /**
   * A MERTEKEGYSEGNEL A JEL LATSZIK, NEM AZ AZONOSITO.
   *
   * Egy `uom_01M...` alaku karakterlanc a kepernyon nem dontest segit, hanem
   * elbizonytalanit -- ugyanaz, amiert a helyszinnel a nev all. Ha a jel
   * valamiert hianyzik, az azonosito az utolso mentsvar: egy ures cella azt
   * allitana, hogy nincs egyseg, holott van.
   */
  if (field === "performanceUnitId")
    return current.performanceUnit ? current.performanceUnit.code : URES;
  /**
   * A KATEGORIANAL A NEV LATSZIK, ES A SZERVER MAR ADJA IS.
   *
   * Ha a nev valamiert hianyzik, az azonosito az utolso mentsvar -- egy ures
   * cella azt allitana, hogy nincs kategoria, holott van.
   */
  if (field === "categoryId")
    return current.category ?? (current.categoryId ? current.categoryId : URES);
  /**
   * A FUNKCIONAL A NEV LATSZIK, UGYANAZ AZ INDOK, MINT A KATEGORIANAL.
   */
  if (field === "functionId")
    return current.function ?? (current.functionId ? current.functionId : URES);
  return ures(current[field]);
}

/**
 * EGY ISMERETLEN KÓD NEM TŰNHET EL.
 *
 * Ha a szerver egyszer új státuszt vagy kritikusságot vezet be, a leképezés
 * nem ismeri. Egy üres cella ilyenkor azt mondaná, hogy nincs érték -- holott
 * van, csak nem tudjuk a nevét. A nyers kód kiírva legalább igaz.
 */
function szoveg(
  labels: Record<string, string>,
  value: string | undefined,
): string {
  if (value === undefined) return URES;
  return labels[value] ?? value;
}

function ures(value: string | null | undefined): string {
  if (value === null || value === undefined) return URES;
  return value.trim() === "" ? URES : value;
}

/**
 * A FUNKCIO-NEVFELOLDAS UGYANEZT A FUGGVENYT HASZNALJA (`enyem`), mert a
 * logika azonositasfuggetlen: ertek plusz nev-terkep, nincs kategoria-specifikus
 * resz benne.
 */
function kategoria(
  value: string | null | undefined,
  categoryNames?: Record<string, string>,
): string {
  if (value === null || value === undefined || value.trim() === "") return URES;
  // UGYANAZ A VISSZAESES, mint a helyszinnel: az azonosito is kikerul, ha a
  // nevet nem tudjuk. A nema „nincs megadva" torlesnek latszana.
  return categoryNames?.[value] ?? value;
}

function helyszin(
  value: string | null | undefined,
  unitNames?: Record<string, string>,
): string {
  if (value === null || value === undefined || value.trim() === "") return URES;
  /**
   * AZ AZONOSÍTÓ IS KIKERÜL, HA A NEVET NEM TUDJUK. Egy néma visszaesés a
   * „nincs megadva" szövegre azt mondaná, hogy a szerelő törölni akarja a
   * helyszínt -- pedig épp beállított egyet.
   */
  return unitNames?.[value] ?? value;
}
