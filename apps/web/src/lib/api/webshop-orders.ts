import type {
  WebshopOrderDetail,
  WebshopOrderListQuery,
  WebshopOrderListResponse,
  WebshopOrderParcelResult,
  WebshopOrderStatus,
  WebshopOrderStatusChangeResult,
  WebshopOrderLineEdit,
  WebshopVariantOption,
  WebshopStaleThreshold,
  WebshopOrderAddressInput,
  WebshopParcelSize,
  WebshopOrderNotesInput,
  WebshopOrderSplitInput,
  WebshopOrderSplitResult,
  WebshopPickupPointSearch,
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
  /** „Csúszik a szállítás”: a kártyás zárolás feloldása, levél a vevőnek. */
  releaseHold(token: string, id: string, notifyCustomer: boolean) {
    return apiRequest<WebshopOrderStatusChangeResult>(
      `/webshop-orders/${encodeURIComponent(id)}/payment/release-hold`,
      token,
      { method: "POST", body: JSON.stringify({ notifyCustomer }) },
    );
  },
  /** „Fizetési link küldése” a rendelés mostani végösszegére. */
  sendPaymentLink(token: string, id: string, notifyCustomer: boolean) {
    return apiRequest<WebshopOrderStatusChangeResult>(
      `/webshop-orders/${encodeURIComponent(id)}/payment/link`,
      token,
      { method: "POST", body: JSON.stringify({ notifyCustomer }) },
    );
  },
  /** Egy cím szerkesztése (a név a szállítási címen); a válasz a friss adatlap. */
  updateAddress(token: string, id: string, input: WebshopOrderAddressInput) {
    return apiRequest<WebshopOrderDetail>(
      `/webshop-orders/${encodeURIComponent(id)}/address`,
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },
  /** A rendelés módjához választható csomagpontok (commerce #494). */
  pickupPoints(token: string, id: string, query: string) {
    return apiRequest<WebshopPickupPointSearch>(
      `/webshop-orders/${encodeURIComponent(id)}/pickup-points?q=${encodeURIComponent(query)}`,
      token,
    );
  },
  /** A csomagpont cseréje; a válasz a friss adatlap. */
  changePoint(token: string, id: string, pointId: string) {
    return apiRequest<WebshopOrderDetail>(
      `/webshop-orders/${encodeURIComponent(id)}/pickup-point`,
      token,
      { method: "PUT", body: JSON.stringify({ pointId }) },
    );
  },
  /**
   * A kijelölt tételek új, kapcsolt rendelésbe (kártya 0a14f739 C/3). A
   * `requestId` a párbeszédablaké: az újraküldés nem bont kétszer.
   */
  split(token: string, id: string, input: WebshopOrderSplitInput) {
    return apiRequest<WebshopOrderSplitResult>(
      `/webshop-orders/${encodeURIComponent(id)}/split`,
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  /** A vevő és a szállító megjegyzése (a hiányzó mező nem változik, az üres töröl). */
  saveNotes(token: string, id: string, input: WebshopOrderNotesInput) {
    return apiRequest<WebshopOrderDetail>(
      `/webshop-orders/${encodeURIComponent(id)}/notes`,
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },
  /** A belső megjegyzés (üres szöveg törli). */
  saveInternalNote(token: string, id: string, text: string) {
    return apiRequest<WebshopOrderDetail>(
      `/webshop-orders/${encodeURIComponent(id)}/internal-note`,
      token,
      { method: "PUT", body: JSON.stringify({ text }) },
    );
  },
  /** Az elavulási küszöbök (Beállítások). */
  staleThresholds(token: string, signal?: AbortSignal) {
    return apiRequest<WebshopStaleThreshold[]>(
      "/webshop-orders/settings/stale-thresholds",
      token,
      { signal },
    );
  },
  saveStaleThresholds(token: string, thresholds: WebshopStaleThreshold[]) {
    return apiRequest<WebshopStaleThreshold[]>(
      "/webshop-orders/settings/stale-thresholds",
      token,
      { method: "PUT", body: JSON.stringify({ thresholds }) },
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
