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
  WEBSHOP_ENGLISH_KEY_SUFFIX,
  WEBSHOP_MAIL_KEYS,
} from "@acropora/types";

const v = (name: string) => `<span data-variable="${name}">{{${name}}}</span>`;
const own = (name: string) => `<p>${v(name)}</p>`;

/**
 * THE WORDS AROUND THE TEXT, PER LANGUAGE. Hungarian is the default of every
 * helper below, so the Hungarian mails are exactly what they were; the English
 * twins (`<KEY>_EN`, card d5c6befd) pass `EN`.
 */
interface Copy {
  readonly order: string;
  readonly contact: string;
  readonly pay: string;
}
const HU: Copy = {
  order: "Rendelés",
  contact: `<p>Kérdésed van? Írj nekünk: ${SHOP_CONTACT}</p>`,
  pay: "Fizetés",
};
const EN: Copy = {
  order: "Order",
  contact: `<p>Any questions? Write to us: ${SHOP_CONTACT}</p>`,
  pay: "Pay",
};

const top = (eyebrow: string, title: string, orders: string, copy: Copy = HU) =>
  `<p><strong>${eyebrow}</strong></p><h2>${title}</h2><p>${copy.order}: ${orders}</p>`;
const contact = HU.contact;

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
  copy: Copy = HU,
) => ({
  subject,
  bodyHtml: [
    top(eyebrow, title, `#${v("rendeles_szam")}`, copy),
    ...lead.map((line) => `<p>${line}</p>`),
    ...(due ? [own("fizetendo_doboz")] : []),
    own("rendeles_tetelek"),
    copy.contact,
  ].join(""),
});

const paymentLink = (
  eyebrow: string,
  title: string,
  subject: string,
  copy: Copy = HU,
) => ({
  subject,
  bodyHtml: [
    top(eyebrow, title, v("rendeles_szamok"), copy),
    copy === EN
      ? "<p>Your order is ready. You can pay now with the button below; we ship the parcel after payment.</p>"
      : "<p>A rendelésed készen áll. Most fizetheted ki a lenti gombbal; a csomagot a fizetés után indítjuk.</p>",
    own("bolti_rendeles_mondat"),
    copy === EN
      ? `<p>The link is valid until ${v("link_lejarat")}. If no payment arrives by then, we will close the order.</p>`
      : `<p>A link ${v("link_lejarat")} végéig érvényes. Ha addig nem érkezik fizetés, a rendelést lezárjuk.</p>`,
    own("fizetendo_doboz"),
    `<p data-cta=""><a href="{{fizetesi_link}}">${copy.pay}</a></p>`,
    own("rendeles_tetelek"),
    copy.contact,
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
      // V2.6: empty (and no paragraph) until the kind's guide is in `webshop-acclimation.ts`
      own("akklimatizacio"),
      // the guest order page's address; empty (and no paragraph) when the shop sends none
      own("rendeles_megtekintes_mondat"),
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
  WEBSHOP_ORDER_SPLIT: {
    subject: "Két részben érkezik a rendelésed ({{rendeles_szamok}})",
    bodyHtml: [
      top(
        "RENDELÉS KÉT RÉSZBEN",
        "Két részben érkezik a rendelésed",
        v("rendeles_szamok"),
      ),
      `<p>A rendelésed néhány tétele még nem érkezett meg hozzánk. Hogy a többire ne kelljen várnod, a rendelést két részre bontottuk: amit már tudunk, elindítjuk, a többit a ${v("masodik_resz_szam")} rendelésben küldjük, amint megérkezik.</p>`,
      own("reszek_fizetese_mondat"),
      own("rendeles_tetelek"),
      contact,
    ].join(""),
  },
  WEBSHOP_PROBLEM_REPORT_RECEIVED: {
    subject: "Megkaptuk a bejelentésedet ({{ugy_azonosito}})",
    bodyHtml: [
      `<p>Köszönjük, megkaptuk a bejelentésedet a #${v("rendeles_szam")} rendelésről.</p>`,
      `<p>Az ügy azonosítója: ${v("ugy_azonosito")}.</p>`,
      "<p>Kollégánk hamarosan jelentkezik.</p>",
    ].join(""),
  },
  /*
    A VAZLAT (Balazs dontesere var, Eldontendo lista 3. pont, 2026-11-09): a beerkezes visszaigazolasa tartos
    adathordozon (45/2014. Korm. rendelet 22. §), ezert csak a tenyek allnak benne: a rendeles, a nyilatkozat
    azonositoja, neve es napja. Nincs hatarido, nincs kimenet-igeret (visszaterites, csere), nincs torvenyi mondat:
    ezek a tulajdonos es a jogasz szavai. A vegleges szoveget a sablon-szerkeszto adja (a mentett szoveg elobb all).
  */
  WEBSHOP_WITHDRAWAL_RECEIVED: {
    subject:
      "Megkaptuk az elállási nyilatkozatodat ({{nyilatkozat_azonosito}})",
    bodyHtml: [
      `<p>Megkaptuk az elállási nyilatkozatodat a #${v("rendeles_szam")} rendelésről.</p>`,
      `<p>A nyilatkozat azonosítója: ${v("nyilatkozat_azonosito")}. A nyilatkozatot ${v("nyilatkozat_neve")} nevével adták le, ${v("nyilatkozat_idopont")} napján érkezett meg.</p>`,
      "<p>A további teendőkről a csapatunk jelentkezik.</p>",
    ].join(""),
  },
  WEBSHOP_NEWSLETTER_CONFIRM: {
    subject: "Erősítsd meg a feliratkozásodat a hírlevelünkre",
    bodyHtml: [
      "<p>Köszönjük, hogy feliratkoztál az Acropora hírlevelére!</p>",
      "<p>A feliratkozás akkor él, ha megerősíted a lenti gombbal. Amíg ez nem történik meg, nem küldünk hírlevelet.</p>",
      `<p data-cta=""><a href="{{hirlevel_megerosito_link}}">Feliratkozás megerősítése</a></p>`,
      `<p>A link ${v("megerosites_lejarat")} végéig működik. Ha nem te iratkoztál fel, nincs teendőd: megerősítés nélkül a címedre nem megy hírlevél.</p>`,
      `<p>Ha később nem kérsz több levelet, itt bármikor leiratkozhatsz: <a href="{{hirlevel_leiratkozo_link}}">leiratkozás</a>.</p>`,
    ].join(""),
  },
  WEBSHOP_STOCK_ALERT_CONFIRM: {
    subject: "Erősítsd meg az értesítés-kérésedet",
    bodyHtml: [
      `<p>Értesítést kértél tőlünk, ha ebből újra érkezik: <strong>${v("ertesites_targya")}</strong>.</p>`,
      "<p>Az értesítés akkor él, ha megerősíted a lenti gombbal. Amíg ez nem történik meg, nem írunk erről.</p>",
      `<p data-cta=""><a href="{{ertesites_megerosito_link}}">Értesítés-kérés megerősítése</a></p>`,
      `<p>A link ${v("megerosites_lejarat")} végéig működik. Ha nem te kérted, nincs teendőd: megerősítés nélkül erről nem kapsz levelet.</p>`,
      `<p>Nem kérsz több értesítést erről? <a href="{{ertesites_leiratkozo_link}}">Leiratkozás</a></p>`,
    ].join(""),
  },
  WEBSHOP_STOCK_ALERT_ARRIVAL: {
    subject: "Megérkezett: {{ertesites_targya}}",
    bodyHtml: [
      `<p>Értesítést kértél, ha ebből újra érkezik: <strong>${v("ertesites_targya")}</strong>. Most kapható:</p>`,
      `<p><strong>${v("ertesites_termek_neve")}</strong></p>`,
      `<p data-cta=""><a href="{{ertesites_termek_link}}">Megnézem</a></p>`,
      "<p>Erről a kérésről ez az egyetlen levelünk. Ha a következő darabról is tudni szeretnél, kérd újra.</p>",
      `<p>Nem kérsz több értesítést erről? <a href="{{ertesites_leiratkozo_link}}">Leiratkozás</a></p>`,
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

/**
 * THE ENGLISH DEFAULTS (card d5c6befd; wording: exchange-ready draft v1,
 * acrobot 41435: friendly and short, as the Hungarian is). Only the editable
 * part: the sentences and labels the code builds around it (payment lines,
 * block titles, the amount box) are the second step, and the LEGAL part of the
 * order confirmation stays the renderer's own, in Hungarian, until the English
 * documents exist (`webshop-legal.ts`; Balazs's question, acrobot 41439).
 */
const RAW_EN: typeof RAW = {
  WEBSHOP_ORDER_PLACED: {
    subject: "Your order confirmation ({{rendeles_szamok}})",
    bodyHtml: [
      `<p>Thank you for your order! ${v("vegyes_kosar_mondat")}</p>`,
      own("rendeles_tetelek"),
      own("kovetkezo_lepes"),
      // V2.6: empty (and no paragraph) until the kind's guide is in `webshop-acclimation.ts`
      own("akklimatizacio"),
      // the guest order page's address; empty (and no paragraph) when the shop sends none
      own("rendeles_megtekintes_mondat"),
    ].join(""),
  },
  WEBSHOP_ORDER_CONFIRMED: status(
    "ORDER CONFIRMED",
    "We have confirmed your order",
    "We have confirmed your order (#{{rendeles_szam}})",
    ["We have reviewed and confirmed your order. We are getting it ready now."],
    false,
    EN,
  ),
  WEBSHOP_ORDER_OUT_FOR_DELIVERY: status(
    "OUT FOR DELIVERY",
    "Your order is on its way",
    "Your order is on its way (#{{rendeles_szam}})",
    [
      "We have handed your order to the carrier.",
      `Delivery method: ${v("szallitasi_mod")}`,
    ],
    true,
    EN,
  ),
  WEBSHOP_ORDER_READY_FOR_PICKUP: status(
    "READY FOR PICKUP",
    "Your order is ready for pickup",
    "Your order is ready for pickup (#{{rendeles_szam}})",
    [
      "Your order is ready, you can pick it up.",
      `Pickup: ${v("szallitasi_mod")}`,
    ],
    true,
    EN,
  ),
  WEBSHOP_ORDER_CLOSED: status(
    "ORDER CLOSED",
    "Thank you for your purchase!",
    "Thank you for your purchase (#{{rendeles_szam}})",
    ["Your order is now closed. Thank you for shopping with us!"],
    false,
    EN,
  ),
  WEBSHOP_ORDER_SHIPPED: {
    subject: "We have shipped your parcel (#{{rendeles_szam}})",
    bodyHtml: [
      top(
        "PARCEL SHIPPED",
        "We have shipped your parcel",
        `#${v("rendeles_szam")}`,
        EN,
      ),
      "<p>We have handed your parcel to the carrier. You can track it with the details below.</p>",
      own("szallitas_doboz"),
      own("fizetendo_doboz"),
      own("csomag_tartalma"),
      EN.contact,
    ].join(""),
  },
  WEBSHOP_ORDER_SPLIT: {
    subject: "Your order arrives in two parts ({{rendeles_szamok}})",
    bodyHtml: [
      top(
        "ORDER IN TWO PARTS",
        "Your order arrives in two parts",
        v("rendeles_szamok"),
        EN,
      ),
      `<p>Some items of your order have not reached us yet. So that you do not have to wait for the rest, we have split the order in two: we are sending what we already have, and the rest will follow in order ${v("masodik_resz_szam")} as soon as it arrives.</p>`,
      own("reszek_fizetese_mondat"),
      own("rendeles_tetelek"),
      EN.contact,
    ].join(""),
  },
  WEBSHOP_PROBLEM_REPORT_RECEIVED: {
    subject: "We have received your report ({{ugy_azonosito}})",
    bodyHtml: [
      `<p>Thank you, we have received your report about order #${v("rendeles_szam")}.</p>`,
      `<p>The case reference is ${v("ugy_azonosito")}.</p>`,
      "<p>A colleague will be in touch shortly.</p>",
    ].join(""),
  },
  WEBSHOP_WITHDRAWAL_RECEIVED: {
    subject:
      "We have received your withdrawal declaration ({{nyilatkozat_azonosito}})",
    bodyHtml: [
      `<p>We have received your withdrawal declaration about order #${v("rendeles_szam")}.</p>`,
      `<p>The declaration's reference is ${v("nyilatkozat_azonosito")}. It was made in the name of ${v("nyilatkozat_neve")} and reached us on ${v("nyilatkozat_idopont")}.</p>`,
      "<p>Our team will get in touch about what follows.</p>",
    ].join(""),
  },
  WEBSHOP_NEWSLETTER_CONFIRM: {
    subject: "Confirm your subscription to our newsletter",
    bodyHtml: [
      "<p>Thank you for subscribing to the Acropora newsletter!</p>",
      "<p>Your subscription starts once you confirm it with the button below. Until then, we send no newsletter.</p>",
      `<p data-cta=""><a href="{{hirlevel_megerosito_link}}">Confirm subscription</a></p>`,
      `<p>The link works until ${v("megerosites_lejarat")}. If you did not subscribe, there is nothing to do: without a confirmation, no newsletter goes to your address.</p>`,
      `<p>If you no longer want our mails later, you can leave at any time here: <a href="{{hirlevel_leiratkozo_link}}">unsubscribe</a>.</p>`,
    ].join(""),
  },
  WEBSHOP_STOCK_ALERT_CONFIRM: {
    subject: "Confirm your notification request",
    bodyHtml: [
      `<p>You asked us to tell you when this arrives again: <strong>${v("ertesites_targya")}</strong>.</p>`,
      "<p>The request starts once you confirm it with the button below. Until then, we do not write about it.</p>",
      `<p data-cta=""><a href="{{ertesites_megerosito_link}}">Confirm the request</a></p>`,
      `<p>The link works until ${v("megerosites_lejarat")}. If it was not you, there is nothing to do: without a confirmation, you get no mail about it.</p>`,
      `<p>No more notifications about this? <a href="{{ertesites_leiratkozo_link}}">Unsubscribe</a></p>`,
    ].join(""),
  },
  WEBSHOP_STOCK_ALERT_ARRIVAL: {
    subject: "It has arrived: {{ertesites_targya}}",
    bodyHtml: [
      `<p>You asked us to tell you when this arrives again: <strong>${v("ertesites_targya")}</strong>. Available now:</p>`,
      `<p><strong>${v("ertesites_termek_neve")}</strong></p>`,
      `<p data-cta=""><a href="{{ertesites_termek_link}}">Take a look</a></p>`,
      "<p>This is our only mail for this request. To hear about the next piece too, ask again.</p>",
      `<p>No more notifications about this? <a href="{{ertesites_leiratkozo_link}}">Unsubscribe</a></p>`,
    ].join(""),
  },
  WEBSHOP_SHIPPING_DELAYED: {
    subject: "Your order's delivery is delayed (#{{rendeles_szam}})",
    bodyHtml: [
      top(
        "SHIPPING DELAY",
        "Your order's delivery is delayed",
        v("rendeles_szamok"),
        EN,
      ),
      "<p>Your order can be shipped later than expected, because not every item has reached us yet.</p>",
      `<p>We have NOT charged your card. The ${v("zarolt_osszeg")} hold placed when you ordered has been released; when this shows on your statement depends on your bank.</p>`,
      "<p>As soon as your order is ready, we will email you a payment link. We ship the parcel after payment.</p>",
      own("bolti_rendeles_mondat"),
      own("rendeles_tetelek"),
      EN.contact,
    ].join(""),
  },
  WEBSHOP_PAYMENT_LINK: paymentLink(
    "PAYMENT",
    "You can pay for your order now",
    "You can pay for your order now (#{{rendeles_szam}})",
    EN,
  ),
  WEBSHOP_PAYMENT_REMINDER: paymentLink(
    "REMINDER",
    "You can still pay for your order",
    "Reminder: you can still pay for your order (#{{rendeles_szam}})",
    EN,
  ),
  WEBSHOP_REFUND: {
    subject: "Refund for your order #{{rendeles_szam}}",
    bodyHtml: [
      `<p>We have refunded ${v("visszaterites_osszege")} ${v("kartya_megnevezes")} for your order #${v("rendeles_szam")}.</p>`,
      own("eddigi_visszaterites_mondat"),
      "<p>The time the refund takes to show up depends on your bank.</p>",
    ].join(""),
  },
};

/**
 * The default of a webshop key, or `null` for any other key. An English twin
 * (`<KEY>_EN`) gets the English default.
 */
export function webshopDefaultTemplate(
  id: string,
): WebshopDefaultTemplate | null {
  const english = id.endsWith(WEBSHOP_ENGLISH_KEY_SUFFIX);
  const table = (english ? RAW_EN : RAW) as Readonly<
    Record<string, { subject: string; bodyHtml: string }>
  >;
  const raw =
    table[english ? id.slice(0, -WEBSHOP_ENGLISH_KEY_SUFFIX.length) : id];
  if (!raw) return null;
  return {
    subject: raw.subject,
    bodyHtml: raw.bodyHtml,
    body: richHtmlToText(raw.bodyHtml, { hrefPlaceholders: LINK_NAMES }),
  };
}
