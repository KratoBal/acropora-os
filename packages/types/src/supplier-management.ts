export interface SupplierSummary {
  id: string;
  code: string;
  name: string;
  taxNumber?: string;
  /** ISO 3166-1 alpha-2 országkód; "HU"-tól eltérő érték jelöli az EU-n belüli beszállítót. */
  country: string;
  email?: string;
  phone?: string;
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
  taxNumber?: string;
  country?: string;
  email?: string;
  phone?: string;
}
