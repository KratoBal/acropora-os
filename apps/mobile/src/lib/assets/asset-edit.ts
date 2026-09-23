import type { QueuedAssetUpdateBase } from "../offline/asset-update-queue";

import type {
  AssetCriticality,
  AssetStatus,
  UpdateAssetInput,
} from "./asset-fields";
import { normalizeAssetLabelCode } from "./asset-label-mirror";
import { normalizePerformanceValue } from "./performance-mirror";

/**
 * The part of an asset this module reasons about. Structural on purpose:
 * `AssetDetail` from the API layer satisfies it, but nothing here imports
 * that layer, so this stays testable without the Expo runtime.
 */
export interface EditableAsset {
  updatedAt: string;
  /**
   * A tulajdonos típusa: az alegység csak szerviz partnernél értelmes.
   *
   * KÖTELEZŐ MEZŐ, és ez szándékos. Az API `AssetDetail` alakja `owner.type`
   * néven hordozza, tehát ha ez elhagyható lenne, a képernyő simán átadhatná a
   * szerver válaszát -- `ownerType` nélkül, `undefined` értékkel --, és az
   * alegység-ág SOHA nem futna le. Nem hibázna: csendben nem csinálna semmit.
   * Kötelezőként a fordító kényszeríti ki a leképezést a hívás helyén.
   */
  ownerType: "CUSTOMER" | "SUPPLIER";
  /**
   * AZ ESZKOZON MOST ALLO MATRICA KODJA, HA VAN. Ebbol tolt elo a szerkeszto
   * mezo -- egy ures doboz azt allitana, hogy nincs matrica, es a szerelo egy
   * mukodo kodot irna felul anelkul, hogy latna.
   */
  labelCode?: string;
  /** A partner alegysége, ahol az eszköz áll. Hiányzik, ha nincs megadva. */
  unit?: { id: string };
  /**
   * A MOSTANI KATEGORIA AZONOSITOJA ES NEVE.
   *
   * MIND A KETTO KELL, es a NEV az, ami nem magatol ertetodo: a valaszto a
   * TORZSADAT aktiv sorait kinalja, egy eszkozon viszont allhat KIVEZETETT
   * kategoria is. Ha csak az azonositot ismernenk, a kepernyo ures dobozt
   * mutatna -- es a szerelo azt hinne, nincs kategoria beallitva.
   *
   * Ugyanaz a hiba, amit a matricakodnal mar egyszer megfizettunk, es a
   * kovetkezmenye is ugyanaz: a szerelo vakon felulirna egy meglevo,
   * ervenyes erteket.
   */
  categoryId?: string;
  category?: string;
  /**
   * A MOSTANI FUNKCIO AZONOSITOJA ES NEVE -- FUGGETLEN A KATEGORIATOL, ugyanaz
   * a ketosseg, mint fent. Kanban 68add892, 2026-09-22.
   */
  functionId?: string;
  function?: string;
  /**
   * A TELJESÍTMÉNY, AHOGY A SZERVER ADJA -- SZÖVEGKÉNT.
   *
   * A tárolt alak `decimal(19,6)`. Számmá alakítva a lebegőpontos típuson
   * menne át, és egy `0,1`-es lépésköz `0.30000000000000004` alakban jönne
   * vissza a szerelőnek.
   */
  performance?: string;
  /** A teljesítmény mértékegysége. A pár másik fele. */
  performanceUnit?: { id: string };
  /**
   * A TÉRFOGAT ÉS A FOGYASZTÁS -- FÜGGETLEN A TELJESÍTMÉNYTŐL, nincs
   * mértékegység-társuk (mindig m3, illetve kW). Kanban 8c77cf3e,
   * 2026-09-23.
   */
  volume?: string;
  powerConsumption?: string;
  /** A fogyasztas eredeti szovege -- lasd a `powerConsumption` fejleceit. */
  powerConsumptionRaw?: string;
  status: AssetStatus;
  criticality: AssetCriticality;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  inventoryNumber?: string;
  description?: string;
  notes?: string;
}

/**
 * What the phone is allowed to change about an asset.
 *
 * Deliberately narrower than the web editor, which also moves an asset
 * between owners, addresses and parents. Those are desk decisions needing
 * pickers over long lists; a technician standing in front of the
 * equipment is correcting what they can see on it - a serial number, a
 * model, what state it is in, and what they noticed.
 *
 * AZ ALEGYSÉG (`unitId`) 2026-08-27 ÓTA BENNE VAN, pedig elhelyezés-adat. Nem
 * a fenti szabály alóli kivétel, hanem a szabály INDOKA szerint tartozik ide:
 * a választó egyetlen partner rövid helyszín-fája, nem hosszú lista, és épp az
 * az adat, amit a helyszínen álló szerelő tud a legjobban -- melyik gépháznál,
 * melyik medencénél áll a gép. A tulajdonos, a cím és a szülő továbbra is
 * kimarad, változatlan indokkal.
 *
 * A MÁSIK FELE, amiért mégis ide kellett: a felviteli űrlap ugyanaznap megkapta
 * a helyszín-választót. Egy mező, amit felvinni lehet, de javítani nem, egy
 * elgépelés után zsákutca -- a szerelő a terepen nem tud mit kezdeni magával.
 *
 * Dates are left out as well, and not for lack of interest: a date picker
 * is a new native dependency, and adding one is a decision of its own.
 * The web keeps them until then.
 */
export interface AssetEditForm {
  /**
   * A partner alegysége. Üres szöveg annyit tesz: nincs megadva -- és mivel a
   * szerver a `null` értéket törlésnek veszi, egy kiürített választás
   * ténylegesen leszedi az eszközről a helyszínt.
   */
  unitId: string;
  status: AssetStatus;
  criticality: AssetCriticality;
  /**
   * A VALASZTOTT KATEGORIA AZONOSITOJA. Ures szoveg annyit tesz: nincs
   * megadva -- es mivel a szerver a `null` erteket torlesnek veszi, egy
   * kiuritett valasztas tenylegesen leszedi az eszkozrol a kategoriat.
   * Ugyanaz a harmas jelentes, mint a helyszinnel.
   */
  categoryId: string;
  /**
   * A VALASZTOTT FUNKCIO AZONOSITOJA -- FUGGETLEN A KATEGORIATOL, ugyanaz a
   * harmas jelentes. Kanban 68add892, 2026-09-22.
   */
  functionId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  inventoryNumber: string;
  description: string;
  notes: string;
  /**
   * AZ ELORE NYOMTATOTT MATRICA KODJA. A mezo a SZERVER szerinti jelenlegi
   * kodbol toltodik fel, nem uresen indul: amit a szerelo lat, az a valosag.
   * Enelkul egy meglevo matricat lehetne vakon felulirni.
   */
  labelCode: string;
  /**
   * A TELJESÍTMÉNY ÉS A MÉRTÉKEGYSÉGE -- KÉT MEZŐ, EGY ADAT.
   *
   * A kettő EGYÜTT mozog: a táblán CHECK áll rajta. Az üres pár azt jelenti,
   * hogy nincs megadva; fél pár nem menthető, sem itt, sem a szerveren.
   */
  performance: string;
  performanceUnitId: string;
  /**
   * A TÉRFOGAT ÉS A FOGYASZTÁS -- FÜGGETLEN A TELJESÍTMÉNYTŐL, mindkettő
   * mindig fix egységben értendő (m3, illetve kW), nincs mértékegység-mező.
   */
  volume: string;
  powerConsumption: string;
  powerConsumptionRaw: string;
}

const TEXT_FIELDS = [
  "manufacturer",
  "model",
  "serialNumber",
  "inventoryNumber",
  "description",
  "notes",
  /**
   * A FOGYASZTAS EREDETI SZOVEGE IDE ILLIK, A `volume`/`powerConsumption`-nel
   * ELLENTETBEN: szabad szoveg, nincs alak-ellenorzese, tehat a generikus
   * mintaba tartozik.
   */
  "powerConsumptionRaw",
] as const;

/** Fills the form from what the server last said about the asset. */
export function assetEditFormFrom(asset: EditableAsset): AssetEditForm {
  return {
    unitId: asset.unit?.id ?? "",
    categoryId: asset.categoryId ?? "",
    functionId: asset.functionId ?? "",
    status: asset.status,
    criticality: asset.criticality,
    manufacturer: asset.manufacturer ?? "",
    model: asset.model ?? "",
    serialNumber: asset.serialNumber ?? "",
    inventoryNumber: asset.inventoryNumber ?? "",
    description: asset.description ?? "",
    notes: asset.notes ?? "",
    labelCode: asset.labelCode ?? "",
    performance: asset.performance ?? "",
    performanceUnitId: asset.performanceUnit?.id ?? "",
    volume: asset.volume ?? "",
    powerConsumption: asset.powerConsumption ?? "",
    powerConsumptionRaw: asset.powerConsumptionRaw ?? "",
  };
}

/**
 * An emptied field means "clear this", which the server spells `null`. An
 * absent field means "leave it alone". The difference matters: sending
 * every field on every save would overwrite whatever somebody edited
 * elsewhere between the phone loading the asset and saving it.
 */
function textPatchValue(
  current: string,
  original: string | undefined,
): string | null | undefined {
  const trimmed = current.trim();
  if (trimmed === (original ?? "").trim()) return undefined;
  return trimmed === "" ? null : trimmed;
}

/**
 * Builds the PATCH body: only what actually changed, plus the timestamp
 * the server uses to notice that somebody else got there first.
 */
export function buildAssetPatch(
  asset: EditableAsset,
  form: AssetEditForm,
): UpdateAssetInput {
  const patch: UpdateAssetInput = { expectedUpdatedAt: asset.updatedAt };

  if (form.status !== asset.status) patch.status = form.status;
  if (form.criticality !== asset.criticality) {
    patch.criticality = form.criticality;
  }

  for (const field of TEXT_FIELDS) {
    const value = textPatchValue(form[field], asset[field]);
    if (value !== undefined) patch[field] = value;
  }

  /**
   * AZ ALEGYSÉG CSAK SZERVIZ PARTNER ESZKÖZÉN KÜLDHETŐ. Vevő tulajdonosnál a
   * szerver elutasítaná (ott a cím a pontosítás), és a hiba a mentés
   * pillanatában jelenne meg. A képernyő ilyenkor meg sem mutatja a választót,
   * de a formban ottmaradhat egy korábbi érték -- a TULAJDONOS TÍPUSA dönt,
   * nem az, hogy van-e érték.
   */
  /**
   * A MATRICAKOD NEM A SZOVEGES MEZOK SZABALYAT KOVETI, ES EZ SZANDEKOS.
   *
   * A `textPatchValue` egy kiuritett mezore `null`-t kuld, ami a szerveren
   * "toroljed" jelentessel bir. A matricanal ez ma NEM letezik: az
   * `UpdateAssetDto` szandekosan `string`-et var, nem `string | null`, mert a
   * leszedesnek nincs neve az esemeny-naploban (lasd a szerver oldali
   * dontest). Egy `null` ott 400-zal bukna el.
   *
   * EZERT HAROM AG HELYETT KETTO ALL ITT: valtozott es nem ures -> megy;
   * minden mas -> nem megy. A kiuritest a kepernyo mondja ki szoban, nem egy
   * nema keres, ami ugyis elbukna.
   */
  const kod = form.labelCode.trim().toUpperCase();
  if (kod !== "" && kod !== (asset.labelCode ?? "").trim().toUpperCase())
    patch.labelCode = kod;

  /**
   * A TELJESÍTMÉNY-PÁR: MINDEN OLDALT KÜLÖN KÜLDÜNK, AMI VÁLTOZOTT.
   *
   * ÉS EZ NEM UGYANAZ, MINT A SZÖVEGES MEZŐK SZABÁLYA: ott a kiürítés `null`,
   * és az önmagában rendben van. Itt a `null` is TÖRLÉS, de a pár MÁSIK
   * felének is mennie kell vele, különben a szerver fél párt kapna.
   *
   * A szerver az EREDMÉNYT nézi, nem a beküldött mezőt, tehát a „csak a
   * számot írtam át" eset egyetlen kulccsal is átmegy. Amit itt el kell
   * kerülni, az a fél TÖRLÉS: egy kiürített szám mellett álló mértékegység.
   * Azt az `assetPerformanceEditProblem` fogja meg, a sorba tétel ELŐTT.
   */
  const ertek = normalizePerformanceValue(form.performance);
  const regiErtek = asset.performance ?? null;
  const egyseg = form.performanceUnitId.trim();
  const regiEgyseg = asset.performanceUnit?.id ?? "";
  if (ertek !== regiErtek) patch.performance = ertek;
  if (egyseg !== regiEgyseg)
    patch.performanceUnitId = egyseg === "" ? null : egyseg;

  /**
   * A KATEGORIA MINDEN TULAJDONOSNAL MEHET, ELLENTETBEN AZ ALEGYSEGGEL.
   *
   * Az alegyseget a kovetkezo blokk a tulajdonos TIPUSAHOZ koti, mert vevonel
   * a szerver elutasitana. A kategoria nem ilyen: torzsadat, ami minden
   * eszkozon ertelmes -- tehat a feltetel ide NEM jar, es a masolas kedveert
   * sem szabad odatenni.
   */
  const kategoria = form.categoryId.trim();
  if (kategoria !== (asset.categoryId ?? ""))
    patch.categoryId = kategoria === "" ? null : kategoria;

  /**
   * A TERFOGAT -- FUGGETLEN A TELJESITMENYTOL, NINCS PAR. Az alakot az
   * `assetVolumeEditProblem` ellenorzi, a sorba tetel ELOTT -- ugyanaz a
   * minta, mint a matricakodnal.
   */
  const terfogat = normalizePerformanceValue(form.volume);
  const regiTerfogat = asset.volume ?? null;
  if (terfogat !== regiTerfogat) patch.volume = terfogat;

  /**
   * A FOGYASZTAS -- AZ OSSZEADHATO SZAM, UGYANAZ A SZABALY, MINT A
   * TERFOGATNAL. Balazs kerese (2026-09-23): ossze akarja adni a
   * fogyasztast, tehat ez SZAM. A `powerConsumptionRaw` (lent, a
   * `TEXT_FIELDS` hurokban) orzi az eredeti "P1/P2" alaku szoveget.
   */
  const fogyasztas = normalizePerformanceValue(form.powerConsumption);
  const regiFogyasztas = asset.powerConsumption ?? null;
  if (fogyasztas !== regiFogyasztas) patch.powerConsumption = fogyasztas;

  /**
   * A FUNKCIO -- FUGGETLENUL A KATEGORIATOL, ugyanaz a szabaly, mint felette:
   * minden tulajdonosnal ertelmes torzsadat, a feltetel ide NEM jar.
   */
  const funkcio = form.functionId.trim();
  if (funkcio !== (asset.functionId ?? ""))
    patch.functionId = funkcio === "" ? null : funkcio;

  if (asset.ownerType === "SUPPLIER") {
    const chosen = form.unitId.trim();
    const current = asset.unit?.id ?? "";
    if (chosen !== current) patch.departmentId = chosen === "" ? null : chosen;
  }

  return patch;
}

/**
 * Whether there is anything to send. Saving an unchanged form would still
 * bump `updatedAt` and could still lose a conflict, so the save button
 * stays inert until something actually differs.
 */
export function hasAssetChanges(
  asset: EditableAsset,
  form: AssetEditForm,
): boolean {
  return Object.keys(buildAssetPatch(asset, form)).length > 1;
}

/**
 * AMIT A SZERELO LATOTT, MIELOTT ATIRTA -- csak a TORZSBEN szereplo mezokre.
 *
 * === MIERT PONTOSAN EZ A HALMAZ ===
 *
 * A feloldo keperno azt kerdezi meg mezonkent, hogy MAS is hozzanyult-e. Ehhez
 * harom ertek kell: a latott, a beirt es a mostani. A latott ertekeket csak
 * ITT lehet felvenni, mert csak itt van meg az az allapot, amibol a szerelo
 * kiindult -- a sorba tetel utan mar sehol nincs meg.
 *
 * CSAK A TORZS MEZOIRE, es nem az egesz eszkozre: amihez a szerelo hozza sem
 * nyult, arrol nincs mit eldonteni, es egy teljes masolat a sort duzzasztana.
 *
 * === A NYERS ERTEK MEGY, NEM A KIIRT SZOVEG ===
 *
 * A helyszinnel az AZONOSITO, nem a nev: egy atnevezett helyszin kulonben
 * valtozasnak latszana, holott ugyanaz a helyszin.
 */
/**
 * A MATRICAKOD ALAKJA, A MENTES ELOTT -- ES EZ AZ OFFLINE SOR MIATT KELL.
 *
 * Kapcsolat nelkul a mentes SORBA kerul, nem a szerverhez: egy rossz alaku kod
 * igy csak a sor kiuritesekor bukna el, akar orakkal kesobb, amikor a szerelo
 * mar nincs a gepnel. A felviteli ut eddig is a keres ELOTT dontott
 * (`buildAssetCreatePayload`), ugyanezzel a kozos fuggvennyel.
 *
 * AZ URES MEZO NEM HIBA: az azt jelenti, hogy nem nyultak hozza. A leszedes
 * ezen az uton nem letezik (lasd a `buildAssetPatch` megjegyzeset).
 */
export function assetLabelEditProblem(form: AssetEditForm): "malformed" | null {
  const kod = form.labelCode.trim();
  if (kod === "") return null;
  return normalizeAssetLabelCode(kod) === null ? "malformed" : null;
}

/**
 * A TERFOGAT ALAKJA, A MENTES ELOTT -- UGYANAZ A MINTA, MINT A MATRICAKODNAL,
 * es szandekosan NEM a teljesitmeny-part masolja: a `volume`-nak nincs
 * mertekegyseg-tarsa, tehat itt csak az ALAK szamit, nem egy hianyzo fel.
 *
 * KULON FUGGVENY KELL, mert a `buildAssetPatch` a `normalizePerformanceValue`
 * ereden csendben `null`-t ad egy elgepelt szamra is -- ugyanugy, mint egy
 * szandekosan kiuritett mezore. Enelkul egy "abc" beirasa TORLESKENT menne
 * sorba, ahelyett hogy a szerelo hibauzenetet kapna.
 */
export function assetVolumeEditProblem(
  form: AssetEditForm,
): "malformed" | null {
  const ertek = form.volume.trim();
  if (ertek === "") return null;
  return normalizePerformanceValue(ertek) === null ? "malformed" : null;
}

/**
 * A FOGYASZTAS ALAKJA, A MENTES ELOTT -- SZO SZERINT A `assetVolumeEditProblem`
 * SZERKEZETE. Balazs kerese (2026-09-23): a fogyasztast ossze akarja adni,
 * tehat ez is SZAM lett, es ugyanugy alak-ellenorzest igenyel.
 */
export function assetPowerConsumptionEditProblem(
  form: AssetEditForm,
): "malformed" | null {
  const ertek = form.powerConsumption.trim();
  if (ertek === "") return null;
  return normalizePerformanceValue(ertek) === null ? "malformed" : null;
}

/**
 * A TELJESÍTMÉNY-PÁR BAJA, A MENTÉS ELŐTT -- ÉS EZ AZ OFFLINE SOR MIATT KELL.
 *
 * Kapcsolat nélkül a mentés SORBA kerül, nem a szerverhez: egy fél pár így
 * csak a sor kiürítésekor bukna el, akár órákkal később, amikor a szerelő már
 * nincs a gépnél. Az adat pedig ott és akkor volt.
 *
 * AZ EREDMÉNYT NÉZI, NEM A BEÍRT MEZŐT -- ugyanúgy, ahogy a szerver. Ez a
 * kettő ugyanaz a szabály két helyen, és szándékosan: az egyik a visszajelzés
 * gyorsasága, a másik a szabály.
 */
export function assetPerformanceEditProblem(
  form: AssetEditForm,
): "malformed" | "missing-unit" | "missing-value" | null {
  const beirt = form.performance.trim();
  const ertek = normalizePerformanceValue(form.performance);
  if (beirt !== "" && ertek === null) return "malformed";
  const egyseg = form.performanceUnitId.trim();
  if (ertek !== null && egyseg === "") return "missing-unit";
  if (ertek === null && egyseg !== "") return "missing-value";
  return null;
}

/** A mondat, amit a szerelő lát. Egy helyen, mert két képernyő olvassa. */
export const PERFORMANCE_PROBLEM_MESSAGES: Record<
  "malformed" | "missing-unit" | "missing-value",
  string
> = {
  malformed:
    "A teljesítmény csak szám lehet, legfeljebb hat tizedesjeggyel (például 0,5 vagy 500).",
  "missing-unit": "Válassz mértékegységet a teljesítmény mellé.",
  "missing-value":
    "Írj teljesítmény-értéket a mértékegység mellé, vagy töröld a mértékegységet is.",
};

export function baseValuesFor(
  asset: EditableAsset,
  patch: UpdateAssetInput,
): QueuedAssetUpdateBase {
  const base: QueuedAssetUpdateBase = {};
  if ("status" in patch) base.status = asset.status;
  if ("criticality" in patch) base.criticality = asset.criticality;
  if ("departmentId" in patch) base.departmentId = asset.unit?.id ?? null;
  /**
   * A KATEGORIA IS BEKERUL A SORBA, ugyanabbol az okbol, mint a tobbi: a
   * feloldas kulonben nem tudna, MIHEZ kepest keszult a pinceben beirt ertek,
   * es a szerelo nem latna, hogy kozben az iroda irt ra masikat.
   */
  if ("categoryId" in patch) base.categoryId = asset.categoryId ?? null;
  /**
   * A FUNKCIO IS BEKERUL A SORBA, ugyanabbol az okbol, mint a kategoria.
   */
  if ("functionId" in patch) base.functionId = asset.functionId ?? null;
  /**
   * A TELJESITMENY-PAR IS BEKERUL A SORBA, ES A KET FELE KULON.
   *
   * MIERT KELL: a pinceben beirt teljesitmeny kulonben CSENDBEN elveszne -- a
   * sor torzse vinne ugyan a valtozast, de az utkozes-feloldas nem tudna,
   * MIHEZ kepest keszult, es a szerelo nem latna, hogy kozben az iroda irt ra
   * masikat.
   *
   * KET KULON SOR, mert a ket fele kulon is valtozhat: aki csak a szamot irja
   * at, arra az egyseg alapertekre nincs szukseg.
   */
  if ("performance" in patch) base.performance = asset.performance ?? null;
  if ("performanceUnitId" in patch)
    base.performanceUnitId = asset.performanceUnit?.id ?? null;
  /**
   * A TERFOGAT ES A FOGYASZTAS IS BEKERUL A SORBA, ugyanabbol az okbol, mint
   * a teljesitmeny -- de kulon-kulon, mert nincs koztuk par-kenyszer.
   */
  if ("volume" in patch) base.volume = asset.volume ?? null;
  if ("powerConsumption" in patch)
    base.powerConsumption = asset.powerConsumption ?? null;
  for (const field of TEXT_FIELDS)
    if (field in patch) base[field] = asset[field] ?? null;
  /**
   * A MATRICAKOD KULON SOR, MERT NINCS A `TEXT_FIELDS` KOZOTT.
   *
   * Es ez a fajta kihagyas NEM BUKIK EL MAGATOL: a `QueuedAssetUpdateBase`
   * minden mezoje opcionalis, tehat a fordito hallgatna, a sor felmenne, es a
   * feloldo kepernyo csak annyit tudna, hogy "nincs alapertek" -- amire a sajat
   * szabalya szerint TOBBET kerdez a kelleténel. Nem hibazna: csak zajosabb
   * lenne, es senki nem tudna, miert.
   */
  if ("labelCode" in patch) base.labelCode = asset.labelCode ?? null;
  return base;
}
