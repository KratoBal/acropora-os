import type {
  SupplierPriceListFormat,
  SupplierPriceListUploadResult,
  SupplierPriceListsResponse,
  VariantSupplierPrices,
} from "@acropora/types";

import { apiRequest } from "./client";

/** A beszállítói árlisták: a listák, a feltöltés (fájl + űrlap), a törlés. */
const base = "/purchasing/price-lists";

function listQueryString(supplierId: string): string {
  const params = new URLSearchParams();
  if (supplierId) params.set("supplierId", supplierId);
  return params.toString();
}

export interface PriceListUploadInput {
  supplierId: string;
  format: SupplierPriceListFormat;
  listDate: string;
  currency: string;
  file: File;
}

export const priceListsApi = {
  list(token: string, supplierId: string, signal?: AbortSignal) {
    return apiRequest<SupplierPriceListsResponse>(
      `${base}?${listQueryString(supplierId)}`,
      token,
      { signal },
    );
  },
  upload(token: string, input: PriceListUploadInput) {
    const body = new FormData();
    body.append("supplierId", input.supplierId);
    body.append("format", input.format);
    body.append("listDate", input.listDate);
    body.append("currency", input.currency);
    body.append("file", input.file);
    return apiRequest<SupplierPriceListUploadResult>(base, token, {
      method: "POST",
      body,
    });
  },
  variantPrices(token: string, variantId: string, signal?: AbortSignal) {
    return apiRequest<VariantSupplierPrices>(
      `${base}/variants/${encodeURIComponent(variantId)}`,
      token,
      { signal },
    );
  },
  remove(token: string, id: string) {
    return apiRequest<{ removedRows: number }>(
      `${base}/${encodeURIComponent(id)}`,
      token,
      { method: "DELETE" },
    );
  },
};
