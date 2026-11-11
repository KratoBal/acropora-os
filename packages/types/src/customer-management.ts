import type { PartnerTaxHint } from "./buyer-tax-number.js";

export type CustomerType = "PERSON" | "COMPANY";
export type CustomerStatusFilter = "ACTIVE" | "ARCHIVED" | "ALL";

/// "UNAS" ha a vevőhöz létezik ExternalReference(system=UNAS, entityType=Customer),
/// egyébként "MANUAL". Sosem tárolt mező a Customer modellen - ld. ADR-0009.
export type CustomerSource = "UNAS" | "MANUAL";

export type CustomerAddressType = "BILLING" | "SHIPPING" | "OTHER";

export interface CustomerAddress {
  id: string;
  type: CustomerAddressType;
  name?: string;
  country: string;
  postalCode: string;
  city: string;
  line1: string;
  line2?: string;
  isDefault: boolean;
}

export interface CustomerSummary {
  id: string;
  customerNumber: string;
  /** UNAS forrású vevőnél a UNAS azonosító, egyébként a customerNumber. */
  partnerCode: string;
  source: CustomerSource;
  type: CustomerType;
  displayName: string;
  companyName?: string;
  /** A rendelési (általános) e-mail cím. */
  email?: string;
  /** A számlázási e-mail cím; a kézi számla erre megy, ha üres, az `email`-re. */
  billingEmail?: string;
  phone?: string;
  isActive: boolean;
  archivedAt?: string;
  /** Egysoros, formázott alapértelmezett (vagy első) cím, listás megjelenítéshez. */
  address: string | null;
  createdAt: string;
  updatedAt: string;
  /** a magyar adószám (a számla vevőválasztója mutatja) */
  taxNumber?: string;
  /**
   * Ez a sor egy partner vevő-tükre (`Supplier.customerId`): a számla kapuja (kártya
   * aaf4f09d) partnernek mindig adószámot kér, és a vevőválasztó „Partner” jellel mutatja.
   */
  partnerMirror?: boolean;
  /**
   * A SZEREPEK JELÖLÉSKÉNT A SOR(ON) (egy partnertörzs): a `Supplier` kötésből és a jelzőiből származtatva, külön oszlop nélkül.
   * Csak a partner-sornál van; a vevőnél hiányzik.
   */
  partnerRoles?: CustomerPartnerRole[];
}

/** A partner szerepei a vevő-soron. */
export const CUSTOMER_PARTNER_ROLES = ["SUPPLIER", "SERVICE"] as const;
export type CustomerPartnerRole = (typeof CUSTOMER_PARTNER_ROLES)[number];

/**
 * A VEVŐK LISTA SZEREP-SZŰRŐJE (egy partnertörzs: egy lista, szerep-szűrővel és jelvényekkel). Hiányzó: a régi viselkedés
 * (a partner-sorok nélkül, a választók ezt várják); jelen lévő érték: a lista a partnereket is mutatja.
 * `ALL` mindenki, `BUYER` csak a vevők (nem partnerek), `PARTNER` minden partner, `SUPPLIER` a beszállítók, `SERVICE` a
 * szerviz-partnerek.
 */
export const CUSTOMER_LIST_ROLES = [
  "ALL",
  "BUYER",
  "PARTNER",
  "SUPPLIER",
  "SERVICE",
] as const;
export type CustomerListRole = (typeof CUSTOMER_LIST_ROLES)[number];

export interface CustomerDetail extends CustomerSummary {
  /**
   * The community (EU) tax number, apart from the Hungarian one: the
   * Számlázz.hu Agent takes it in `<adoszamEU>`, never in `<adoszam>`.
   */
  euTaxNumber?: string;
  /**
   * A fizetési határidő napokban a neki kiállított számlán; `null`: az
   * alapérték (8 nap). Szervizpartnernél a Partnerek oldalon állítják.
   */
  paymentDueDays: number | null;
  /**
   * HA EZEN A SORON NINCS FIZETÉSI NAP, de ugyanez a cég (azonos adószám vagy
   * név) a Partnerek oldalon napot visel: azok a napok és a partner neve
   * (kártya 7be4a85b). Ugyanaz a cég több vevő-soron is állhat (a régi vevő
   * és a szervizpartner tükre), és a számlán bármelyik választható. `null`, ha
   * nincs ilyen, vagy több partner más-más napot mondana.
   */
  partnerTerms?: { paymentDueDays: number; partnerName: string } | null;
  /**
   * HA A SORNAK NINCS ADÓSZÁMA, de egy névvel egyező partner a Partnerek oldalon visel
   * egyet: a partner neve és adószáma (kártya aaf4f09d). Csak tipp a számla kapujának
   * okához; `null` vagy hiányzik: nincs ilyen, vagy több partner más-más adószámot mondana.
   */
  partnerTaxHint?: PartnerTaxHint | null;
  marketingEmailConsent: boolean;
  marketingSmsConsent: boolean;
  addresses: CustomerAddress[];
}

/**
 * The customer list's page size bounds, as the API's query validation holds
 * them. A caller that asks for fewer rows than the minimum gets a 400, not a
 * short page: the billing partner picker asked for 8, every search failed on
 * stage, and the picker showed "Nincs találat." (2026-09-30).
 */
export const CUSTOMER_LIST_PAGE_SIZE = { min: 10, max: 100 } as const;

export interface CustomerListResponse {
  items: CustomerSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface CreateCustomerAddressInput {
  type: CustomerAddressType;
  name?: string;
  country?: string;
  postalCode: string;
  city: string;
  line1: string;
  line2?: string;
  isDefault?: boolean;
}

export interface CreateCustomerInput {
  type: CustomerType;
  displayName: string;
  companyName?: string;
  taxNumber?: string;
  euTaxNumber?: string;
  email?: string;
  billingEmail?: string;
  phone?: string;
  /** A fizetési határidő napokban (egész, 0-365); hiányzó: az alapérték (a Partnerek oldalon beállított, ha nincs, 8 nap). */
  paymentDueDays?: number;
  marketingEmailConsent?: boolean;
  marketingSmsConsent?: boolean;
  addresses?: CreateCustomerAddressInput[];
}

/**
 * A cím szerkesztése: `id` nélkül új cím jön létre, `id`-val a vevő SAJÁT meglévő címe módosul (más vevő címét az API
 * elutasítja). Törlés nincs: egy címre eszköz vagy dokumentum hivatkozhat.
 */
export interface UpdateCustomerAddressInput {
  id?: string;
  type: CustomerAddressType;
  name?: string | null;
  country?: string;
  postalCode: string;
  city: string;
  line1: string;
  line2?: string | null;
}

export interface UpdateCustomerInput {
  /** Cég vagy magánszemély. */
  type?: "PERSON" | "COMPANY";
  displayName?: string;
  companyName?: string | null;
  taxNumber?: string | null;
  euTaxNumber?: string | null;
  email?: string | null;
  billingEmail?: string | null;
  phone?: string | null;
  /** A fizetési határidő napokban (egész, 0-365); `null`: törli (az alapérték: a Partnerek oldalon beállított, ha nincs, 8 nap). */
  paymentDueDays?: number | null;
  marketingEmailConsent?: boolean;
  marketingSmsConsent?: boolean;
  /** A megadott címek módosulnak vagy létrejönnek; a többi cím érintetlen marad. */
  addresses?: UpdateCustomerAddressInput[];
  expectedUpdatedAt: string;
}
