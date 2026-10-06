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
import type { MailTemplateValues } from "./mail-template.js";

export type WebshopPaymentRole = "ONLINE_CARD" | "COD" | "PAY_AT_STORE";

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
}

/** The facts of one mail, by the webshop's own template name. */
export type WebshopMailFacts = WebshopMailCommonFacts & WebshopTemplateFacts;

type WebshopTemplateFacts =
  | {
      readonly template: "order-placed";
      readonly orders: readonly WebshopPlacedOrder[];
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
    };

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

const PAYMENT_LABEL: Record<WebshopPaymentRole, string> = {
  ONLINE_CARD: "Bankkártya",
  COD: "Utánvét",
  PAY_AT_STORE: "Fizetés a boltban",
};

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

const priced = (order: WebshopMailOrder) => [
  ...order.items.map(
    (i) => `${i.title} × ${i.quantity}: ${mailForint(i.total)}`,
  ),
  ...order.shipping.map((m) => `Szállítás: ${m.name}, ${mailForint(m.amount)}`),
];

const paymentSentence = (role: WebshopPaymentRole | null): string | null => {
  switch (role) {
    case "ONLINE_CARD":
      return "A kártyádon most zároltuk az összeget; a terhelés akkor történik, amikor a rendelést teljesítjük.";
    case "COD":
      return "Az összeget a csomag átvételekor fizeted.";
    case "PAY_AT_STORE":
      return "Az összeget a boltban, átvételkor fizeted.";
    default:
      return null;
  }
};

const ordersLabel = (id: number | string, other: number | string | null) =>
  other === null ? `#${id}` : `#${id} és #${other}`;

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
): WebshopMailContent {
  const own = templateContent(facts);
  return {
    values: {
      ...own.values,
      ugyfel_neve: facts.customer_name ?? "",
      rendeles_datum: facts.order_created_at
        ? hungarianDay(facts.order_created_at)
        : "",
    },
    blocks: own.blocks,
  };
}

function templateContent(facts: WebshopTemplateFacts): WebshopMailContent {
  switch (facts.template) {
    case "order-placed": {
      const orders = facts.orders;
      const first = orders[0];
      if (!first)
        throw new Error("An order confirmation needs at least one order");
      const mixed = orders.length > 1;
      const mixedLine = mixed
        ? [
            "Az élő állat miatt két rendelés lett belőle: a kiszállítandó tételeké, és a boltban átvehetőké.",
            ...(orders.every((o) => o.payment === "ONLINE_CARD")
              ? ["A kártyás fizetés a kettőre együtt, egy lépésben történt."]
              : []),
          ].join(" ")
        : "";
      const sections = orders.map((o) => ({
        title: `Rendelés #${o.display_id}${o.pickup ? " (átvétel a boltban)" : ""}`,
        lines: [
          ...priced(o),
          `Fizetendő: ${mailForint(o.total)}`,
          ...(o.payment ? [`Fizetés: ${PAYMENT_LABEL[o.payment]}`] : []),
        ],
        after: paymentSentence(o.payment),
      }));
      const items = listBlock(sections, false);
      const total = orders.reduce((sum, o) => sum + o.total, 0);
      const next = [
        ...(orders.some((o) => !o.pickup)
          ? [
              "Összekészítjük a rendelésedet. Követési szám csak a csomag feladása után lesz.",
            ]
          : []),
        ...(orders.some((o) => o.pickup)
          ? ["Az élő állatos rendelést a boltban veszed át."]
          : []),
      ].join("\n");
      return {
        values: {
          rendeles_szam: String(first.display_id),
          rendeles_szamok: orders.map((o) => `#${o.display_id}`).join(" és "),
          vegyes_kosar_mondat: mixedLine,
          osszesen: mailForint(total),
          kovetkezo_lepes: next,
        },
        blocks: {
          rendeles_tetelek: mixed
            ? {
                html: `${items.html}<p>${escapeHtml(`Összesen: ${mailForint(total)}`)}</p>`,
                text: `${items.text}\n\nÖsszesen: ${mailForint(total)}`,
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
      const due =
        (facts.template === "order-status-out_for_delivery" &&
          o.payment === "COD") ||
        (facts.template === "order-status-ready_for_pickup" &&
          o.payment === "PAY_AT_STORE")
          ? o.total
          : null;
      return {
        values: {
          rendeles_szam: String(o.display_id),
          szallitasi_mod: method,
          osszesen: mailForint(o.total),
        },
        blocks: {
          fizetendo_doboz:
            due === null ? null : amountBox("ÁTVÉTELKOR FIZETENDŐ", due),
          rendeles_tetelek: listBlock([
            {
              title: "A rendelésed",
              lines: [
                ...priced(o),
                `Végösszeg: ${mailForint(o.total)}`,
                ...(o.payment ? [`Fizetés: ${PAYMENT_LABEL[o.payment]}`] : []),
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
            ? "GLS csomagpont"
            : "GLS házhozszállítás";
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
              ? "GLS Automata"
              : "GLS Csomagpont";
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
          `<p style="margin:12px 0 0;color:#6b7280;font-size:11px;">Követési szám</p>` +
          `<p style="margin:2px 0 0;font-size:18px;font-weight:bold;">${escapeHtml(s.tracking_number)}</p>` +
          (tracking
            ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(tracking)}" style="display:block;background:#0f1720;color:#ffffff;text-align:center;padding:12px 16px;text-decoration:none;font-weight:bold;">Csomag követése</a></p>`
            : "") +
          `</div>`,
        text: [
          carrier,
          destination,
          `Követési szám: ${s.tracking_number}`,
          ...(tracking ? [`Csomag követése: ${tracking}`] : []),
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
              : amountBox("ÁTVÉTELKOR FIZETENDŐ", s.cod_amount),
          csomag_tartalma: listBlock([
            {
              title: "A csomagban",
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
          rendeles_szamok: ordersLabel(o.display_id, facts.pickup_display_id),
          zarolt_osszeg: mailForint(facts.amount),
          bolti_rendeles_mondat:
            facts.pickup_display_id === null
              ? ""
              : `A bolti átvételes #${facts.pickup_display_id} rendelésed ugyanazzal a kártyás fizetéssel készült, ezért a zárolását is feloldottuk. A fizetési link mindkét rendelést fizeti.`,
        },
        blocks: {
          rendeles_tetelek: listBlock([
            {
              title: `A rendelésed (#${o.display_id})`,
              lines: [...priced(o), `Végösszeg: ${mailForint(o.total)}`],
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
          rendeles_szamok: ordersLabel(o.display_id, p ? p.display_id : null),
          fizetesi_link: webAddress(facts.url) ?? "",
          fizetendo: mailForint(facts.amount),
          link_lejarat: hungarianDay(facts.expires_at),
          bolti_rendeles_mondat: p
            ? `A fizetés a bolti átvételes #${p.display_id} rendelésedet is tartalmazza, egy összegben.`
            : "",
        },
        blocks: {
          fizetendo_doboz: amountBox("FIZETENDŐ", facts.amount),
          rendeles_tetelek: listBlock([
            {
              title: `A rendelésed (#${o.display_id})`,
              lines: [...priced(o), `Végösszeg: ${mailForint(o.total)}`],
            },
            ...(p
              ? [
                  {
                    title: `Bolti átvételes rendelésed (#${p.display_id})`,
                    lines: [...priced(p), `Végösszeg: ${mailForint(p.total)}`],
                  },
                ]
              : []),
          ]),
        },
      };
    }

    case "payment-refunded": {
      const r = facts.refund;
      return {
        values: {
          rendeles_szam: String(r.display_id),
          visszaterites_osszege: mailForint(r.amount),
          kartya_megnevezes: r.last4
            ? `a ${r.last4} végű kártyádra`
            : "a kártyádra, amellyel fizettél",
          eddigi_visszaterites_mondat:
            r.refunded_total > r.amount
              ? `Erről a rendelésről eddig összesen ${mailForint(r.refunded_total)} visszatérítés ment.`
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

/** The webshop template name of an OS key, or `null` for a service key. */
export function webshopMailTemplateOf(key: string): WebshopMailTemplate | null {
  const entry = Object.entries(WEBSHOP_MAIL_KEYS).find(([, os]) => os === key);
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
  if (v === "ONLINE_CARD" || v === "COD" || v === "PAY_AT_STORE") return v;
  throw new FactsError(`${path}: ONLINE_CARD, COD, PAY_AT_STORE vagy null`);
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
        return { ...order(x, p), pickup: o.pickup };
      });
      if (!orders.length)
        throw new FactsError("facts.orders: legalább egy rendelés kell");
      return { template, orders };
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
