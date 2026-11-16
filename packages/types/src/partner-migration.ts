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

/**
 * AZ ÁTVEZETÉS FUTTATÁSA AZ OLDALRÓL (ugyanaz a mag, mint a `partner:migrate` parancs): `POST /admin/partner-migration/preview`
 * (próba, nem ír), `.../apply` (a próba lenyomatával), `.../restore/preview` és `.../restore/apply` (a naplózott eseményekből).
 */
/**
 * A KITÖLTÉS: a kötött (vagy most kötődő) vevő-sor ÜRES mezői a partner értékeivel (a Partnerek oldal a forrás, a vevő-sor a tükör).
 * Csak üres mezőt tölt; kitöltöttet SOHA nem ír felül. Három mező: a fizetési nap, a számlázási e-mail (a partner egyetlen e-mail
 * mezője) és a szerviz-partnerkód.
 */
export type PartnerMigrationFillField =
  "paymentDueDays" | "billingEmail" | "worksheetPartnerCode";

export interface PartnerMigrationFill {
  field: PartnerMigrationFillField;
  value: string | number;
}

export interface PartnerMigrationRunOperation {
  kind: "CREATE" | "BIND" | "FILL" | "SKIP";
  supplierId: string;
  code: string;
  /** a BIND-nál: a vevő-sor, amihez a partner kötődik; a FILL-nél: a már kötött vevő-sor, amit kitölt */
  customerId?: string;
  /** a BIND-nál és a FILL-nél: a kitöltendő üres mezők a partner értékével (a próba mutatja, a lenyomat tartalmazza) */
  fills?: PartnerMigrationFill[];
  /** csak a SKIP-nél: miért marad ki */
  reason?: string;
}

export interface PartnerMigrationRunPreview {
  /** a célzott adatbázis, jelszó nélkül (host:port/adatbázis): látszik, hogy stage vagy éles */
  target: string;
  operations: PartnerMigrationRunOperation[];
  /** a döntések hibái: ha van, az írás nem indul */
  problems: string[];
  counts: { create: number; bind: number; fill: number; skip: number };
  /** a lenyomat: az `apply` ezt kéri vissza, így csak az hajtódik végre, amit az ember látott */
  fingerprint: string;
}

export interface PartnerMigrationApplyInput {
  fingerprint: string;
  /** kifejezett kötési döntések: partner-kód -> vevő-sor azonosító (ugyanaz, mint a próbánál) */
  binds?: Record<string, string>;
}

export interface PartnerMigrationApplyOutcome {
  code: string;
  mode: "CREATED" | "BOUND" | "FILLED" | "SKIPPED";
  customerId?: string;
  detail?: string;
}

export interface PartnerMigrationApplyResult {
  target: string;
  outcomes: PartnerMigrationApplyOutcome[];
}

export interface PartnerMigrationRestoreOutcome {
  supplierId: string;
  customerId: string;
  result: "RESTORED" | "KEPT";
  detail?: string;
}

export interface PartnerMigrationRestorePreview {
  target: string;
  outcomes: PartnerMigrationRestoreOutcome[];
  fingerprint: string;
}

export interface PartnerMigrationRestoreInput {
  fingerprint: string;
}

export interface PartnerMigrationRestoreResult {
  target: string;
  outcomes: PartnerMigrationRestoreOutcome[];
}
