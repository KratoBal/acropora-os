/**
 * The asset vocabulary, kept in one place and free of any import from the
 * fetch/SecureStore layer, so the logic that reasons about these values
 * stays compilable and testable with plain `tsc` + `node --test`.
 *
 * `src/lib/api/assets.ts` re-exports these, so callers keep importing
 * whichever module they already used.
 */

export type AssetKind =
  "SYSTEM" | "EQUIPMENT" | "COMPONENT" | "SENSOR" | "OTHER";
export type AssetStatus =
  "ACTIVE" | "WARM_STANDBY" | "COLD_STANDBY" | "IN_REPAIR" | "RETIRED";
export type AssetCriticality = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type AssetOwnerType = "CUSTOMER" | "SUPPLIER";

/**
 * The PATCH body for `/service/assets/:id`, mirroring the server's
 * `UpdateAssetDto`. Only the fields the mobile client can send are listed
 * - the web editor covers the rest.
 *
 * `expectedUpdatedAt` is required by the server, which compares it to the
 * row and refuses the write if they differ. That is what stops one client
 * from silently undoing another's edit.
 */
export interface UpdateAssetInput {
  expectedUpdatedAt: string;
  /**
   * A partner alegysége. `null` törli a kötést, a mező elhagyása érintetlenül
   * hagyja -- ugyanaz a hármas jelentés, mint a szöveges mezőknél.
   */
  departmentId?: string | null;
  status?: AssetStatus;
  criticality?: AssetCriticality;
  /**
   * A KATEGORIA AZONOSITOJA, A TORZSADATBOL.
   *
   * `null` TOROL, a mezo elhagyasa erintetlenul hagy -- ugyanaz a harmas
   * jelentes, mint a szoveges mezoknel, es a matricaval ELLENTETES. A
   * kulonbseg oka ugyanaz a szabaly: a `null` torlest jelent, es a kategoria
   * torlese LETEZIK (az eszkoz allhat kategoria nelkul; az atvezeto migracio
   * szandekosan hagy ilyen sorokat).
   *
   * AZONOSITO MEGY, NEM NEV: a nev a torzsadaton atnevezheto, es egy
   * atnevezes kulonben valtozasnak latszana.
   */
  categoryId?: string | null;
  /**
   * A FUNKCIO AZONOSITOJA -- FUGGETLEN A KATEGORIATOL, ugyanaz az alak.
   * Kanban 68add892, 2026-09-22.
   */
  functionId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  /**
   * A MEZO NEVE 2026-09-23-IG "inventoryNumber" VOLT -- Balazs kerese: ez
   * mindig a partner sajat kodja volt. Az IGAZI leltari szam uj, kulon mezo
   * a szerveren, de a mobil ma nem tudja szerkeszteni (nincs felulete),
   * ezert ez a tipus -- SZANDEKOSAN a mobil altal kuldhetokre szukitve --
   * nem is hordozza.
   */
  partnerInternalCode?: string | null;
  description?: string | null;
  notes?: string | null;
  /**
   * AZ ELORE NYOMTATOTT MATRICA KODJA, UTOLAG IS.
   *
   * ES ITT NINCS `| null`, holott a tobbi mezon ott van -- nem feledekenysegbol:
   * a szerver `UpdateAssetDto`-ja is `string`-et var. A matrica LESZEDESE ma
   * nem letezik (az esemeny-naploban nincs neve), tehat egy `null` 400-zal
   * bukna el. A tipus igy MAR ITT megmondja, ami a szerveren is all.
   */
  labelCode?: string;
  /**
   * A TELJESITMENY ES A MERTEKEGYSEGE -- ES ITT VAN `| null`, A MATRICAVAL
   * ELLENTETBEN.
   *
   * A ket ellentetes alak ugyanabbol a szabalybol jon: a `null` TORLEST
   * jelent, es a teljesitmenynel a torles LETEZIK. Csak EGYUTT megy: fel par
   * a tablan sem allhat meg (`Asset_performance_pairing_check`).
   */
  performance?: string | null;
  performanceUnitId?: string | null;
  /**
   * A TERFOGAT -- FUGGETLEN A TELJESITMENYTOL, nincs mertekegyseg-tarsa
   * (mindig m3). Kanban 8c77cf3e, 2026-09-23.
   */
  volume?: string | null;
  /** A FOGYASZTAS -- ugyanaz az alak, mint a `volume`-nal, mindig kW-ban. */
  powerConsumption?: string | null;
  /** A fogyasztas eredeti szovege -- `null` torli, a mezo elhagyasa erintetlenul hagyja. */
  powerConsumptionRaw?: string | null;
}
