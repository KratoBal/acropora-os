import type {
  WebshopOrderDetail,
  WebshopOrderListQuery,
  WebshopOrderListResponse,
  WebshopOrderParcelResult,
  WebshopOrderStatus,
  WebshopOrderStatusChangeResult,
  WebshopOrderLineEdit,
  WebshopVariantOption,
  WebshopParcelSize,
} from "@acropora/types";
import { API_PREFIX } from "./api-prefix";
import { pdfBlob } from "./billing-documents";
import { apiAuthHeaders, apiRequest } from "./client";

/** Az oldal URL-jének ismert mezői; minden más kimarad a kérésből. */
export const WEBSHOP_ORDER_QUERY_KEYS = [
  "view",
  "stage",
  "q",
  "from",
  "to",
  "status",
  "shippingMethod",
  "paymentMethod",
  "paymentState",
  "invoice",
  "customerType",
  "newCustomer",
  "sort",
  "direction",
  "page",
] as const satisfies readonly (keyof WebshopOrderListQuery)[];

/** Webshop / Rendelések: az új (Medusa) webshop rendelései. */
export const webshopOrdersApi = {
  list(token: string, params: URLSearchParams, signal?: AbortSignal) {
    const query = new URLSearchParams();
    for (const key of WEBSHOP_ORDER_QUERY_KEYS) {
      const value = params.get(key);
      if (value) query.set(key, value);
    }
    return apiRequest<WebshopOrderListResponse>(
      `/webshop-orders?${query.toString()}`,
      token,
      { signal },
    );
  },
  /**
   * Státuszváltás a webshopban, a „Vevő értesítése” jelölővel; a válasz a
   * friss adatlap és a státuszlevél sorsa.
   */
  changeStatus(
    token: string,
    id: string,
    status: WebshopOrderStatus,
    notifyCustomer = true,
  ) {
    return apiRequest<WebshopOrderStatusChangeResult>(
      `/webshop-orders/${encodeURIComponent(id)}/status`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ status, notifyCustomer }),
      },
    );
  },
  /** Tételművelet (mennyiség, csere, törlés); a válasz a friss adatlap. */
  editLine(
    token: string,
    id: string,
    itemId: string,
    edit: WebshopOrderLineEdit,
  ) {
    return apiRequest<WebshopOrderDetail>(
      `/webshop-orders/${encodeURIComponent(id)}/lines/${encodeURIComponent(itemId)}`,
      token,
      { method: "POST", body: JSON.stringify(edit) },
    );
  },
  /** Termékváltozatok a cseréhez. */
  replacementVariants(token: string, id: string, query: string) {
    return apiRequest<WebshopVariantOption[]>(
      `/webshop-orders/${encodeURIComponent(id)}/replacement-variants?${new URLSearchParams({ q: query })}`,
      token,
    );
  },
  /** A legutóbbi státuszlevél újraküldése. */
  resendStatusMail(token: string, id: string) {
    return apiRequest<WebshopOrderStatusChangeResult>(
      `/webshop-orders/${encodeURIComponent(id)}/status-mail/resend`,
      token,
      { method: "POST" },
    );
  },
  /**
   * A rendelés számlája: vázlat a rendelésből és kiállítás (a teszt-szerveren
   * az álszámlázóval). A válasz a friss adatlap; a kiállított számlára a
   * második hívás nem állít ki újat.
   */
  issueInvoice(token: string, id: string) {
    return apiRequest<WebshopOrderDetail>(
      `/webshop-orders/${encodeURIComponent(id)}/invoice`,
      token,
      { method: "POST" },
    );
  },
  /** Csomagfeladás a szállítónál; a válasz a friss adatlap és a „Feladtuk” levél sorsa. */
  createParcel(token: string, id: string, size?: WebshopParcelSize) {
    return apiRequest<WebshopOrderParcelResult>(
      `/webshop-orders/${encodeURIComponent(id)}/parcel`,
      token,
      { method: "POST", body: JSON.stringify(size ? { size } : {}) },
    );
  },
  /** A meglévő csomag címkéje (újranyomtatás is: új csomagot sosem hoz létre). */
  async parcelLabel(token: string, id: string): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}/webshop-orders/${encodeURIComponent(id)}/parcel/label`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return pdfBlob(response, "A címke nem tölthető le.");
  },
  /** A bizonytalan csomag-foglalás feloldása (a szállító felületén ellenőrzés után). */
  releaseParcel(token: string, id: string) {
    return apiRequest<WebshopOrderDetail>(
      `/webshop-orders/${encodeURIComponent(id)}/parcel/release`,
      token,
      { method: "POST" },
    );
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<WebshopOrderDetail>(
      `/webshop-orders/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
};
