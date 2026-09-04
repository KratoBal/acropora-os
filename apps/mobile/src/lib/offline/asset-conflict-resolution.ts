import { ASSET_CRITICALITY_LABELS } from "../assets/asset-criticality";
import { ASSET_STATUS_LABELS } from "../assets/asset-status";
import type { UpdateAssetInput } from "../assets/asset-fields";

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
 * === MIÉRT NEM A SZERVERTŐL KÉRJÜK EL AZ ÜTKÖZŐ MEZŐKET ===
 *
 * Kézenfekvő lenne, és rosszabb. A szerelőnek nem az a kérdése, hogy a szerver
 * MELYIK mezőn talált ütközést, hanem az, hogy amit ő beírt, az MIT ÍRNA FELÜL.
 * Ez a kettő nem ugyanaz: a szerver csak a ténylegesen ütköző mezőket nevezné
 * meg, a szerelő viszont a SAJÁT javításait keresi a képernyőn -- azokat is,
 * amelyek átmennének.
 *
 * Ezért ez a modul a SORBAN ÁLLÓ TÖRZSET veti össze a FRISSEN letöltött
 * eszközzel. Mindkettő megvan a telefonon, tehát nincs se új végpont, se új
 * mező, se olyan képesség, amit senki nem hív.
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
  inventoryNumber?: string | null;
  description?: string | null;
  notes?: string | null;
  /** A mostani helyszín, ha van. A NEVE kell, nem az azonosítója. */
  unit?: { id: string; name: string } | null;
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
  /**
   * ELTÉR-E A KETTŐ.
   *
   * NEM SZŰRJÜK KI a megegyezőket, és ez döntés: a szerelő a saját javításait
   * keresi a listán, és egy hiányzó sor mellett azt hinné, hogy azt a mezőt
   * elfelejtette. Aminél nincs eltérés, ott nincs is mit eldönteni -- azt a
   * képernyő halványabban mutatja, nem elrejti.
   */
  differs: boolean;
}

const MEZO_NEVE: Record<ComparableField, string> = {
  status: "Státusz",
  criticality: "Kritikusság",
  departmentId: "Helyszín",
  manufacturer: "Gyártó",
  model: "Modell",
  serialNumber: "Sorozatszám",
  inventoryNumber: "Partner azonosítója",
  description: "Leírás",
  notes: "Megjegyzés",
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
}): ConflictFieldRow[] {
  const rows: ConflictFieldRow[] = [];

  for (const field of Object.keys(MEZO_NEVE) as ComparableField[]) {
    if (!(field in input.patch)) continue;
    const mine = enyem(field, input.patch, input.unitNames);
    const theirs = ovek(field, input.current, input.unitNames);
    rows.push({
      field,
      label: MEZO_NEVE[field],
      mine,
      theirs,
      differs: mine !== theirs,
    });
  }

  return rows;
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
    case "inventoryNumber":
      target.inventoryNumber = source.inventoryNumber;
      return;
    case "description":
      target.description = source.description;
      return;
    case "notes":
      target.notes = source.notes;
      return;
  }
}

function enyem(
  field: ComparableField,
  patch: UpdateAssetInput,
  unitNames?: Record<string, string>,
): string {
  if (field === "status") return szoveg(ASSET_STATUS_LABELS, patch.status);
  if (field === "criticality")
    return szoveg(ASSET_CRITICALITY_LABELS, patch.criticality);
  if (field === "departmentId") return helyszin(patch.departmentId, unitNames);
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
