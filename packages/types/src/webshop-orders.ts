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
/**
 * AZ ELAVULÁSI KÜSZÖB STÁTUSZONKÉNT (a prompt 17. pontja): érték, egység és
 * be/ki kapcsoló. Ezek az alapértékek; a beállított érték az OS-ben él
 * (Beállítások, Rendelések elavulása).
 */
export const WEBSHOP_STALE_STATUSES = [
  "pending_processing",
  "stocking",
  "out_for_delivery",
  "ready_for_pickup",
] as const;
export type WebshopStaleStatus = (typeof WEBSHOP_STALE_STATUSES)[number];
export type WebshopStaleUnit = "HOUR" | "DAY";

export interface WebshopStaleThreshold {
  status: WebshopStaleStatus;
  /** Legalább 1: a figyelés kikapcsolása a kapcsoló dolga, nem a nulláé. */
  value: number;
  unit: WebshopStaleUnit;
  enabled: boolean;
}

export const WEBSHOP_STALE_THRESHOLD_DEFAULTS: readonly WebshopStaleThreshold[] =
  [
    { status: "pending_processing", value: 4, unit: "HOUR", enabled: true },
    { status: "stocking", value: 8, unit: "HOUR", enabled: true },
    { status: "out_for_delivery", value: 3, unit: "DAY", enabled: true },
    { status: "ready_for_pickup", value: 5, unit: "DAY", enabled: true },
  ];

/** A küszöbök órában, csak a bekapcsoltak: ezt nézi az elavultság. */
export function staleHoursOf(
  thresholds: readonly WebshopStaleThreshold[],
): Partial<Record<WebshopOrderStatus, { hours: number }>> {
  return Object.fromEntries(
    thresholds
      .filter((threshold) => threshold.enabled)
      .map((threshold) => [
        threshold.status,
        { hours: threshold.value * (threshold.unit === "DAY" ? 24 : 1) },
      ]),
  );
}

export const WEBSHOP_ORDER_STALE_DEFAULTS = staleHoursOf(
  WEBSHOP_STALE_THRESHOLD_DEFAULTS,
);

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
    /** A GLS-pont fajtája (a webshop mentett pont-adatából); más szállítónál `null`. */
    pointKind: WebshopPointKind | null;
    /** „Bolti átvétel”: a feldolgozási sáv és a „Feladásra vár” ettől függ. */
    storePickup: boolean;
  };
  payment: {
    /** A felületen álló név: „Stripe”, „Utánvét”, vagy „Egyéb (<azonosító>)”. */
    method: string | null;
    state: WebshopOrderPaymentState | null;
    /** A kártyás zárolás lejárata (a webshop számolja); `null`, ha nincs zárolás. */
    holdExpiresAt: string | null;
    /** A zárolás két napon belül lejár, vagy lejárt, és a rendelés még nincs kiszállítva. */
    holdWarning: WebshopHoldWarning;
  };
  /** A kiállított számla száma; az OS saját rekordja (`WEBSHOP_ORDER` forrású bizonylat). */
  invoiceNumber: string | null;
  /** Az aktív csomag száma a szállítónál, ha van (a kereső ezt is nézi). */
  parcelNumber: string | null;
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
  /** A cím mezőnként, a szerkesztő párbeszédhez (a webshop saját alakjából). */
  fields: Omit<WebshopOrderAddressInput, "kind">;
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
  /**
   * A sor státuszlevele a webshopból (commerce #479): a legutóbbi küldés,
   * az újraküldésekkel együtt; `null`, ha nem ment levél (vagy a levélküldés
   * ki van kapcsolva).
   */
  mail: WebshopOrderMailState | null;
}

export interface WebshopOrderMailState {
  status: "sent" | "failed" | "pending";
  at: string;
  /** Hányszor küldték újra (az első küldésen felül). */
  resent: number;
}

/**
 * A státuszlevél sorsa egy váltás vagy újraküldés után (commerce #479). Az okok
 * a webshopéi: `not_requested`, `mail_off`, `no_mail_for_status`, `no_email`,
 * `already_sent`, `shipped_mail_sent`, `failed`.
 */
export type WebshopStatusMailOutcome =
  { sent: true } | { sent: false; reason: string };

export interface WebshopOrderStatusChangeResult {
  order: WebshopOrderDetail;
  mail: WebshopStatusMailOutcome;
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
    /**
     * A vevő korábbi, sikertelenül lezárt rendelései és a másik nyitott
     * rendelése, ahogy a lista is mutatja (a webshop áttekintéséből). `null`:
     * nem olvasható most; vendég és első rendelés esetén 0 és `false`.
     */
    unsuccessfulOrderCount: number | null;
    hasOtherOpenOrder: boolean | null;
  };
  /**
   * A CSOMAGFELADÁS ELŐNÉZETE, ugyanabból, amiből a feladás dolgozik
   * (`parcelInputOf`): a gomb előtt kiderül, ha valami hiányzik, és látszik az
   * utánvét. `null`: bolti átvétel, nincs csomag.
   */
  dispatchPreview: {
    ready: boolean;
    reason: string | null;
    codHuf: number | null;
  } | null;
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
      /** A GLS-pont fajtája; Foxpostnál `null`. */
      kind: WebshopPointKind | null;
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
  /**
   * A rendelés szállítólevele (kártya 0a14f739 C/1): a kiállított számla
   * tételeiből, a Számlázz.hu-n át. Amíg nem készült, `null`.
   */
  deliveryNote: {
    id: string;
    status: "DRAFT" | "ISSUING" | "ISSUED" | "ISSUE_FAILED";
    number: string | null;
  } | null;
  /** A vevő OS-partnere, ha a számlázás már bekötötte (Medusa-kötés); különben `null`. */
  osCustomer: {
    id: string;
    customerNumber: string;
    displayName: string;
  } | null;
  /** A belső megjegyzés: csak az OS-é, a vevő nem látja. */
  internalNote: { text: string; updatedAt: string } | null;
  /**
   * A vevő megjegyzése és a szállítónak szóló üzenet (commerce #493: a pénztár
   * kéri be, a rendelés metaadatán áll). `null`: nincs.
   */
  notes: { customer: string | null; carrier: string | null };
  /** Szerkeszthető-e most a két megjegyzés, és ha nem, miért. */
  notesEdit: {
    customer: { allowed: boolean; reason: string | null };
    carrier: { allowed: boolean; reason: string | null };
  };
  /** Cserélhető-e most a csomagpont (commerce #494), és ha nem, miért. */
  pointEdit: { allowed: boolean; reason: string | null };
  /** Szerkeszthető-e most a számlázási, illetve a szállítási cím, és ha nem, miért. */
  addressEdit: {
    billing: { allowed: boolean; reason: string | null };
    shipping: { allowed: boolean; reason: string | null };
  };
  /** A kártyás fizetés útja (zárolás, feloldás, fizetési link); más fizetésnél `null`. */
  cardPayment: WebshopOrderCardPayment | null;
  /** A rendelés aktív csomagja az OS-ben (Rendelések, 5. PR), ha van. */
  parcel: WebshopOrderParcel | null;
  /**
   * Módosíthatók-e most a tételek (mennyiség, csere, törlés), és ha nem,
   * miért (Rendelések, 6. PR).
   */
  lineEdit: { allowed: boolean; reason: string | null };
  steps: WebshopOrderStep[];
  relatedOrder: {
    id: string;
    displayId: number | null;
    role: "pickup" | "parent";
  } | null;
  history: WebshopOrderHistoryEntry[];
}

/** Foxpost csomagméret (a szállító OpenAPI-ja szerint); GLS-nél nincs. */
export const WEBSHOP_PARCEL_SIZES = ["xs", "s", "m", "l", "xl"] as const;
export type WebshopParcelSize = (typeof WEBSHOP_PARCEL_SIZES)[number];

/**
 * A RENDELÉS CSOMAGJA, ahogy az adatlap látja. A `parcelNumber` `null`, amíg a
 * létrehozás fut, vagy ha a kimenete bizonytalan (a szállítónál létrejöhetett):
 * ilyenkor új csomag csak kifejezett feloldás után indítható.
 */
export interface WebshopOrderParcel {
  carrier: "FOXPOST" | "GLS";
  /** A fuvarozói referencia: a rendelésszám. */
  reference: string;
  parcelNumber: string | null;
  /** Alszolgáltatói (`STUB-`) csomag: nem valódi, levél nem megy róla. */
  stub: boolean;
  size: string | null;
  codHuf: number | null;
  createdAt: string;
}

/**
 * A „Feladtuk a csomagodat” levél sorsa a csomag létrehozása után. A webshop
 * okai mellé az OS kettőt tesz: `stub` (teszt-csomagszámról nem megy levél)
 * és `failed` (a webshop nem volt elérhető; a csomag ettől még létrejött).
 */
export type WebshopShippingNoticeOutcome =
  | { sent: true }
  | {
      sent: false;
      reason:
        "mail_off" | "no_email" | "already_sent" | "stub" | "failed" | string;
    };

export interface WebshopOrderParcelResult {
  order: WebshopOrderDetail;
  notice: WebshopShippingNoticeOutcome;
}

export interface WebshopOrderParcelCreate {
  /** Csak Foxpostnál; ha nincs, a szállító alapértéke. */
  size?: WebshopParcelSize;
}

/** Egy tételművelet (Rendelések, 6. PR). */
export type WebshopOrderLineEdit =
  | { kind: "quantity"; quantity: number }
  | { kind: "remove" }
  | { kind: "replace"; variantId: string; quantity: number };

/** Egy termékváltozat a cseréhez. */
export interface WebshopVariantOption {
  variantId: string;
  title: string;
  sku: string | null;
}

/**
 * A KÁRTYÁS FIZETÉS ÚTJA (lejáró zárolás, Balázs 2026-10-05; commerce
 * `GET /admin/order-payment`). A zárolás 7 nap után lejár; ha a szállítás
 * csúszik, a zárolást feloldjuk, és áruérkezéskor fizetési linket küldünk.
 */
export const WEBSHOP_CARD_PAYMENT_STATES = [
  "hold",
  "awaiting_payment",
  "link_sent",
  "reminded",
  "paid",
  "expired",
] as const;
export type WebshopCardPaymentState =
  (typeof WEBSHOP_CARD_PAYMENT_STATES)[number];

export const WEBSHOP_CARD_PAYMENT_STATE_LABELS: Record<
  WebshopCardPaymentState,
  string
> = {
  hold: "Zárolva",
  awaiting_payment: "Fizetésre vár",
  link_sent: "Fizetési link elküldve",
  reminded: "Emlékeztető elküldve",
  paid: "Linken fizetve",
  expired: "A fizetési link lejárt",
};

/** A zárolás lejáratának jelzése: két napon belül (`soon`) vagy már lejárt (`expired`). */
export type WebshopHoldWarning = "soon" | "expired" | null;

export interface WebshopOrderCardPayment {
  state: WebshopCardPaymentState;
  holdExpiresAt: string | null;
  holdWarning: WebshopHoldWarning;
  link: {
    sentAt: string;
    expiresAt: string;
    remindedAt: string | null;
    amount: number;
    url: string;
  } | null;
  paidAt: string | null;
  /**
   * Amit a fizetési link most fizettetne: a feloldott zárolás helyett a
   * végösszeg, vagy egy utólag hozzáadott tétel különbözete (Balázs „Mehet”,
   * 2026-10-05 18:01 UTC; a zárolás ilyenkor megmarad).
   */
  due: { amount: number; reason: "released" | "difference" } | null;
  /** „Csúszik a szállítás”: a zárolás feloldása, levél a vevőnek. */
  canRelease: boolean;
  /** „Fizetési link küldése” (újraküldés is: ugyanarra az összegre ugyanaz a link). */
  canSendLink: boolean;
}

/** Egy cím szerkesztése az adatlapról (a webshop beépített rendelés-frissítésén át). */
export interface WebshopOrderAddressInput {
  kind: "billing" | "shipping";
  lastName: string;
  firstName: string;
  company: string | null;
  /** Csak a számlázási címen: a cég adószáma (a webshop `metadata.tax_id`). */
  taxNumber: string | null;
  postalCode: string;
  city: string;
  line1: string;
  line2: string | null;
  phone: string | null;
  countryCode: string;
}

/**
 * A GLS-PONT FAJTÁJA (a webshop `gls_pickup_point.type`, a GLS saját értékei;
 * murena 26523): `parcel-shop` = ParcelShop (csomagpont), `parcel-locker` =
 * automata.
 */
export type WebshopPointKind = "parcel-shop" | "parcel-locker";

export const pointKindOf = (value: unknown): WebshopPointKind | null =>
  value === "parcel-shop" || value === "parcel-locker" ? value : null;

/**
 * A GLS SZÁLLÍTÁS NEVE a listán és az adatlapon (a GLS prompt 11. pontja):
 * GLS ParcelShop, GLS automata, GLS házhoz. Más szállítónál `null`.
 */
export function glsDeliveryLabel(input: {
  method: string | null;
  pointKind: WebshopPointKind | null;
  hasPoint: boolean;
  storePickup: boolean;
}): string | null {
  if (input.pointKind === "parcel-shop") return "GLS ParcelShop";
  if (input.pointKind === "parcel-locker") return "GLS automata";
  if (!input.storePickup && !input.hasPoint && /^gls/i.test(input.method ?? ""))
    return "GLS házhoz";
  return null;
}

/** A szállítónak szóló üzenet felső határa: a Foxpost mezője (commerce #493). */
export const WEBSHOP_CARRIER_NOTE_MAX = 50;
/** A vevő megjegyzésének felső határa (commerce #493). */
export const WEBSHOP_CUSTOMER_NOTE_MAX = 1000;

/** Egy választható csomagpont a cseréhez (commerce #494, a pénztár listája). */
export interface WebshopPickupPointOption {
  id: string;
  name: string;
  /** „1033 Budapest, Szentendrei út 115.” */
  address: string;
  /** GLS-nél csomagpont vagy automata; Foxpostnál `null`. */
  kind: WebshopPointKind | null;
  /** Foxpostnál a pont típusa a saját szavával („FOXPOST A-BOX”); GLS-nél `null`. */
  variant: string | null;
  /** Üzemen kívüli GLS-automata: nem választható. */
  outOfOrder: boolean;
}

export interface WebshopPickupPointSearch {
  carrier: "FOXPOST" | "GLS";
  currentPointId: string | null;
  points: WebshopPickupPointOption[];
  /** Az összes találat, nem csak a lap. */
  count: number;
}

export interface WebshopOrderNotesInput {
  /** Hiányzó mező: nem változik; üres szöveg: törlődik. */
  customerNote?: string;
  carrierNote?: string;
}
