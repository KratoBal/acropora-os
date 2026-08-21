export interface SupplierSummary {
  id: string;
  code: string;
  name: string;
  /** We order from this partner, and purchase invoices belong to it. */
  isSupplier: boolean;
  /** We write worksheets and quotes for this partner. Independent of the flag
   * above: one company can be both, and the Partners menu holds both kinds. */
  isService: boolean;
  taxNumber?: string;
  /** ISO 3166-1 alpha-2 országkód; "HU"-tól eltérő érték jelöli az EU-n belüli beszállítót. */
  country: string;
  email?: string;
  phone?: string;
  /** EU-s (nem "HU") beszállítónál a nemzetközi bankszámlaszám. */
  iban?: string;
  /** EU-s (nem "HU") beszállítónál a bank SWIFT/BIC kódja. */
  swiftCode?: string;
  /** Belföldi ("HU") beszállítónál a hazai formátumú bankszámlaszám. */
  bankAccountNumber?: string;
  contactPersonName?: string;
  contactPersonPhone?: string;
  contactPersonEmail?: string;
  postalCode?: string;
  city?: string;
  addressLine1?: string;
  addressLine2?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierListResponse {
  items: SupplierSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface CreateSupplierInput {
  name: string;
  /** Both default the way the database does (supplier yes, service no) when
   * omitted, so a caller that predates partner kinds -- the purchase invoice
   * screen -- keeps creating suppliers without knowing about them. */
  isSupplier?: boolean;
  isService?: boolean;
  taxNumber?: string;
  country?: string;
  email?: string;
  phone?: string;
  iban?: string;
  swiftCode?: string;
  bankAccountNumber?: string;
  contactPersonName?: string;
  contactPersonPhone?: string;
  contactPersonEmail?: string;
  postalCode?: string;
  city?: string;
  addressLine1?: string;
  addressLine2?: string;
}

export interface UpdateSupplierInput {
  name?: string;
  isSupplier?: boolean;
  isService?: boolean;
  taxNumber?: string | null;
  country?: string;
  email?: string | null;
  phone?: string | null;
  iban?: string | null;
  swiftCode?: string | null;
  bankAccountNumber?: string | null;
  contactPersonName?: string | null;
  contactPersonPhone?: string | null;
  contactPersonEmail?: string | null;
  postalCode?: string | null;
  city?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  expectedUpdatedAt: string;
}
