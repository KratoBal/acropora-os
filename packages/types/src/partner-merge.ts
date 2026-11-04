/**
 * EGY PARTNERTÖRZS, 4. LÉPÉS: AZ ÖSSZEVONÁS-SZOLGÁLTATÁS ÉS A VISSZAVONÁS (`/admin/partner-merges`, settings.manage).
 * Két vevő-sort egybe vonunk: a MEGMARADÓ sor (`kept`) kapja a MEGSZŰNŐ sor (`merged`) minden hivatkozását, a megszűnő sor nem
 * törlődik, hanem archiválódik (`mergedIntoId`), és minden áthelyezett sor azonosítóval a naplóba kerül, ebből a visszavonás
 * kiolvasható. A kiállított számlák tartalma (vevő-pillanatkép, Számlázz.hu-ban tárolt bizonylat) nem változik, csak az
 * `Invoice.customerId`.
 */

/** A hivatkozó táblák, amelyek sorai az összevonáskor a megmaradó sorra kerülnek (a `Supplier` nem: lásd az ütközéseket). */
export const PARTNER_MERGE_REFERENCE_TABLES = [
  "SalesOrder",
  "Aquarium",
  "ServiceJob",
  "Invoice",
  "Project",
  "Asset",
  "WorksheetDepartment",
  "Worksheet",
  "Contract",
  "Quote",
  "PartnerOrder",
  "ReefClubCustomerLink",
  "ReefClubLinkCode",
  "User",
  "CustomerAddress",
  "CustomerAlias",
  "ExternalReference",
] as const;
export type PartnerMergeReferenceTable =
  (typeof PARTNER_MERGE_REFERENCE_TABLES)[number];

/** Egy vevő-sor a döntéshez: azonosító, név és a kulcsok, a hivatkozások számával. */
export interface PartnerMergeSide {
  id: string;
  customerNumber: string;
  displayName: string;
  companyName: string | null;
  type: string;
  taxNumber: string | null;
  euTaxNumber: string | null;
  email: string | null;
  /** a sor egy partner vevő-tükre (van `Supplier` kötése) */
  partnerMirror: boolean;
  archived: boolean;
  /** hivatkozások táblánként; csak a nullánál nagyobbak szerepelnek */
  references: Partial<Record<PartnerMergeReferenceTable, number>>;
}

/** Egy mező, ami az összevonáskor a megmaradó sorba kerül (a megmaradó üres volt), vagy ami jegyzetként marad. */
export interface PartnerMergeFieldFill {
  field: string;
  /** `fill`: a megmaradó üres mezője kitöltődik; `move`: a szerviz-kód átkerül; `type`: a típus COMPANY lesz */
  kind: "fill" | "move" | "type";
  /** a megmaradó sor mezője, ahová kerül (az ütköző e-mail a számlázási e-mailbe) */
  into: string;
}

export interface PartnerMergePreview {
  keptId: string;
  mergedId: string;
  kept: PartnerMergeSide | null;
  merged: PartnerMergeSide | null;
  /** a megszűnő sor hivatkozásai táblánként: ennyi sor kerül át */
  willMove: Partial<Record<PartnerMergeReferenceTable, number>>;
  fieldFills: PartnerMergeFieldFill[];
  /** olyan eltérések, amik NEM blokkolnak, de a naplóban és itt látszanak (két különböző e-mail, két telefonszám) */
  notes: string[];
  /** AMI MEGÁLLÍTJA az összevonást: magyarul, felhasználónak szánt mondatok */
  blockers: string[];
  /** a javaslat, ha a kettő felcserélve volna helyes (a Supplier-kötéses sor marad) */
  suggestSwap: boolean;
  canExecute: boolean;
  /** az előnézet lenyomata: a végrehajtás ezt kéri vissza, így csak azt hajtja végre, amit látott az ember */
  fingerprint: string;
}

export interface PartnerMergeExecuteInput {
  keptId: string;
  mergedId: string;
  /** az előnézet `fingerprint`-je */
  fingerprint: string;
  /** szabad szöveg: miért (naplóba) */
  reason?: string;
}

export interface PartnerMergeLogEntry {
  id: string;
  keptId: string;
  mergedId: string;
  reason: string | null;
  createdAt: string;
  undoneAt: string | null;
  /** táblánként az áthelyezett sorok száma */
  moved: Partial<Record<PartnerMergeReferenceTable, number>>;
}

export interface PartnerMergeUndoResult {
  logId: string;
  /** táblánként a visszavitt sorok száma */
  restored: Partial<Record<PartnerMergeReferenceTable, number>>;
  /** táblánként azok, amik közben máshová kerültek, ezért nem mozdultak */
  skipped: Partial<Record<PartnerMergeReferenceTable, number>>;
  /** a kezelőnek szánt megjegyzések (például: a visszavont UNAS-hivatkozáson az összevonás óta érkezett rekord a megmaradó soron maradt) */
  notes: string[];
}
