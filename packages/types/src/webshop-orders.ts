/**
 * WEBSHOP / RENDELÉSEK: az új (Medusa) webshop rendelései az OS-ben (Balázs,
 * 2026-10-05; terv: `agents/nautilus/megosztas/rendelesek-felmeres.md`).
 *
 * A rendelés, a fizetés és a hét üzleti státusz gazdája a webshop: az OS
 * olvassa (`GET /admin/order-overview`, acropora-commerce #472) és műveletet
 * hív rajta. Ez NEM a „UNAS Megrendelések” oldal adata.
 */

/** A hét üzleti státusz, a webshop kódjával (commerce `order-business-status/types.ts`). */
export const WEBSHOP_ORDER_STATUSES = [
  "pending_processing",
  "confirmed",
  "stocking",
  "out_for_delivery",
  "ready_for_pickup",
  "closed",
  "closed_unsuccessfully",
] as const;
export type WebshopOrderStatus = (typeof WEBSHOP_ORDER_STATUSES)[number];

export const WEBSHOP_ORDER_STATUS_LABELS: Record<WebshopOrderStatus, string> = {
  pending_processing: "Feldolgozásra vár",
  confirmed: "Visszaigazolva",
  stocking: "Készletezés alatt",
  out_for_delivery: "Kiszállítás",
  ready_for_pickup: "Átvehető",
  closed: "Megrendelés lezárva",
  closed_unsuccessfully: "Sikertelenül lezárt rendelés",
};

/** A két végállapot: a „Nyitott” nézet ezeket nem mutatja. */
export const WEBSHOP_ORDER_CLOSED_STATUSES: readonly WebshopOrderStatus[] = [
  "closed",
  "closed_unsuccessfully",
];

/**
 * Az elavulási küszöb alapértéke státuszonként (Balázs elfogadott terve,
 * 2026-09-02; a prompt 17. pontja). A beállítható változat egy későbbi PR;
 * addig ezek az értékek érvényesek.
 */
export const WEBSHOP_ORDER_STALE_DEFAULTS: Partial<
  Record<WebshopOrderStatus, { hours: number }>
> = {
  pending_processing: { hours: 4 },
  stocking: { hours: 8 },
  out_for_delivery: { hours: 72 },
  ready_for_pickup: { hours: 120 },
};

/** A listafej számlálói: mindegyik egy szűrő is. */
export const WEBSHOP_ORDER_STAGES = [
  "processing",
  "invoice",
  "dispatch",
  "pickup",
  "stale",
] as const;
export type WebshopOrderStage = (typeof WEBSHOP_ORDER_STAGES)[number];

export const WEBSHOP_ORDER_STAGE_LABELS: Record<WebshopOrderStage, string> = {
  processing: "Feldolgozásra vár",
  invoice: "Számlára vár",
  dispatch: "Feladásra vár",
  pickup: "Átvehető",
  stale: "Elavult",
};

export type WebshopOrderPaymentState =
  | "AWAITING"
  | "AUTHORIZED"
  | "CAPTURED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "CANCELED"
  | "FAILED";

export const WEBSHOP_ORDER_PAYMENT_STATE_LABELS: Record<
  WebshopOrderPaymentState,
  string
> = {
  AWAITING: "Fizetésre vár",
  AUTHORIZED: "Zárolva",
  CAPTURED: "Levonva",
  PARTIALLY_REFUNDED: "Részben visszatérítve",
  REFUNDED: "Visszatérítve",
  CANCELED: "Megszakítva",
  FAILED: "Sikertelen",
};

export interface WebshopOrderListItem {
  id: string;
  /** A webshop sorszáma (`display_id`); egyedi rendelésszám még nincs döntve. */
  displayId: number;
  createdAt: string;
  total: number;
  currency: string;
  customer: {
    name: string | null;
    email: string;
    phone: string | null;
    isNew: boolean;
    unsuccessfulOrderCount: number;
    hasOtherOpenOrder: boolean;
    guest: boolean;
  };
  shipping: {
    method: string | null;
    pickupPoint: string | null;
    /** „Bolti átvétel”: a feldolgozási sáv és a „Feladásra vár” ettől függ. */
    storePickup: boolean;
  };
  payment: {
    /** A felületen álló név: „Stripe”, „Utánvét”, vagy „Egyéb (<azonosító>)”. */
    method: string | null;
    state: WebshopOrderPaymentState | null;
  };
  /** A kiállított számla száma; az OS saját rekordja (`WEBSHOP_ORDER` forrású bizonylat). */
  invoiceNumber: string | null;
  status: {
    code: WebshopOrderStatus | null;
    label: string | null;
    changedAt: string | null;
    stale: boolean;
  };
  /** Melyik számlálóba esik (legfeljebb egybe, plusz az elavult külön). */
  stage: Exclude<WebshopOrderStage, "stale"> | null;
  relatedOrder: { id: string; role: "pickup" | "parent" } | null;
}

export type WebshopOrderView = "open" | "all";
export type WebshopOrderSortField =
  "displayId" | "createdAt" | "customer" | "total" | "status";

export interface WebshopOrderListQuery {
  view?: WebshopOrderView;
  stage?: WebshopOrderStage;
  q?: string;
  /** ÉÉÉÉ-HH-NN, a leadás napja, a kettő zárt intervallum. */
  from?: string;
  to?: string;
  status?: WebshopOrderStatus;
  shippingMethod?: string;
  paymentMethod?: string;
  paymentState?: WebshopOrderPaymentState;
  invoice?: "issued" | "missing";
  customerType?: "registered" | "guest";
  newCustomer?: boolean;
  sort?: WebshopOrderSortField;
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface WebshopOrderListResponse {
  items: WebshopOrderListItem[];
  /** A szűrés utáni darabszám (nem a lapé). */
  total: number;
  page: number;
  pageSize: number;
  /** A számlálók a nézet szerint (Nyitott/Összes), a többi szűrőtől függetlenül. */
  counters: Record<WebshopOrderStage, number>;
  /** A szűrők választéka: a ténylegesen előforduló módok. */
  shippingMethods: string[];
  paymentMethods: string[];
  /** Igaz, ha a webshop több rendelést tart, mint amennyit az OS egy körben beolvas. */
  truncated: boolean;
}

/** Egy cím a rendelésen, a felületre összerakva. */
export interface WebshopOrderAddress {
  name: string | null;
  company: string | null;
  /** „1117 Budapest, Fehérvári út 24.” */
  line: string | null;
  countryCode: string | null;
  phone: string | null;
}

export interface WebshopOrderLine {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
}

/** A feldolgozási sáv egy lépése (a prompt 5. pontja). */
export interface WebshopOrderStep {
  key: string;
  label: string;
  detail: string;
  state: "done" | "current" | "blocked" | "todo";
}

export interface WebshopOrderHistoryEntry {
  at: string;
  text: string;
}

export interface WebshopOrderDetail {
  id: string;
  displayId: number;
  createdAt: string;
  currency: string;
  status: WebshopOrderListItem["status"];
  /** A webshop átmenet-táblájából: ide léptetheti a kezelő most. */
  nextStatuses: { status: WebshopOrderStatus; label: string }[];
  customer: {
    name: string | null;
    email: string;
    phone: string | null;
    isNew: boolean;
    guest: boolean;
  };
  billingAddress: WebshopOrderAddress | null;
  shippingAddress: WebshopOrderAddress | null;
  shipping: {
    method: string | null;
    storePickup: boolean;
    carrier: "FOXPOST" | "GLS" | null;
    pickupPoint: {
      id: string | null;
      name: string;
      address: string | null;
    } | null;
  };
  lines: WebshopOrderLine[];
  totals: {
    subtotal: number;
    discount: number;
    shipping: number;
    /** Az utánvét kezelési díja (külön díjsor a webshopban). */
    codFee: number;
    total: number;
  };
  payment: {
    method: string | null;
    state: WebshopOrderPaymentState | null;
    /** A zárolt (engedélyezett) összeg. */
    authorized: number | null;
    /** Amit a Kiszállításkor levonunk: a rendelés mostani végösszege. */
    toCapture: number;
    captured: number;
    refunded: number;
    /** A Stripe PaymentIntent azonosítója (`pi_…`); más szolgáltatónál `null`. */
    stripePaymentIntentId: string | null;
  } | null;
  invoiceNumber: string | null;
  /**
   * A rendelés bizonylata a Számlázásban, ha van: a vázlat, a kiállítás alatti
   * és az elutasított is (az adatlap ebből linkel, és ebből mondja meg, miért
   * nincs még szám).
   */
  invoice: {
    id: string;
    status: "DRAFT" | "ISSUING" | "ISSUED" | "ISSUE_FAILED";
    number: string | null;
  } | null;
  steps: WebshopOrderStep[];
  relatedOrder: {
    id: string;
    displayId: number | null;
    role: "pickup" | "parent";
  } | null;
  history: WebshopOrderHistoryEntry[];
}
