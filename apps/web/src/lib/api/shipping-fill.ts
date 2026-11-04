import { apiRequest } from "./client";

/** A négy UNAS-jelző (a82ed229). */
export type ShippingFillFlag =
  "pickupOnly" | "foxpostForbidden" | "isHeavy" | "isFrozen";

export interface ShippingFillPreview {
  /** a cél-adatbázis, jelszó nélkül */
  target: string;
  report: {
    products: number;
    create: number;
    update: number;
    unchanged: number;
    updatedFlags: Record<ShippingFillFlag, number>;
    manualDiffers: { productId: string; flag: ShippingFillFlag }[];
    manualDiffersTotal: number;
  };
  fingerprint: string;
}

export interface ShippingFillApplyResult {
  target: string;
  created: number;
  updated: number;
}

/** A szállítási jelzők egyszeri feltöltése: a próba csak olvas, az írás a próba lenyomatával megy. */
export const shippingFillApi = {
  preview(token: string) {
    return apiRequest<ShippingFillPreview>(
      "/products/shipping-profile-fill/preview",
      token,
      { method: "POST" },
    );
  },
  apply(token: string, fingerprint: string) {
    return apiRequest<ShippingFillApplyResult>(
      "/products/shipping-profile-fill/apply",
      token,
      { method: "POST", body: JSON.stringify({ fingerprint }) },
    );
  },
};
