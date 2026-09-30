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
  email?: string;
  phone?: string;
  isActive: boolean;
  archivedAt?: string;
  /** Egysoros, formázott alapértelmezett (vagy első) cím, listás megjelenítéshez. */
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDetail extends CustomerSummary {
  taxNumber?: string;
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
  email?: string;
  phone?: string;
  marketingEmailConsent?: boolean;
  marketingSmsConsent?: boolean;
  addresses?: CreateCustomerAddressInput[];
}

export interface UpdateCustomerInput {
  displayName?: string;
  companyName?: string | null;
  taxNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  marketingEmailConsent?: boolean;
  marketingSmsConsent?: boolean;
  expectedUpdatedAt: string;
}
