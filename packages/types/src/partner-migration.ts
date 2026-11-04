/**
 * EGY PARTNERTÖRZS, EGYSZERI ÁTVEZETÉS: A 17 PARTNER TERVE (`GET /admin/partner-migration`, settings.manage, CSAK OLVAS).
 * Minden partner (Supplier sor) egyetlen vevő-törzs sor (Customer) lesz; a szerep (beszállító, szerviz-partner) jelölés rajta.
 * Ez a terv soronként megmondja, mi történne vele, és mi alapján: Balázs ebből a listából dönt, mielőtt bármi ír.
 */

/** Mi történik a partnerrel az átvezetésnél. */
export const PARTNER_MIGRATION_ACTIONS = [
  /** a saját cégünk: kimarad, külön jelölt (Balázs dönt) */
  "SKIP_OWN",
  /** már van kötött vevő-sora, és nincs más sor ugyanazon az adószámon: csak a szerep-jelölés kerül rá */
  "MARK_ONLY",
  /** van kötött vevő-sora, DE ugyanazon az adószámon további vevő-sorok vannak: ezeket össze kell vonni vele */
  "MERGE_CANDIDATES",
  /** nincs kötött sora, és pontosan egy szabad vevő-sor van ugyanazon az adószámon: ahhoz kötjük */
  "BIND_EXISTING",
  /** nincs kötött sora, és több szabad vevő-sor van ugyanazon az adószámon: ember dönti el, melyikhez */
  "BIND_AMBIGUOUS",
  /** nincs kötött sora, és nincs egyező adószámú vevő-sor: új vevő-sor készül belőle */
  "CREATE_NEW",
] as const;
export type PartnerMigrationAction = (typeof PARTNER_MIGRATION_ACTIONS)[number];

export interface PartnerMigrationCustomer {
  id: string;
  customerNumber: string;
  displayName: string;
  taxNumber: string | null;
  euTaxNumber: string | null;
  /** a sor UNAS-ból jött (van `ExternalReference`-e) */
  fromUnas: boolean;
  /** hivatkozások száma (számla, rendelés, szerződés, munkalap, árajánlat, szerviz-munka) összesen */
  references: number;
}

export interface PartnerMigrationRow {
  supplierId: string;
  code: string;
  name: string;
  taxNumber: string | null;
  country: string | null;
  isActive: boolean;
  roles: ("SUPPLIER" | "SERVICE")[];
  worksheetPartnerCode: string | null;
  /** a már kötött vevő-sor (a szerviz-partner tükör-sora) */
  linkedCustomer: PartnerMigrationCustomer | null;
  /** ugyanazon az adószám-kulcson álló, szabad (más partnerhez nem kötött) vevő-sorok */
  candidates: PartnerMigrationCustomer[];
  /** adószám nélküli partnernél: azonos normalizált nevű szabad vevő-sorok (csak tájékoztatás, nem párosítás) */
  nameCandidates: PartnerMigrationCustomer[];
  action: PartnerMigrationAction;
  notes: string[];
}

export interface PartnerMigrationPlan {
  generatedAt: string;
  /** a partnerek száma és a műveletek szerinti bontása */
  total: number;
  byAction: Partial<Record<PartnerMigrationAction, number>>;
  rows: PartnerMigrationRow[];
}
