/**
 * EGY PARTNERTÖRZS, 1. LÉPÉS: A DUPLIKÁTUM-MÉRÉS VÁLASZA (`GET /admin/partner-duplicates`, settings.manage). A válasz a
 * felületnek szól: nevet és adószámot tartalmaz, ezért csak jogosult felhasználónak jelenik meg. A naplósor (a flottának)
 * ugyanezeket a számokat adja, név nélkül. Az API ezt a típust adja vissza (a fordító egyezteti a két oldalt), nincs
 * külön másolata.
 */
export type PartnerDuplicateKeyKind = "HU" | "EU" | "HU4";

export interface PartnerDuplicateReferences {
  invoices: number;
  salesOrders: number;
  contracts: number;
  worksheets: number;
  quotes: number;
  serviceJobs: number;
}

export interface PartnerDuplicateCustomer {
  id: string;
  customerNumber: string;
  displayName: string;
  companyName: string | null;
  type: string;
  taxNumber: string | null;
  euTaxNumber: string | null;
  /** a sor egy partner vevő-tükre */
  partnerMirror: boolean;
  /** van UNAS-hivatkozása */
  fromUnas: boolean;
  references: PartnerDuplicateReferences;
}

export interface PartnerDuplicateGroup {
  kind: PartnerDuplicateKeyKind;
  key: string;
  customers: PartnerDuplicateCustomer[];
}

export interface PartnerDuplicateSupplier {
  id: string;
  code: string;
  name: string;
  taxNumber: string | null;
  country: string | null;
  customerId: string | null;
}

export interface PartnerDuplicatePair {
  kind: PartnerDuplicateKeyKind;
  key: string;
  supplier: PartnerDuplicateSupplier;
  customer: PartnerDuplicateCustomer;
}

export interface PartnerDuplicateResponse {
  generatedAt: string;
  /** a naplósor, csak számokkal */
  summary: string;
  /** azonos magyar alap (nem 4-gyel kezdődő) vagy azonos közösségi kulcs */
  strong: PartnerDuplicateGroup[];
  /** a 4-gyel kezdődő magyar alap (csoportos adóalanyiság): csak lista */
  weakGroupTax: PartnerDuplicateGroup[];
  /** szállító és vevő ugyanazon a kulcson, összekötés nélkül */
  unlinked: PartnerDuplicatePair[];
  unas: { total: number; withoutTaxNumber: number };
}
