/**
 * THE WEBSHOP'S CUSTOMER MAILS, RENDERED BY THE OS.
 *
 * Balazs's decision, 2026-10-05 20:11 UTC: the OS renders, the webshop sends.
 * The webshop posts the FACTS it already builds for each mail today (commerce
 * `apps/backend/src/workflows/utils/webshop-mail/*`); this file turns them into
 * the template's values and blocks. The variable names are the OS's own, so
 * the webshop never maps them.
 *
 * WHAT IS A VALUE AND WHAT IS A BLOCK. A value is text the editor places in a
 * sentence (`{{rendeles_szam}}`). A block is a styled, conditional piece that
 * only the system can build right (the item list, the "pay on delivery" box,
 * the carrier box with its logo): its inside is not editable, only its place
 * (`mail-blocks.ts`).
 *
 * A CONDITIONAL SENTENCE IS A VALUE THAT MAY BE EMPTY (the mixed cart's line,
 * the pickup order's line). Standing alone in a paragraph, an empty one
 * leaves no paragraph behind (`renderMailTemplateWithBlocks`).
 *
 * The wording is today's commerce wording, measured at commerce `origin/main`
 * 089a1e2, so the defaults say what customers get today.
 */
import type { MailBlock, MailBlocks } from "./mail-blocks.js";
import {
  isWebshopLivestockKind,
  WEBSHOP_ACCLIMATION_TEXTS,
  webshopAcclimationValue,
  type WebshopAcclimationTexts,
  type WebshopLivestockKind,
} from "./webshop-acclimation.js";
import {
  WEBSHOP_ENGLISH_KEY_SUFFIX,
  type MailTemplateValues,
} from "./mail-template.js";

/** BANK_TRANSFER: prepayment by transfer (card bb3a6bd5, commerce #506). */
export type WebshopPaymentRole =
  "ONLINE_CARD" | "COD" | "PAY_AT_STORE" | "BANK_TRANSFER";

export interface WebshopMailLine {
  readonly title: string;
  readonly quantity: number;
  readonly total: number;
}

/** commerce `LoadedOrder`, without what the mail does not show. */
export interface WebshopMailOrder {
  readonly display_id: number | string;
  readonly items: readonly WebshopMailLine[];
  readonly shipping: readonly {
    readonly name: string;
    readonly amount: number;
  }[];
  readonly total: number;
  readonly payment: WebshopPaymentRole | null;
}

/** commerce `MailOrder`: the pickup half of a mixed cart is `pickup: true`. */
export interface WebshopPlacedOrder extends WebshopMailOrder {
  readonly pickup: boolean;
  /**
   * The kinds of live animal among the order's lines (commerce #684, V2.6), for
   * the acclimatisation section (`webshop-acclimation.ts`). OPTIONAL and
   * tolerant: a webshop that does not send it, or sends something else, means
   * no kinds, never a refused mail (`facts_version` stays 1).
   */
  readonly livestock_kinds?: readonly WebshopLivestockKind[];
}

/** commerce `ShippedMailFacts`. */
export interface WebshopShippedFacts {
  readonly display_id: number | string;
  readonly carrier: "foxpost" | "gls";
  readonly destination_title: string;
  readonly destination_address: string;
  readonly gls_point: boolean;
  readonly tracking_number: string;
  readonly tracking_url: string | null;
  readonly items: readonly {
    readonly title: string;
    readonly quantity: number;
  }[];
  readonly cod_amount: number | null;
  readonly foxpost_logo_url: string | null;
  /**
   * The GLS logo for the parcel's kind (point, locker or home), absolute;
   * `null` or missing: no image. commerce G3 (#490), murena 26590.
   */
  readonly gls_logo_url?: string | null;
  /** A GLS point's kind, `parcel-shop` / `parcel-locker`: the logo's alt text. */
  readonly gls_point_type?: string | null;
}

/** commerce `RefundMailFacts`. */
export interface WebshopRefundFacts {
  readonly display_id: number | string;
  readonly amount: number;
  readonly refunded_total: number;
  readonly last4: string | null;
}

export const WEBSHOP_STATUS_TEMPLATES = [
  "order-status-confirmed",
  "order-status-out_for_delivery",
  "order-status-ready_for_pickup",
  "order-status-closed",
] as const;

/**
 * Sent with every template (murena 26552): the customer's name from the
 * billing address, family name first, and the order's creation time. No mail
 * uses them by default; an editor may.
 */
export interface WebshopMailCommonFacts {
  readonly customer_name?: string | null;
  readonly order_created_at?: string | null;
  /**
   * The language the customer ordered in (commerce `storefront_locale`).
   * Missing means Hungarian: every order before the English storefront, and a
   * webshop that does not send it yet. It is optional, and `facts_version`
   * stays 1, so the OS and the webshop can be deployed in either order.
   */
  readonly locale?: WebshopMailLocale;
  /**
   * The address of the storefront's guest order page in the mail's language (commerce `order_view_url`), or null.
   * OPTIONAL and tolerant, like `livestock_kinds`: a webshop that does not send it, or sends something that is not a
   * plain https address, means no link, never a refused mail (`facts_version` stays 1).
   */
  readonly order_view_url?: string | null;
}

export const WEBSHOP_MAIL_LOCALES = ["hu", "en"] as const;
export type WebshopMailLocale = (typeof WEBSHOP_MAIL_LOCALES)[number];

/** The facts of one mail, by the webshop's own template name. */
export type WebshopMailFacts = WebshopMailCommonFacts & WebshopTemplateFacts;

type WebshopTemplateFacts =
  | {
      readonly template: "order-placed";
      readonly orders: readonly WebshopPlacedOrder[];
      /**
       * The version of the legal documents the customer accepted at checkout
       * (commerce `aszf_elfogadas.verzio`), P0 #2: the legal part of the
       * confirmation is that version's (`webshop-legal.ts`). Missing or null:
       * no legal part, as before.
       */
      readonly legal_version?: string | null;
    }
  | {
      readonly template: (typeof WEBSHOP_STATUS_TEMPLATES)[number];
      readonly order: WebshopMailOrder;
    }
  | {
      readonly template: "order-shipped";
      readonly shipped: WebshopShippedFacts;
    }
  | {
      readonly template: "order-payment-delayed";
      readonly order: WebshopMailOrder;
      /** The released hold: both orders of a mixed cart. */
      readonly amount: number;
      readonly pickup_display_id: number | string | null;
    }
  | {
      readonly template: "order-payment-link" | "order-payment-reminder";
      readonly order: WebshopMailOrder;
      readonly url: string;
      readonly expires_at: string;
      /** What the link charges: both orders of a mixed cart. */
      readonly amount: number;
      readonly pickup: WebshopMailOrder | null;
    }
  | {
      readonly template: "payment-refunded";
      readonly refund: WebshopRefundFacts;
    }
  | {
      /**
       * The order split in two (card 0a14f739 C/3; murena 26656): `order` is
       * the first part with its reduced lines and total, `split_order` the
       * part that comes later. `payment` is the ORIGINAL order's way of
       * paying: a card split's later part has no payment yet when this goes.
       */
      readonly template: "order-split";
      readonly order: WebshopMailOrder;
      readonly split_order: WebshopMailOrder;
      readonly payment: WebshopSplitPayment;
    }
  | {
      /**
       * The acknowledgement of a problem report the customer filed (V1.2
       * slice 4; the text is acrobot's, Balázs said yes 2026-11-04): the
       * order's number and the case reference the page gave. No promise of a
       * time or an outcome. Sent only through this renderer: the webshop has
       * no built-in text for it (Balázs, 2026-10-05: no fallback mail).
       */
      readonly template: "problem-report-received";
      readonly display_id: number | string;
      readonly report_id: string;
    }
  | {
      /**
       * The newsletter's confirmation (double opt-in, commerce card
       * d707cf5f): the link that confirms the sign-up (it works once, until
       * `expires_at`), and the link that leaves the list. There is no order
       * behind it: the common `order_created_at` and `order_view_url` are
       * null, `customer_name` is the name typed into the sign-up. The text is
       * a proposal on Balázs's list; the shop sends it only behind its switch.
       */
      readonly template: "newsletter-confirm";
      readonly confirm_url: string;
      readonly unsubscribe_url: string;
      readonly expires_at: string;
    };

/** How a split order is paid, from the original order (murena 26656). */
export type WebshopSplitPayment = "card" | "cod" | "store" | "transfer";
export const WEBSHOP_SPLIT_PAYMENTS: readonly WebshopSplitPayment[] = [
  "card",
  "cod",
  "store",
  "transfer",
];

export type WebshopMailTemplate = WebshopMailFacts["template"];

/**
 * The webshop's template name and the OS template key. The webshop's names
 * are canonical (they are in its notification records); the OS key carries
 * the `WEBSHOP_` prefix next to the service keys.
 */
export const WEBSHOP_MAIL_KEYS = {
  "order-placed": "WEBSHOP_ORDER_PLACED",
  "order-status-confirmed": "WEBSHOP_ORDER_CONFIRMED",
  "order-status-out_for_delivery": "WEBSHOP_ORDER_OUT_FOR_DELIVERY",
  "order-status-ready_for_pickup": "WEBSHOP_ORDER_READY_FOR_PICKUP",
  "order-shipped": "WEBSHOP_ORDER_SHIPPED",
  "order-payment-delayed": "WEBSHOP_SHIPPING_DELAYED",
  "order-payment-link": "WEBSHOP_PAYMENT_LINK",
  "order-payment-reminder": "WEBSHOP_PAYMENT_REMINDER",
  "payment-refunded": "WEBSHOP_REFUND",
  "order-status-closed": "WEBSHOP_ORDER_CLOSED",
  "order-split": "WEBSHOP_ORDER_SPLIT",
  "problem-report-received": "WEBSHOP_PROBLEM_REPORT_RECEIVED",
  "newsletter-confirm": "WEBSHOP_NEWSLETTER_CONFIRM",
} as const satisfies Record<WebshopMailTemplate, string>;

export const SHOP_NAME = "Acropora tengeri akvarisztika";
export const SHOP_CONTACT = "webshop@acropora.hu";

/**
 * Forint, whole, grouped by three with a no-break space: "14 000 Ft". Written
 * out, as in commerce: hu-HU `Intl` leaves four digits ungrouped ("3500").
 */
export function mailForint(amount: number): string {
  const whole = Math.round(amount);
  const digits = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${whole < 0 ? "-" : ""}${digits} Ft`;
}

/** "2026. október 11.", the shop's own calendar day. */
export function hungarianDay(iso: string): string {
  return new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

/**
 * The shop's own calendar day in a language: "2026. október 11." in
 * Hungarian, "11 October 2026" in English (en-GB, the order day first).
 */
export function mailDay(
  iso: string,
  locale: WebshopMailLocale | undefined,
): string {
  if (locale !== "en") return hungarianDay(iso);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only an http(s) address goes into an `href` or `src` the system writes. */
function webAddress(url: string | null, httpsOnly = false): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const allowed = httpsOnly ? ["https:"] : ["http:", "https:"];
    return allowed.includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const H2 = 'style="font-size:16px;margin:20px 0 8px;"';
const UL = 'style="padding-left:18px;margin:0;"';
const ORANGE_LABEL =
  'style="margin:0;color:#d97b2f;font-size:11px;font-weight:bold;letter-spacing:0.08em;"';

/**
 * A titled list: an `<h2>` and its `<ul>`, and the same as text. The text
 * title ends in a colon, as in commerce, except the order confirmation's
 * section titles ("Rendelés #38").
 */
function listBlock(
  sections: readonly {
    title: string;
    lines: readonly string[];
    after?: string | null;
  }[],
  textColon = true,
): MailBlock {
  return {
    html: sections
      .map(
        (s) =>
          `<h2 ${H2}>${escapeHtml(s.title)}</h2>` +
          `<ul ${UL}>${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` +
          (s.after ? `<p>${escapeHtml(s.after)}</p>` : ""),
      )
      .join(""),
    text: sections
      .map((s) =>
        [
          textColon ? `${s.title}:` : s.title,
          ...s.lines.map((l) => `- ${l}`),
          ...(s.after ? [s.after] : []),
        ].join("\n"),
      )
      .join("\n\n"),
  };
}

/** The orange box: "ÁTVÉTELKOR FIZETENDŐ / 14 000 Ft". */
function amountBox(label: string, amount: number): MailBlock {
  return {
    html:
      `<div style="margin-top:16px;border:1px solid #d97b2f;background:#fdf3ea;padding:14px 16px;">` +
      `<p ${ORANGE_LABEL}>${escapeHtml(label)}</p>` +
      `<p style="margin:6px 0 0;font-size:20px;font-weight:bold;">${escapeHtml(mailForint(amount))}</p></div>`,
    text: `${label}: ${mailForint(amount)}`,
  };
}

/**
 * THE WORDS THE CODE BUILDS AROUND THE TEMPLATE'S TEXT, PER LANGUAGE (card
 * d5c6befd, second step). Hungarian is exactly what the code said before; the
 * English wording is the drafted one (acrobot 41435). One dictionary per
 * language, same shape: a missing English word is a compile error, not a
 * Hungarian word in an English mail.
 *
 * The amount box has one label per situation (pickup at the store, delivery,
 * a payment link) because English says "at pickup" and "on delivery"
 * differently, where Hungarian has used one word for the first two
 * (acrobot 41435). The Hungarian labels are unchanged.
 */
export interface WebshopMailText {
  readonly and: string;
  readonly total: string;
  readonly finalTotal: string;
  readonly toPay: string;
  readonly payment: string;
  readonly shipping: string;
  readonly paymentLabel: Record<WebshopPaymentRole, string>;
  readonly paymentSentence: Record<WebshopPaymentRole, string>;
  readonly splitPayment: Record<WebshopSplitPayment, string>;
  readonly dueAtPickupBox: string;
  readonly dueOnDeliveryBox: string;
  readonly dueBox: string;
  readonly yourOrder: string;
  readonly inYourParcel: string;
  readonly yourOrderNumbered: (id: number | string) => string;
  readonly yourPickupOrderNumbered: (id: number | string) => string;
  readonly shippingNow: (id: number | string) => string;
  readonly arrivingLater: (id: number | string) => string;
  readonly orderSection: (id: number | string, pickup: boolean) => string;
  readonly mixedOrders: string;
  readonly mixedOneCardPayment: string;
  readonly nextShipped: string;
  readonly nextPickup: string;
  /** The sentence that carries the guest order page's address (`order_view_url`). */
  readonly orderViewLine: (url: string) => string;
  readonly glsPoint: string;
  readonly glsHome: string;
  readonly glsLogoLocker: string;
  readonly glsLogoPoint: string;
  readonly trackingNumber: string;
  readonly trackParcel: string;
  readonly pickupInPaymentLink: (id: number | string) => string;
  readonly delayedPickupReleased: (id: number | string) => string;
  readonly refundCardLast4: (last4: string) => string;
  readonly refundCardGeneric: string;
  readonly refundedSoFar: (total: string) => string;
}

const HU_TEXT: WebshopMailText = {
  and: "és",
  total: "Összesen",
  finalTotal: "Végösszeg",
  toPay: "Fizetendő",
  payment: "Fizetés",
  shipping: "Szállítás",
  paymentLabel: {
    ONLINE_CARD: "Bankkártya",
    COD: "Utánvét",
    PAY_AT_STORE: "Fizetés a boltban",
    BANK_TRANSFER: "Előre utalás",
  },
  paymentSentence: {
    ONLINE_CARD:
      "A kártyádon most zároltuk az összeget; a terhelés akkor történik, amikor a rendelést teljesítjük.",
    COD: "Az összeget a csomag átvételekor fizeted.",
    PAY_AT_STORE: "Az összeget a boltban, átvételkor fizeted.",
    // bb3a6bd5: the commerce wording (#506), letter for letter
    BANK_TRANSFER:
      "Az összeget előre, banki átutalással fizeted: a díjbekérőt emailben küldjük, 8 napos fizetési határidővel. A rendelést a befizetés beérkezése után teljesítjük.",
  },
  splitPayment: {
    card: "A kártyádról az első részért csak annak az összegét vonjuk le, amikor a csomag elindul. A második részhez, amikor készen áll a szállításra, emailben fizetési linket küldünk.",
    cod: "Mindkét részt a csomag átvételekor fizeted, a saját összegét. Külön utánvét-díjat nem számolunk fel.",
    store: "Mindkét részt a boltban fizeted, átvételkor.",
    transfer:
      "Mindkét részt előre, banki átutalással fizeted, mindegyiket a saját összegével. A második részhez külön díjbekérőt küldünk.",
  },
  dueAtPickupBox: "ÁTVÉTELKOR FIZETENDŐ",
  dueOnDeliveryBox: "ÁTVÉTELKOR FIZETENDŐ",
  dueBox: "FIZETENDŐ",
  yourOrder: "A rendelésed",
  inYourParcel: "A csomagban",
  yourOrderNumbered: (id) => `A rendelésed (#${id})`,
  yourPickupOrderNumbered: (id) => `Bolti átvételes rendelésed (#${id})`,
  shippingNow: (id) => `Most indul (#${id})`,
  arrivingLater: (id) => `Később érkezik (#${id})`,
  orderSection: (id, pickup) =>
    `Rendelés #${id}${pickup ? " (átvétel a boltban)" : ""}`,
  mixedOrders:
    "Az élő állat miatt két rendelés lett belőle: a kiszállítandó tételeké, és a boltban átvehetőké.",
  mixedOneCardPayment:
    "A kártyás fizetés a kettőre együtt, egy lépésben történt.",
  nextShipped:
    "Összekészítjük a rendelésedet. Követési szám csak a csomag feladása után lesz.",
  nextPickup: "Az élő állatos rendelést a boltban veszed át.",
  orderViewLine: (url) =>
    `A rendelésed állapotát bármikor megnézheted a rendelésszámmal és az e-mail-címeddel: ${url}`,
  glsPoint: "GLS csomagpont",
  glsHome: "GLS házhozszállítás",
  glsLogoLocker: "GLS Automata",
  glsLogoPoint: "GLS Csomagpont",
  trackingNumber: "Követési szám",
  trackParcel: "Csomag követése",
  pickupInPaymentLink: (id) =>
    `A fizetés a bolti átvételes #${id} rendelésedet is tartalmazza, egy összegben.`,
  delayedPickupReleased: (id) =>
    `A bolti átvételes #${id} rendelésed ugyanazzal a kártyás fizetéssel készült, ezért a zárolását is feloldottuk. A fizetési link mindkét rendelést fizeti.`,
  refundCardLast4: (last4) => `a ${last4} végű kártyádra`,
  refundCardGeneric: "a kártyádra, amellyel fizettél",
  refundedSoFar: (total) =>
    `Erről a rendelésről eddig összesen ${total} visszatérítés ment.`,
};

const EN_TEXT: WebshopMailText = {
  and: "and",
  total: "Grand total",
  finalTotal: "Total",
  toPay: "To pay",
  payment: "Payment",
  shipping: "Shipping",
  paymentLabel: {
    ONLINE_CARD: "Card payment",
    COD: "Cash on delivery",
    PAY_AT_STORE: "Pay at the store",
    BANK_TRANSFER: "Bank transfer in advance",
  },
  paymentSentence: {
    ONLINE_CARD:
      "We have placed a hold on the amount on your card; the charge is made when we fulfil the order.",
    COD: "You pay the amount when you receive the parcel.",
    PAY_AT_STORE:
      "You pay the amount at the store, when you pick up your order.",
    BANK_TRANSFER:
      "You pay the amount in advance by bank transfer: we will email you the proforma invoice, with a payment deadline of 8 days. We fulfil the order once the payment has arrived.",
  },
  splitPayment: {
    card: "From your card we charge only the amount of the first part, when its parcel starts. For the second part, when it is ready to ship, we will email you a payment link.",
    cod: "You pay each part when you receive its parcel, its own amount. We do not charge a separate cash-on-delivery fee.",
    store: "You pay both parts at the store, when you pick them up.",
    transfer:
      "You pay both parts in advance by bank transfer, each for its own amount. For the second part we will send a separate proforma invoice.",
  },
  dueAtPickupBox: "TO PAY AT PICKUP",
  dueOnDeliveryBox: "TO PAY ON DELIVERY",
  dueBox: "TO PAY",
  yourOrder: "Your order",
  inYourParcel: "In your parcel",
  yourOrderNumbered: (id) => `Your order (#${id})`,
  yourPickupOrderNumbered: (id) => `Your pickup order (#${id})`,
  shippingNow: (id) => `Shipping now (#${id})`,
  arrivingLater: (id) => `Arriving later (#${id})`,
  orderSection: (id, pickup) =>
    `Order #${id}${pickup ? " (pickup at the store)" : ""}`,
  mixedOrders:
    "Because of the live animals, this became two orders: the items to be shipped, and the ones you pick up at the store.",
  mixedOneCardPayment: "The card payment covered both in one step.",
  nextShipped:
    "We are getting your order ready. You will get a tracking number only once the parcel has been shipped.",
  nextPickup: "You pick up the live-animal order at the store.",
  orderViewLine: (url) =>
    `You can check your order at any time with your order number and e-mail address: ${url}`,
  glsPoint: "GLS parcel point",
  glsHome: "GLS home delivery",
  glsLogoLocker: "GLS Parcel Locker",
  glsLogoPoint: "GLS Parcel Point",
  trackingNumber: "Tracking number",
  trackParcel: "Track your parcel",
  pickupInPaymentLink: (id) =>
    `The payment also covers your pickup order #${id}, in one amount.`,
  delayedPickupReleased: (id) =>
    `Your pickup order #${id} was placed with the same card payment, so we have released its hold too. The payment link pays for both orders.`,
  refundCardLast4: (last4) => `to your card ending in ${last4}`,
  refundCardGeneric: "to the card you paid with",
  refundedSoFar: (total) =>
    `So far we have refunded ${total} in total for this order.`,
};

const MAIL_TEXT: Record<WebshopMailLocale, WebshopMailText> = {
  hu: HU_TEXT,
  en: EN_TEXT,
};

/** The words of a language; a missing language is Hungarian. */
export const webshopMailText = (
  locale: WebshopMailLocale | undefined,
): WebshopMailText => MAIL_TEXT[locale ?? "hu"];

const priced = (order: WebshopMailOrder, t: WebshopMailText) => [
  ...order.items.map(
    (i) => `${i.title} × ${i.quantity}: ${mailForint(i.total)}`,
  ),
  ...order.shipping.map(
    (m) => `${t.shipping}: ${m.name}, ${mailForint(m.amount)}`,
  ),
];

const paymentSentence = (
  role: WebshopPaymentRole | null,
  t: WebshopMailText,
): string | null => (role === null ? null : t.paymentSentence[role]);

const ordersLabel = (
  id: number | string,
  other: number | string | null,
  t: WebshopMailText,
) => (other === null ? `#${id}` : `#${id} ${t.and} #${other}`);

export interface WebshopMailContent {
  readonly values: MailTemplateValues;
  readonly blocks: MailBlocks;
}

/**
 * The values and blocks of one mail, from its facts. Every template's set is
 * fixed: a name listed for a template here is one its event offers
 * (`MAIL_TEMPLATE_EVENTS`), which a test holds together.
 */
export function webshopMailContent(
  facts: WebshopMailFacts,
  /** The acclimatisation guides; the shipped table unless a test brings its own. */
  acclimationTexts: WebshopAcclimationTexts = WEBSHOP_ACCLIMATION_TEXTS,
): WebshopMailContent {
  const t = webshopMailText(facts.locale);
  const own = templateContent(facts, t, facts.locale, acclimationTexts);
  return {
    values: {
      ...own.values,
      ugyfel_neve: facts.customer_name ?? "",
      rendeles_datum: facts.order_created_at
        ? mailDay(facts.order_created_at, facts.locale)
        : "",
      // empty (and no paragraph in the default mail) without a usable address
      rendeles_megtekintes_mondat: (() => {
        const url = safeOrderViewUrl(facts.order_view_url);
        return url ? t.orderViewLine(url) : "";
      })(),
    },
    blocks: own.blocks,
  };
}

function templateContent(
  facts: WebshopTemplateFacts,
  t: WebshopMailText,
  locale: WebshopMailLocale | undefined,
  acclimationTexts: WebshopAcclimationTexts,
): WebshopMailContent {
  switch (facts.template) {
    case "order-placed": {
      const orders = facts.orders;
      const first = orders[0];
      if (!first)
        throw new Error("An order confirmation needs at least one order");
      const mixed = orders.length > 1;
      const mixedLine = mixed
        ? [
            t.mixedOrders,
            ...(orders.every((o) => o.payment === "ONLINE_CARD")
              ? [t.mixedOneCardPayment]
              : []),
          ].join(" ")
        : "";
      const sections = orders.map((o) => ({
        title: t.orderSection(o.display_id, o.pickup),
        lines: [
          ...priced(o, t),
          `${t.toPay}: ${mailForint(o.total)}`,
          ...(o.payment ? [`${t.payment}: ${t.paymentLabel[o.payment]}`] : []),
        ],
        after: paymentSentence(o.payment, t),
      }));
      const items = listBlock(sections, false);
      const total = orders.reduce((sum, o) => sum + o.total, 0);
      const next = [
        ...(orders.some((o) => !o.pickup) ? [t.nextShipped] : []),
        ...(orders.some((o) => o.pickup) ? [t.nextPickup] : []),
      ].join("\n");
      return {
        values: {
          rendeles_szam: String(first.display_id),
          rendeles_szamok: orders
            .map((o) => `#${o.display_id}`)
            .join(` ${t.and} `),
          vegyes_kosar_mondat: mixedLine,
          osszesen: mailForint(total),
          kovetkezo_lepes: next,
          akklimatizacio: webshopAcclimationValue(
            orders.flatMap((o) => o.livestock_kinds ?? []),
            locale === "en" ? "en" : "hu",
            acclimationTexts,
          ),
        },
        blocks: {
          rendeles_tetelek: mixed
            ? {
                html: `${items.html}<p>${escapeHtml(`${t.total}: ${mailForint(total)}`)}</p>`,
                text: `${items.text}\n\n${t.total}: ${mailForint(total)}`,
              }
            : items,
        },
      };
    }

    case "order-status-confirmed":
    case "order-status-out_for_delivery":
    case "order-status-ready_for_pickup":
    case "order-status-closed": {
      const o = facts.order;
      const method = o.shipping.map((m) => m.name).filter(Boolean)[0] ?? "";
      const dueOnDelivery =
        facts.template === "order-status-out_for_delivery" &&
        o.payment === "COD";
      const dueAtPickup =
        facts.template === "order-status-ready_for_pickup" &&
        o.payment === "PAY_AT_STORE";
      const due = dueOnDelivery || dueAtPickup ? o.total : null;
      return {
        values: {
          rendeles_szam: String(o.display_id),
          szallitasi_mod: method,
          osszesen: mailForint(o.total),
        },
        blocks: {
          fizetendo_doboz:
            due === null
              ? null
              : amountBox(
                  dueAtPickup ? t.dueAtPickupBox : t.dueOnDeliveryBox,
                  due,
                ),
          rendeles_tetelek: listBlock([
            {
              title: t.yourOrder,
              lines: [
                ...priced(o, t),
                `${t.finalTotal}: ${mailForint(o.total)}`,
                ...(o.payment
                  ? [`${t.payment}: ${t.paymentLabel[o.payment]}`]
                  : []),
              ],
            },
          ]),
        },
      };
    }

    case "order-shipped": {
      const s = facts.shipped;
      const carrier =
        s.carrier === "foxpost"
          ? "FOXPOST – Packeta Group"
          : s.gls_point
            ? t.glsPoint
            : t.glsHome;
      const destination = [s.destination_title, s.destination_address]
        .filter((part) => part && part !== carrier)
        .join(" · ");
      const tracking = webAddress(s.tracking_url);
      /*
        THE CARRIER'S LOGO, as the webshop's own mail draws it (commerce G3,
        #490): FOXPOST's at 140, GLS's per parcel kind, 140 at a point and 64
        at home. Only an https address becomes an image (the system writes it
        after the sanitizer has run).
      */
      const logoUrl = webAddress(
        s.carrier === "foxpost" ? s.foxpost_logo_url : (s.gls_logo_url ?? null),
        true,
      );
      const logoAlt =
        s.carrier === "foxpost"
          ? "FOXPOST – Packeta Group"
          : !s.gls_point
            ? "GLS"
            : s.gls_point_type === "parcel-locker"
              ? t.glsLogoLocker
              : t.glsLogoPoint;
      const logoWidth = s.carrier === "gls" && !s.gls_point ? 64 : 140;
      const box: MailBlock = {
        html:
          `<div style="border:1px solid #e5e7eb;background:#f4f3ef;padding:16px;">` +
          (logoUrl
            ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(logoAlt)}" width="${logoWidth}" style="display:block;margin-bottom:8px;" />`
            : "") +
          `<p style="margin:0;font-weight:bold;">${escapeHtml(carrier)}</p>` +
          (destination
            ? `<p style="margin:8px 0 0;color:#6b7280;font-size:13px;">${escapeHtml(destination)}</p>`
            : "") +
          `<p style="margin:12px 0 0;color:#6b7280;font-size:11px;">${escapeHtml(t.trackingNumber)}</p>` +
          `<p style="margin:2px 0 0;font-size:18px;font-weight:bold;">${escapeHtml(s.tracking_number)}</p>` +
          (tracking
            ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(tracking)}" style="display:block;background:#0f1720;color:#ffffff;text-align:center;padding:12px 16px;text-decoration:none;font-weight:bold;">${escapeHtml(t.trackParcel)}</a></p>`
            : "") +
          `</div>`,
        text: [
          carrier,
          destination,
          `${t.trackingNumber}: ${s.tracking_number}`,
          ...(tracking ? [`${t.trackParcel}: ${tracking}`] : []),
        ]
          .filter(Boolean)
          .join("\n"),
      };
      return {
        values: {
          rendeles_szam: String(s.display_id),
          szallito: carrier,
          tracking_szam: s.tracking_number,
          tracking_link: tracking ?? "",
        },
        blocks: {
          szallitas_doboz: box,
          fizetendo_doboz:
            s.cod_amount === null
              ? null
              : amountBox(t.dueOnDeliveryBox, s.cod_amount),
          csomag_tartalma: listBlock([
            {
              title: t.inYourParcel,
              lines: s.items.map((i) => `${i.title} × ${i.quantity}`),
            },
          ]),
        },
      };
    }

    case "order-payment-delayed": {
      const o = facts.order;
      return {
        values: {
          rendeles_szam: String(o.display_id),
          rendeles_szamok: ordersLabel(
            o.display_id,
            facts.pickup_display_id,
            t,
          ),
          zarolt_osszeg: mailForint(facts.amount),
          bolti_rendeles_mondat:
            facts.pickup_display_id === null
              ? ""
              : t.delayedPickupReleased(facts.pickup_display_id),
        },
        blocks: {
          rendeles_tetelek: listBlock([
            {
              title: t.yourOrderNumbered(o.display_id),
              lines: [
                ...priced(o, t),
                `${t.finalTotal}: ${mailForint(o.total)}`,
              ],
            },
          ]),
        },
      };
    }

    case "order-payment-link":
    case "order-payment-reminder": {
      const o = facts.order;
      const p = facts.pickup;
      return {
        values: {
          rendeles_szam: String(o.display_id),
          rendeles_szamok: ordersLabel(
            o.display_id,
            p ? p.display_id : null,
            t,
          ),
          fizetesi_link: webAddress(facts.url) ?? "",
          fizetendo: mailForint(facts.amount),
          link_lejarat: mailDay(facts.expires_at, locale),
          bolti_rendeles_mondat: p ? t.pickupInPaymentLink(p.display_id) : "",
        },
        blocks: {
          fizetendo_doboz: amountBox(t.dueBox, facts.amount),
          rendeles_tetelek: listBlock([
            {
              title: t.yourOrderNumbered(o.display_id),
              lines: [
                ...priced(o, t),
                `${t.finalTotal}: ${mailForint(o.total)}`,
              ],
            },
            ...(p
              ? [
                  {
                    title: t.yourPickupOrderNumbered(p.display_id),
                    lines: [
                      ...priced(p, t),
                      `${t.finalTotal}: ${mailForint(p.total)}`,
                    ],
                  },
                ]
              : []),
          ]),
        },
      };
    }

    case "order-split": {
      const a = facts.order;
      const b = facts.split_order;
      return {
        values: {
          rendeles_szam: String(a.display_id),
          rendeles_szamok: ordersLabel(a.display_id, b.display_id, t),
          masodik_resz_szam: `#${b.display_id}`,
          reszek_fizetese_mondat: t.splitPayment[facts.payment],
        },
        blocks: {
          rendeles_tetelek: listBlock([
            {
              title: t.shippingNow(a.display_id),
              lines: [
                ...priced(a, t),
                `${t.finalTotal}: ${mailForint(a.total)}`,
              ],
            },
            {
              title: t.arrivingLater(b.display_id),
              lines: [
                ...priced(b, t),
                `${t.finalTotal}: ${mailForint(b.total)}`,
              ],
            },
          ]),
        },
      };
    }

    case "problem-report-received":
      return {
        values: {
          rendeles_szam: String(facts.display_id),
          ugy_azonosito: facts.report_id,
        },
        blocks: {},
      };

    case "newsletter-confirm":
      return {
        values: {
          hirlevel_megerosito_link: facts.confirm_url,
          hirlevel_leiratkozo_link: facts.unsubscribe_url,
          megerosites_lejarat: mailDay(facts.expires_at, locale),
        },
        blocks: {},
      };

    case "payment-refunded": {
      const r = facts.refund;
      return {
        values: {
          rendeles_szam: String(r.display_id),
          visszaterites_osszege: mailForint(r.amount),
          kartya_megnevezes: r.last4
            ? t.refundCardLast4(r.last4)
            : t.refundCardGeneric,
          eddigi_visszaterites_mondat:
            r.refunded_total > r.amount
              ? t.refundedSoFar(mailForint(r.refunded_total))
              : "",
        },
        blocks: {},
      };
    }
  }
}

const SAMPLE_ORDER: WebshopMailOrder = {
  display_id: 38,
  items: [
    { title: "Hanna HI780-25 pH reagens", quantity: 1, total: 10500 },
    { title: "Aquaforest Reef Salt 22 kg", quantity: 1, total: 28900 },
  ],
  shipping: [{ name: "FOXPOST csomagautomata", amount: 0 }],
  total: 39400,
  payment: "COD",
};

const SAMPLE_COMMON = {
  customer_name: "Kiss Márta",
  order_created_at: "2026-10-05T09:21:00.000Z",
  locale: "hu" as const,
  order_view_url: "https://shop.example/hu/rendeles-megtekintese",
};

/**
 * The preview's facts, one per template: sample data, never a real order.
 * They go through the same derivation and renderer as a real mail, so the
 * preview shows what the customer would get.
 */
export const WEBSHOP_MAIL_SAMPLE_FACTS: Readonly<
  Record<WebshopMailTemplate, WebshopMailFacts>
> = {
  "order-placed": {
    ...SAMPLE_COMMON,
    template: "order-placed",
    orders: [{ ...SAMPLE_ORDER, pickup: false }],
    legal_version: "unas-shop-2026-09-29",
  },
  "order-status-confirmed": {
    ...SAMPLE_COMMON,
    template: "order-status-confirmed",
    order: SAMPLE_ORDER,
  },
  "order-status-out_for_delivery": {
    ...SAMPLE_COMMON,
    template: "order-status-out_for_delivery",
    order: SAMPLE_ORDER,
  },
  "order-status-ready_for_pickup": {
    ...SAMPLE_COMMON,
    template: "order-status-ready_for_pickup",
    order: {
      ...SAMPLE_ORDER,
      shipping: [{ name: "Személyes átvétel a boltban", amount: 0 }],
      payment: "PAY_AT_STORE",
    },
  },
  "order-status-closed": {
    ...SAMPLE_COMMON,
    template: "order-status-closed",
    order: SAMPLE_ORDER,
  },
  "order-shipped": {
    ...SAMPLE_COMMON,
    template: "order-shipped",
    shipped: {
      display_id: 38,
      carrier: "foxpost",
      destination_title: "FOXPOST – Auchan Aquincum automata",
      destination_address: "1033 Budapest, Szentendrei út 115.",
      gls_point: false,
      tracking_number: "CLFOX0000000000",
      tracking_url: null,
      items: SAMPLE_ORDER.items.map(({ title, quantity }) => ({
        title,
        quantity,
      })),
      cod_amount: 39400,
      foxpost_logo_url: null,
      gls_logo_url: null,
      gls_point_type: null,
    },
  },
  "order-payment-delayed": {
    ...SAMPLE_COMMON,
    template: "order-payment-delayed",
    order: { ...SAMPLE_ORDER, payment: "ONLINE_CARD" },
    amount: 39400,
    pickup_display_id: null,
  },
  "order-payment-link": {
    ...SAMPLE_COMMON,
    template: "order-payment-link",
    order: { ...SAMPLE_ORDER, payment: "ONLINE_CARD" },
    url: "https://acropora.hu/fizetes/minta",
    expires_at: "2026-10-11T12:00:00.000Z",
    amount: 39400,
    pickup: null,
  },
  "order-payment-reminder": {
    ...SAMPLE_COMMON,
    template: "order-payment-reminder",
    order: { ...SAMPLE_ORDER, payment: "ONLINE_CARD" },
    url: "https://acropora.hu/fizetes/minta",
    expires_at: "2026-10-11T12:00:00.000Z",
    amount: 39400,
    pickup: null,
  },
  "order-split": {
    ...SAMPLE_COMMON,
    template: "order-split",
    order: {
      ...SAMPLE_ORDER,
      items: SAMPLE_ORDER.items.slice(0, 1),
      total: 10500,
      payment: "ONLINE_CARD",
    },
    split_order: {
      display_id: 39,
      items: SAMPLE_ORDER.items.slice(1),
      shipping: [],
      total: 28900,
      payment: null,
    },
    payment: "card",
  },
  "problem-report-received": {
    ...SAMPLE_COMMON,
    template: "problem-report-received",
    display_id: 38,
    report_id: "ordprb_01SAMPLE",
  },
  "newsletter-confirm": {
    ...SAMPLE_COMMON,
    order_created_at: null,
    order_view_url: null,
    template: "newsletter-confirm",
    confirm_url: "https://shop.example/hu/hirlevel/megerosites?token=minta",
    unsubscribe_url: "https://shop.example/hu/hirlevel/leiratkozas?token=minta",
    expires_at: "2026-10-12T09:21:00.000Z",
  },
  "payment-refunded": {
    ...SAMPLE_COMMON,
    template: "payment-refunded",
    refund: {
      display_id: 38,
      amount: 10500,
      refunded_total: 10500,
      last4: "4242",
    },
  },
};

/** The OS key of a mail in a language: the Hungarian key, or its English twin. */
export function webshopMailKey(
  template: WebshopMailTemplate,
  locale: WebshopMailLocale | undefined,
): string {
  const key = WEBSHOP_MAIL_KEYS[template];
  return locale === "en" ? `${key}${WEBSHOP_ENGLISH_KEY_SUFFIX}` : key;
}

/** The language an OS key stands for: `en` for an English twin, `hu` otherwise. */
export function webshopMailLocaleOf(key: string): WebshopMailLocale {
  return key.endsWith(WEBSHOP_ENGLISH_KEY_SUFFIX) ? "en" : "hu";
}

/**
 * The webshop template name of an OS key (an English twin too), or `null` for
 * a service key.
 */
export function webshopMailTemplateOf(key: string): WebshopMailTemplate | null {
  const base = key.endsWith(WEBSHOP_ENGLISH_KEY_SUFFIX)
    ? key.slice(0, -WEBSHOP_ENGLISH_KEY_SUFFIX.length)
    : key;
  const entry = Object.entries(WEBSHOP_MAIL_KEYS).find(([, os]) => os === base);
  return entry ? (entry[0] as WebshopMailTemplate) : null;
}

/**
 * THE WEBSHOP'S FACTS ARE CHECKED, NOT TRUSTED.
 *
 * They arrive over the network, and a missing field would otherwise surface
 * as "undefined" in a customer's mail. Every field is checked for its type;
 * texts and lists have upper bounds, so one request cannot build a mail of
 * any size. The answer names the first wrong field.
 */
export type WebshopFactsParse =
  | { readonly ok: true; readonly facts: WebshopMailFacts }
  | { readonly ok: false; readonly error: string };

const MAX_TEXT = 500;
const MAX_LIST = 200;

class FactsError extends Error {}

type Raw = Record<string, unknown>;

function obj(v: unknown, path: string): Raw {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new FactsError(`${path}: objektum kell`);
  return v as Raw;
}
function str(v: unknown, path: string): string {
  if (typeof v !== "string" || v.length > MAX_TEXT)
    throw new FactsError(
      `${path}: szöveg kell (legfeljebb ${MAX_TEXT} karakter)`,
    );
  return v;
}
function strOrNull(v: unknown, path: string): string | null {
  return v === null || v === undefined ? null : str(v, path);
}
function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new FactsError(`${path}: szám kell`);
  return v;
}
function id(v: unknown, path: string): number | string {
  return typeof v === "number" ? num(v, path) : str(v, path);
}
function list<T>(
  v: unknown,
  path: string,
  each: (x: unknown, p: string) => T,
): T[] {
  if (!Array.isArray(v) || v.length > MAX_LIST)
    throw new FactsError(`${path}: lista kell (legfeljebb ${MAX_LIST} elem)`);
  return v.map((x, i) => each(x, `${path}[${i}]`));
}
function role(v: unknown, path: string): WebshopPaymentRole | null {
  if (v === null || v === undefined) return null;
  if (
    v === "ONLINE_CARD" ||
    v === "COD" ||
    v === "PAY_AT_STORE" ||
    v === "BANK_TRANSFER"
  )
    return v;
  throw new FactsError(
    `${path}: ONLINE_CARD, COD, PAY_AT_STORE, BANK_TRANSFER vagy null`,
  );
}
function order(v: unknown, path: string): WebshopMailOrder {
  const o = obj(v, path);
  return {
    display_id: id(o.display_id, `${path}.display_id`),
    items: list(o.items, `${path}.items`, (x, p) => {
      const i = obj(x, p);
      return {
        title: str(i.title, `${p}.title`),
        quantity: num(i.quantity, `${p}.quantity`),
        total: num(i.total, `${p}.total`),
      };
    }),
    shipping: list(o.shipping, `${path}.shipping`, (x, p) => {
      const m = obj(x, p);
      return {
        name: str(m.name, `${p}.name`),
        amount: num(m.amount, `${p}.amount`),
      };
    }),
    total: num(o.total, `${path}.total`),
    payment: role(o.payment, `${path}.payment`),
  };
}

/**
 * THE GUEST ORDER PAGE'S ADDRESS, if it is one a mail may carry: a plain https address, no credentials, no spaces or
 * control characters, at most 300 characters. Anything else is null (no link): the value goes into a customer's mail
 * as it stands, so only an address that looks like an address is let through. Not a check that the page exists.
 */
export function safeOrderViewUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > 300) return null;
  if (/[\s\u0000-\u001f\u007f<>"']/.test(v)) return null;
  try {
    const url = new URL(v);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href === v || url.href === `${v}/` ? v : null;
  } catch {
    return null;
  }
}

/** `hu` or `en`; missing is `hu`, anything else is refused (400): a wrong language must not become Hungarian silently. */
function parseLocale(v: unknown): WebshopMailLocale {
  if (v === undefined || v === null) return "hu";
  if (v === "hu" || v === "en") return v;
  throw new FactsError("facts.locale: hu vagy en kell");
}

export function isWebshopMailTemplate(v: unknown): v is WebshopMailTemplate {
  return (
    typeof v === "string" &&
    Object.prototype.hasOwnProperty.call(WEBSHOP_MAIL_KEYS, v)
  );
}

export function parseWebshopMailFacts(
  template: unknown,
  raw: unknown,
): WebshopFactsParse {
  try {
    const parsed = parseTemplateFacts(template, raw);
    const f = obj(raw, "facts");
    const created = strOrNull(f.order_created_at, "facts.order_created_at");
    if (created !== null && Number.isNaN(new Date(created).getTime()))
      throw new FactsError("facts.order_created_at: ISO időpont kell");
    return {
      ok: true,
      facts: {
        ...parsed,
        customer_name: strOrNull(f.customer_name, "facts.customer_name"),
        order_created_at: created,
        locale: parseLocale(f.locale),
        order_view_url: safeOrderViewUrl(f.order_view_url),
      },
    };
  } catch (error) {
    if (error instanceof FactsError) return { ok: false, error: error.message };
    throw error;
  }
}

function parseTemplateFacts(
  template: unknown,
  raw: unknown,
): WebshopTemplateFacts {
  if (!isWebshopMailTemplate(template))
    throw new FactsError(`template: ismeretlen sablon`);
  const f = obj(raw, "facts");
  switch (template) {
    case "order-placed": {
      const orders = list(f.orders, "facts.orders", (x, p) => {
        const o = obj(x, p);
        if (typeof o.pickup !== "boolean")
          throw new FactsError(`${p}.pickup: igaz/hamis kell`);
        return {
          ...order(x, p),
          pickup: o.pickup,
          // a webshop that sends no list (or something else) leaves the key out, as before
          ...(Array.isArray(o.livestock_kinds)
            ? {
                livestock_kinds: o.livestock_kinds.filter(
                  isWebshopLivestockKind,
                ),
              }
            : {}),
        };
      });
      if (!orders.length)
        throw new FactsError("facts.orders: legalább egy rendelés kell");
      return {
        template,
        orders,
        legal_version: strOrNull(f.legal_version, "facts.legal_version"),
      };
    }
    case "order-status-confirmed":
    case "order-status-out_for_delivery":
    case "order-status-ready_for_pickup":
    case "order-status-closed":
      return { template, order: order(f.order, "facts.order") };
    case "order-shipped": {
      const s = obj(f.shipped, "facts.shipped");
      const carrier = s.carrier;
      if (carrier !== "foxpost" && carrier !== "gls")
        throw new FactsError("facts.shipped.carrier: foxpost vagy gls");
      const cod = s.cod_amount;
      return {
        template,
        shipped: {
          display_id: id(s.display_id, "facts.shipped.display_id"),
          carrier,
          destination_title: str(
            s.destination_title,
            "facts.shipped.destination_title",
          ),
          destination_address: str(
            s.destination_address,
            "facts.shipped.destination_address",
          ),
          gls_point: s.gls_point === true,
          tracking_number: str(
            s.tracking_number,
            "facts.shipped.tracking_number",
          ),
          tracking_url: strOrNull(s.tracking_url, "facts.shipped.tracking_url"),
          items: list(s.items, "facts.shipped.items", (x, p) => {
            const i = obj(x, p);
            return {
              title: str(i.title, `${p}.title`),
              quantity: num(i.quantity, `${p}.quantity`),
            };
          }),
          cod_amount:
            cod === null || cod === undefined
              ? null
              : num(cod, "facts.shipped.cod_amount"),
          foxpost_logo_url: strOrNull(
            s.foxpost_logo_url,
            "facts.shipped.foxpost_logo_url",
          ),
          gls_logo_url: strOrNull(s.gls_logo_url, "facts.shipped.gls_logo_url"),
          gls_point_type: strOrNull(
            s.gls_point_type,
            "facts.shipped.gls_point_type",
          ),
        },
      };
    }
    case "order-payment-delayed":
      return {
        template,
        order: order(f.order, "facts.order"),
        amount: num(f.amount, "facts.amount"),
        pickup_display_id:
          f.pickup_display_id === null || f.pickup_display_id === undefined
            ? null
            : id(f.pickup_display_id, "facts.pickup_display_id"),
      };
    case "order-payment-link":
    case "order-payment-reminder": {
      const expires_at = str(f.expires_at, "facts.expires_at");
      if (Number.isNaN(new Date(expires_at).getTime()))
        throw new FactsError("facts.expires_at: ISO időpont kell");
      return {
        template,
        order: order(f.order, "facts.order"),
        url: str(f.url, "facts.url"),
        expires_at,
        amount: num(f.amount, "facts.amount"),
        pickup:
          f.pickup === null || f.pickup === undefined
            ? null
            : order(f.pickup, "facts.pickup"),
      };
    }
    case "order-split": {
      const payment = f.payment;
      if (
        typeof payment !== "string" ||
        !(WEBSHOP_SPLIT_PAYMENTS as readonly string[]).includes(payment)
      )
        throw new FactsError("facts.payment: card, cod, store vagy transfer");
      return {
        template,
        order: order(f.order, "facts.order"),
        split_order: order(f.split_order, "facts.split_order"),
        payment: payment as WebshopSplitPayment,
      };
    }
    case "problem-report-received":
      return {
        template,
        display_id: id(f.display_id, "facts.display_id"),
        report_id: str(f.report_id, "facts.report_id"),
      };
    case "newsletter-confirm": {
      // the two links go into an href: a clean https address or the mail is refused (422), never sent without them
      const link = (value: unknown, at: string) => {
        const url = safeOrderViewUrl(value);
        if (!url) throw new FactsError(`${at}: tiszta https cím kell`);
        return url;
      };
      const expires_at = str(f.expires_at, "facts.expires_at");
      if (Number.isNaN(new Date(expires_at).getTime()))
        throw new FactsError("facts.expires_at: ISO időpont kell");
      return {
        template,
        confirm_url: link(f.confirm_url, "facts.confirm_url"),
        unsubscribe_url: link(f.unsubscribe_url, "facts.unsubscribe_url"),
        expires_at,
      };
    }
    case "payment-refunded": {
      const r = obj(f.refund, "facts.refund");
      return {
        template,
        refund: {
          display_id: id(r.display_id, "facts.refund.display_id"),
          amount: num(r.amount, "facts.refund.amount"),
          refunded_total: num(r.refunded_total, "facts.refund.refunded_total"),
          last4: strOrNull(r.last4, "facts.refund.last4"),
        },
      };
    }
  }
}

/**
 * A MAIL THE WEBSHOP COULD NOT SEND (commerce W2, murena 26562).
 *
 * `permanent` (the OS answered 400/422) and `config` (401/403, a missing
 * setting) are stuck at once and are not retried; anything else after an
 * hour. `last_error` is the OS render endpoint's own `message`, word for word,
 * or the webshop's Hungarian sentence for a network error.
 */
export interface WebshopStuckMail {
  readonly id: string;
  readonly template: string;
  readonly display_id: string | number | null;
  readonly resource_id: string;
  readonly to: string;
  readonly attempts: number;
  readonly failure_kind: "permanent" | "config" | "transient" | null;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly next_attempt_at: string | null;
  readonly alerted_at: string | null;
}

export interface WebshopStuckMailList {
  readonly items: readonly WebshopStuckMail[];
  /** Every stuck mail, not just this page. */
  readonly count: number;
}
