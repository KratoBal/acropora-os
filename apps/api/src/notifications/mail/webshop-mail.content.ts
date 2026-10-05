/**
 * THE WEBSHOP MAILS' DEFAULT TEXT, AND THEIR FRAME.
 *
 * The wording is the webshop's own, moved here word for word from commerce
 * `apps/backend/src/workflows/utils/webshop-mail/*` (measured at 089a1e2), so
 * that "Alapértelmezett" shows what customers get today. What changes is
 * only the look of the EDITABLE part: the orange top line and the 26px title
 * become the OS editor's bold paragraph and heading, because the shared
 * sanitizer keeps no `style` in edited text. The styled parts (the item
 * list, the amount box, the carrier box with its logo) are blocks and keep
 * their look (`webshop-mail.ts` in `@acropora/types`).
 *
 * Each default is HTML in the editor's own stored form (variables as
 * `<span data-variable>`), so loading it into the editor changes nothing.
 */
import { richHtmlToText } from "@acropora/rich-text";
import {
  MAIL_TEMPLATE_VARIABLES,
  SHOP_CONTACT,
  WEBSHOP_MAIL_KEYS,
} from "@acropora/types";

const v = (name: string) => `<span data-variable="${name}">{{${name}}}</span>`;
const own = (name: string) => `<p>${v(name)}</p>`;
const top = (eyebrow: string, title: string, orders: string) =>
  `<p><strong>${eyebrow}</strong></p><h2>${title}</h2><p>Rendelés: ${orders}</p>`;
const contact = `<p>Kérdésed van? Írj nekünk: ${SHOP_CONTACT}</p>`;

const LINK_NAMES = MAIL_TEMPLATE_VARIABLES.filter((x) => x.kind === "link").map(
  (x) => x.name,
);

export interface WebshopDefaultTemplate {
  readonly subject: string;
  /** The text form, made from the HTML the same way a save makes it. */
  readonly body: string;
  readonly bodyHtml: string;
}

const status = (
  eyebrow: string,
  title: string,
  subject: string,
  lead: readonly string[],
  due: boolean,
) => ({
  subject,
  bodyHtml: [
    top(eyebrow, title, `#${v("rendeles_szam")}`),
    ...lead.map((line) => `<p>${line}</p>`),
    ...(due ? [own("fizetendo_doboz")] : []),
    own("rendeles_tetelek"),
    contact,
  ].join(""),
});

const paymentLink = (eyebrow: string, title: string, subject: string) => ({
  subject,
  bodyHtml: [
    top(eyebrow, title, v("rendeles_szamok")),
    "<p>A rendelésed készen áll. Most fizetheted ki a lenti gombbal; a csomagot a fizetés után indítjuk.</p>",
    own("bolti_rendeles_mondat"),
    `<p>A link ${v("link_lejarat")} végéig érvényes. Ha addig nem érkezik fizetés, a rendelést lezárjuk.</p>`,
    own("fizetendo_doboz"),
    `<p data-cta=""><a href="{{fizetesi_link}}">Fizetés</a></p>`,
    own("rendeles_tetelek"),
    contact,
  ].join(""),
});

const RAW: Readonly<
  Record<
    (typeof WEBSHOP_MAIL_KEYS)[keyof typeof WEBSHOP_MAIL_KEYS],
    { subject: string; bodyHtml: string }
  >
> = {
  WEBSHOP_ORDER_PLACED: {
    subject: "Rendelésed visszaigazolása ({{rendeles_szamok}})",
    bodyHtml: [
      `<p>Köszönjük a rendelésedet! ${v("vegyes_kosar_mondat")}</p>`,
      own("rendeles_tetelek"),
      own("kovetkezo_lepes"),
    ].join(""),
  },
  WEBSHOP_ORDER_CONFIRMED: status(
    "RENDELÉS VISSZAIGAZOLVA",
    "Visszaigazoltuk a rendelésedet",
    "Visszaigazoltuk a rendelésedet (#{{rendeles_szam}})",
    ["A rendelésedet átnéztük és visszaigazoltuk. Most összekészítjük."],
    false,
  ),
  WEBSHOP_ORDER_OUT_FOR_DELIVERY: status(
    "KISZÁLLÍTÁS",
    "Úton van a rendelésed",
    "Úton van a rendelésed (#{{rendeles_szam}})",
    [
      "A rendelésedet átadtuk a szállítónak.",
      `Szállítási mód: ${v("szallitasi_mod")}`,
    ],
    true,
  ),
  WEBSHOP_ORDER_READY_FOR_PICKUP: status(
    "ÁTVEHETŐ",
    "Átveheted a rendelésedet",
    "Átvehető a rendelésed (#{{rendeles_szam}})",
    ["A rendelésed elkészült, átveheted.", `Átvétel: ${v("szallitasi_mod")}`],
    true,
  ),
  WEBSHOP_ORDER_CLOSED: status(
    "RENDELÉS LEZÁRVA",
    "Köszönjük a vásárlást!",
    "Köszönjük a vásárlást (#{{rendeles_szam}})",
    ["A rendelésedet lezártuk. Köszönjük, hogy nálunk vásároltál!"],
    false,
  ),
  WEBSHOP_ORDER_SHIPPED: {
    subject: "Feladtuk a csomagodat (#{{rendeles_szam}})",
    bodyHtml: [
      top("CSOMAG FELADVA", "Feladtuk a csomagodat", `#${v("rendeles_szam")}`),
      "<p>A csomagodat átadtuk a szállítónak. Az alábbi adatokkal tudod követni.</p>",
      own("szallitas_doboz"),
      own("fizetendo_doboz"),
      own("csomag_tartalma"),
      contact,
    ].join(""),
  },
  WEBSHOP_SHIPPING_DELAYED: {
    subject: "Csúszik a rendelésed szállítása (#{{rendeles_szam}})",
    bodyHtml: [
      top(
        "SZÁLLÍTÁSI CSÚSZÁS",
        "Csúszik a rendelésed szállítása",
        v("rendeles_szamok"),
      ),
      "<p>A rendelésed szállítása a vártnál később lesz lehetséges, mert nem minden tétel érkezett még meg hozzánk.</p>",
      `<p>A kártyádat NEM terheltük meg. A rendeléskor zárolt ${v("zarolt_osszeg")} zárolását feloldottuk; hogy ez mikor látszik a számládon, az a bankodon múlik.</p>`,
      "<p>Amint a rendelésed készen áll, emailben küldünk egy fizetési linket. A csomagot a fizetés után indítjuk.</p>",
      own("bolti_rendeles_mondat"),
      own("rendeles_tetelek"),
      contact,
    ].join(""),
  },
  WEBSHOP_PAYMENT_LINK: paymentLink(
    "FIZETÉS",
    "Kifizetheted a rendelésedet",
    "Kifizetheted a rendelésedet (#{{rendeles_szam}})",
  ),
  WEBSHOP_PAYMENT_REMINDER: paymentLink(
    "EMLÉKEZTETŐ",
    "Még kifizetheted a rendelésedet",
    "Emlékeztető: még kifizetheted a rendelésedet (#{{rendeles_szam}})",
  ),
  WEBSHOP_REFUND: {
    subject: "Visszatérítés a #{{rendeles_szam}} rendelésedről",
    bodyHtml: [
      `<p>Visszatérítettünk ${v("visszaterites_osszege")} összeget ${v("kartya_megnevezes")} a #${v("rendeles_szam")} rendelésedről.</p>`,
      own("eddigi_visszaterites_mondat"),
      "<p>A jóváírás ideje a bankodtól függ.</p>",
    ].join(""),
  },
};

/** The default of a webshop key, or `null` for any other key. */
export function webshopDefaultTemplate(
  id: string,
): WebshopDefaultTemplate | null {
  const raw = (
    RAW as Readonly<Record<string, { subject: string; bodyHtml: string }>>
  )[id];
  if (!raw) return null;
  return {
    subject: raw.subject,
    bodyHtml: raw.bodyHtml,
    body: richHtmlToText(raw.bodyHtml, { hrefPlaceholders: LINK_NAMES }),
  };
}
