import type { QueuedAssetUpdateBase } from "../offline/asset-update-queue";

import type {
  AssetCriticality,
  AssetStatus,
  UpdateAssetInput,
} from "./asset-fields";
import { normalizeAssetLabelCode } from "./asset-label-mirror";

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
}

const TEXT_FIELDS = [
  "manufacturer",
  "model",
  "serialNumber",
  "inventoryNumber",
  "description",
  "notes",
] as const;

/** Fills the form from what the server last said about the asset. */
export function assetEditFormFrom(asset: EditableAsset): AssetEditForm {
  return {
    unitId: asset.unit?.id ?? "",
    status: asset.status,
    criticality: asset.criticality,
    manufacturer: asset.manufacturer ?? "",
    model: asset.model ?? "",
    serialNumber: asset.serialNumber ?? "",
    inventoryNumber: asset.inventoryNumber ?? "",
    description: asset.description ?? "",
    notes: asset.notes ?? "",
    labelCode: asset.labelCode ?? "",
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

export function baseValuesFor(
  asset: EditableAsset,
  patch: UpdateAssetInput,
): QueuedAssetUpdateBase {
  const base: QueuedAssetUpdateBase = {};
  if ("status" in patch) base.status = asset.status;
  if ("criticality" in patch) base.criticality = asset.criticality;
  if ("departmentId" in patch) base.departmentId = asset.unit?.id ?? null;
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
