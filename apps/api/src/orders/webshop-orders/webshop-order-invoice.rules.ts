import {
  euKey,
  huBase,
} from "../../partner-duplicates/partner-duplicate-groups.js";
import {
  WEBSHOP_INVOICE_DUE_DAYS,
  WEBSHOP_PROFORMA_DUE_DAYS,
  szamlazzDocumentTotals,
  szamlazzLineAmounts,
  szamlazzUnitNetFromGross,
  webshopProformaExpired,
  type BillingDocumentDetail,
  type BillingDocumentStatus,
  type WebshopOrderProforma,
  type BillingDocumentDraftInput,
  type BillingDocumentLineInput,
  type WebshopOrderStatus,
  type WebshopProformaAdvance,
} from "@acropora/types";

import {
  orderCreditsOf,
  type LoyaltyInvoiceShape,
} from "./webshop-order-credits.rules.js";
import type {
  MedusaOrderAddressRow,
  MedusaOrderDetailRow,
} from "../../integrations/medusa/medusa-admin.client.js";
import {
  budapestDayKey,
  startOfBudapestDay,
} from "../../dashboard/budapest-day.js";
import {
  COD_PROVIDER_ID,
  orderPaymentProviderId,
  primaryPaymentCollection,
} from "./webshop-orders.rules.js";

/**
 * A WEBSHOP RENDELÉS SZÁMLÁJA, hálózat nélkül: a Medusa rendelésből a
 * számlázás vázlata, és a vevő OS-partnerének kulcsa.
 *
 * A PÉNZ A WEBSHOPÉ. A tételek bruttó sorösszegéből (`items.total`, a
 * kedvezménnyel együtt) számoljuk vissza a nettó egységárat, a webshop saját
 * ÁFA-kulcsával (`tax_lines.rate`). A kulcsot nem találjuk ki: ha egy soron
 * nincs, a számla nem készül el.
 */

/** A rendelés vázlatának azonosítója: egy rendeléshez egy vázlat, a dupla kattintás ugyanazt kapja. */
export const invoiceDraftIdOf = (orderId: string) => `webshop-${orderId}`;

/** A rendelés szállítólevelének azonosítója: rendelésenként egy, mint a számláé. */
export const proformaDraftIdOf = (orderId: string) =>
  `webshop-proforma-${orderId}`;
export const deliveryNoteDraftIdOf = (orderId: string) =>
  `webshop-dn-${orderId}`;

/**
 * A SZÁLLÍTÓLEVÉL A KIÁLLÍTOTT SZÁMLÁBÓL (Balázs döntése, 2026-10-06, emlék
 * 2124; kártya 0a14f739 C/1). Ugyanaz a vevő, ugyanazok a tételek és
 * ugyanaz a teljesítés napja, mint a számlán: a szállítólevél nem új
 * árazás, hanem a kiszállított tételek kísérője. A rendelésből újra
 * számolni azt kockáztatná, hogy a kettő eltér; a számla sorai viszont a
 * kiállítás óta nem változnak.
 *
 * A kedvezmény-sort nem másoljuk: a számlázás a tétel kedvezmény-százalékából
 * maga képzi (`normalizeBillingDraft`). Formátum, határidő és fizetési mód
 * nincs: a szállítólevél nem fizetendő bizonylat, a Számlázz.hu kötelező
 * mezőit a kiállítás tölti ki.
 */
export function deliveryNoteDraftOf(
  orderId: string,
  invoice: BillingDocumentDetail,
):
  | { ok: true; draft: BillingDocumentDraftInput }
  | { ok: false; message: string } {
  if (invoice.status !== "ISSUED")
    return {
      ok: false,
      message:
        "A szállítólevél a kiállított számla tételeiből készül: előbb állítsd ki a számlát.",
    };
  if (!invoice.customer) return { ok: false, message: "A számlán nincs vevő." };
  const lines = invoice.lines
    .filter((line) => line.kind === "ITEM")
    .map((line): BillingDocumentLineInput => ({
      productId: line.productId,
      variantId: line.variantId ?? null,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitNet: line.unitNet,
      vatRatePercent: line.vatRatePercent,
      discountPercent: line.discountPercent,
      comment: line.comment,
    }));
  if (!lines.length) return { ok: false, message: "A számlán nincs tétel." };
  return {
    ok: true,
    draft: {
      id: deliveryNoteDraftIdOf(orderId),
      documentType: "DELIVERY_NOTE",
      invoiceFormat: null,
      customerId: invoice.customer.id,
      fulfillmentDate: invoice.fulfillmentDate,
      dueDate: null,
      paymentMethod: null,
      currency: invoice.currency,
      language: invoice.language,
      reference: invoice.reference,
      note: invoice.documentNumber ? `Számla: ${invoice.documentNumber}` : null,
      sourceType: "WEBSHOP_ORDER",
      sourceId: orderId,
      lines,
    },
  };
}

/** Ezekben az állapotokban még (vagy már) nem állítunk ki számlát. */
const NOT_INVOICEABLE: readonly WebshopOrderStatus[] = [
  "pending_processing",
  "closed_unsuccessfully",
];

export function invoiceRefusal(
  status: WebshopOrderStatus | null,
): string | null {
  if (status === null)
    return "A rendelésnek nincs státusza a webshopban, ezért a számla nem állítható ki.";
  if (status === "pending_processing")
    return "A számla a visszaigazolás után állítható ki.";
  if (NOT_INVOICEABLE.includes(status))
    return "Sikertelenül lezárt rendelésre nem állítunk ki számlát.";
  return null;
}

/**
 * A DÍJBEKÉRŐ A VISSZAIGAZOLÁS ELŐTT IS MEHET (Balázs, 2026-10-06: „Leadja a
 * rendelest es mi kuldjuk neki gombbal a dijbekerot”). A díjbekérő fizetési
 * felszólítás, nem számla, és a gombot ember nyomja meg. Sikertelenül lezárt
 * vagy státusz nélküli rendelésre viszont nem megy.
 */
export function proformaRefusal(
  status: WebshopOrderStatus | null,
): string | null {
  if (status === null)
    return "A rendelésnek nincs státusza a webshopban, ezért a díjbekérő nem küldhető.";
  if (status === "closed_unsuccessfully")
    return "Sikertelenül lezárt rendelésre nem küldünk díjbekérőt.";
  return null;
}

/**
 * THE LANGUAGE OF THE CUSTOMER'S MAIL (card d5c6befd, P4): `en` only when the shop wrote exactly that on the order
 * (commerce `storefront_locale`, set when the customer paid on the English storefront). Anything else, a missing
 * value or an old order included, is Hungarian: the mail never changes language by a guess. This is the MAIL's
 * language; the invoice PDF's language is separate and stays Hungarian (acrobot 41434-41439).
 */
export function orderLanguageOf(
  metadata: Record<string, unknown> | null | undefined,
): "hu" | "en" {
  return metadata?.storefront_locale === "en" ? "en" : "hu";
}

/**
 * A VEVŐ KULCSA A KÜLSŐ HIVATKOZÁSBAN (acrobot 4. döntése: e-mail alapján
 * keressük vagy hozzuk létre, Medusa-kötéssel). Regisztrált vevőnél a Medusa
 * vevő-azonosítója; vendégnél a kisbetűs e-mail cím, `guest:` előtaggal.
 */
export function customerKeyOf(order: MedusaOrderDetailRow): string | null {
  if (order.customer_id) return order.customer_id;
  const email = order.email?.trim().toLowerCase();
  return email ? `guest:${email}` : null;
}

const clean = (value: string | null | undefined) => value?.trim() || null;

const nameOf = (address: MedusaOrderAddressRow | null | undefined) =>
  [address?.last_name, address?.first_name]
    .map(clean)
    .filter(Boolean)
    .join(" ") || null;

/** A számlázási cím adószáma (commerce: `metadata.tax_id`, egységesítve). */
export function taxNumberOf(
  address: MedusaOrderAddressRow | null | undefined,
): string | null {
  const value = address?.metadata?.tax_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * A RENDELÉS ADÓSZÁMÁNAK KULCSA (kártya c499739d, Balázs 2026-11-11 10:54 UTC): a számlázási cím adószáma, ugyanazzal a két külön
 * fajta kulccsal, mint az egy-partnertörzs duplikátum-mérése (`partner-duplicates`): a magyar adószám első nyolc számjegye (csak magyar
 * adószám ALAKÚ értékből), vagy a közösségi adószám országkóddal, normalizálva. `null`: a rendelésen nincs adószám (magánszemély).
 * Egy `DE123456789` és egy magyar, ugyanazzal a nyolc jeggyel kezdődő szám soha nem azonos kulcs.
 */
export type OrderTaxKey =
  { kind: "HU"; value: string } | { kind: "EU"; value: string };

export function orderTaxKeyOf(order: MedusaOrderDetailRow): OrderTaxKey | null {
  const taxId = taxNumberOf(order.billing_address ?? order.shipping_address);
  if (!taxId) return null;
  const hu = huBase(taxId);
  if (hu) return { kind: "HU", value: hu };
  const eu = euKey(taxId);
  return eu ? { kind: "EU", value: eu } : null;
}

/** Az új OS-partner adatai a rendelés számlázási címéből. */
export function newCustomerOf(order: MedusaOrderDetailRow):
  | {
      ok: true;
      customer: {
        type: "PERSON" | "COMPANY";
        displayName: string;
        companyName?: string;
        taxNumber?: string;
        email?: string;
        phone?: string;
        addresses: {
          type: "BILLING";
          name?: string;
          country: string;
          postalCode: string;
          city: string;
          line1: string;
          line2?: string;
          isDefault: true;
        }[];
      };
    }
  | { ok: false; message: string } {
  const billing = order.billing_address ?? order.shipping_address;
  const postalCode = clean(billing?.postal_code);
  const city = clean(billing?.city);
  const line1 = clean(billing?.address_1);
  if (!billing || !postalCode || !city || !line1)
    return {
      ok: false,
      message:
        "A rendelésen nincs teljes számlázási cím (irányítószám, város, utca), ezért a számla nem állítható ki.",
    };
  const company = clean(billing.company);
  const person = nameOf(billing);
  const displayName = company ?? person ?? clean(order.email);
  if (!displayName)
    return {
      ok: false,
      message: "A rendelésen nincs vevőnév, ezért a számla nem állítható ki.",
    };
  const taxNumber = taxNumberOf(billing);
  const line2 = clean(billing.address_2);
  const email = clean(order.email);
  const phone = clean(billing.phone);
  return {
    ok: true,
    customer: {
      type: company ? "COMPANY" : "PERSON",
      displayName,
      ...(company ? { companyName: company } : {}),
      ...(taxNumber ? { taxNumber } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      addresses: [
        {
          type: "BILLING",
          ...(person ? { name: person } : {}),
          country: (billing.country_code ?? "hu").toUpperCase(),
          postalCode,
          city,
          line1,
          ...(line2 ? { line2 } : {}),
          isDefault: true,
        },
      ],
    },
  };
}

/** A bankkártyás (Stripe) rendelés fizetési módja a számlán: az `invoicePaymentMethodOf` ezt adja a Stripe szolgáltatóra. */
const CARD_PAYMENT_METHOD = "Bankkártya";

/** A számlán álló fizetési mód (a Számlázz.hu ezt a szöveget írja ki). */
export function invoicePaymentMethodOf(order: MedusaOrderDetailRow): string {
  // az utánvétnek csak munkamenete van a leadáskor: a rekordra várva a
  // számlán „Átutalás” állt volna (mérve a stage-en, 2026-10-06)
  const provider = orderPaymentProviderId(
    primaryPaymentCollection(order.payment_collections),
  );
  if (provider === "pp_stripe_stripe") return CARD_PAYMENT_METHOD;
  if (provider === COD_PROVIDER_ID) return "Utánvét";
  return "Átutalás";
}

/** Egy sor ÁFA-kulcsa a webshopból; több vagy hiányzó kulcsnál `null`. */
function rateOf(taxLines: { rate: number }[] | null | undefined) {
  if (!taxLines || taxLines.length !== 1) return null;
  const rate = Number(taxLines[0]!.rate);
  return Number.isFinite(rate) && rate >= 0 ? String(rate) : null;
}

/**
 * EGY ÖSSZEG A WEBSHOPBÓL, vagy `null`, ha nincs. A hiány NEM nulla: egy
 * számolt mező, amit a webshop az adott lekérdezésre nem ad, nullaként egy
 * nulla forintos számlát engedne át.
 */
const amountOf = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * A SZÁLLÍTÁS BRUTTÓJA. A `total` számolt mező, és kifejezett mezőlistával a
 * webshop nem adja (acrobot mérése a stage-en, 2026-10-05); ilyenkor a tárolt
 * `amount` a forrás: bruttó áras webshopnál (`is_tax_inclusive`) maga a
 * bruttó, nettó árasnál a kulccsal felszorozva. Ha egyik sincs, `null`: a
 * számla nem készül el.
 */
function shippingGrossOf(
  method: MedusaOrderDetailRow["shipping_methods"][number],
): number | null {
  const total = amountOf(method.total);
  if (total !== null) return total;
  const amount = amountOf(method.amount);
  if (amount === null) return null;
  if (method.is_tax_inclusive === true) return amount;
  const rate = rateOf(method.tax_lines);
  if (method.is_tax_inclusive === false && rate !== null)
    return Math.round(amount * (100 + Number(rate))) / 100;
  return null;
}

/** A bruttó sorösszeg szövegként, a pénznem tizedesein túl nem kerekítve. */
const decimalText = (value: number) => String(value);

interface SourceLine {
  description: string;
  quantity: number;
  gross: number | null;
  taxLines: { rate: number }[] | null | undefined;
  comment: string | null;
}

/**
 * A RENDELÉS SORAI A SZÁMLÁRA: a termékek, a szállítás és az utánvét díja.
 * A díjsor (`metadata.acropora_line_item_kind === "fee"`) a webshopban is
 * tételsor, és a számlán is az: „Utánvét kezelési díj”.
 */
function sourceLinesOf(order: MedusaOrderDetailRow): SourceLine[] {
  const lines: SourceLine[] = [];
  for (const item of order.items ?? []) {
    const fee = item.metadata?.acropora_line_item_kind === "fee";
    const variant =
      item.variant_title &&
      item.variant_title !== item.product_title &&
      !/^default/i.test(item.variant_title)
        ? item.variant_title
        : null;
    lines.push({
      description: fee
        ? "Utánvét kezelési díj"
        : [item.product_title || item.title, variant]
            .filter(Boolean)
            .join(" · "),
      quantity: Number(item.quantity),
      gross: amountOf(item.total),
      taxLines: item.tax_lines,
      comment:
        !fee && item.variant_sku ? `Cikkszám: ${item.variant_sku}` : null,
    });
  }
  for (const method of order.shipping_methods ?? []) {
    const gross = shippingGrossOf(method);
    if (gross === 0) continue;
    lines.push({
      description: `Szállítás: ${method.name}`,
      quantity: 1,
      gross,
      taxLines: method.tax_lines,
      comment: null,
    });
  }
  return lines;
}

/**
 * A JÓVÁÍRÁSOK SORAI A SZÁMLÁN ÉS A DÍJBEKÉRŐN (kártya e62a1a64; Balázs 2026-11-24: a B-hez is kell munka). A rendelés végösszege a
 * jóváírások UTÁN számolt, a tételek és a szállítás összege nélkülük adja ki: a különbséget egy negatív sor viszi, hogy a számla
 * bruttója a rendelés végösszege (a vevő által pénzben fizetendő) legyen.
 *
 * AZ ALAK KAPCSOLHATÓ, mert a döntés (és a könyvelő válasza) még nincs meg:
 *   `payment` (B): a jóváírás FIZETÉS. A negatív sor 0 százalékos ÁFA-kulccsal áll, tehát az ÁFA-alap a teljes ár marad, csak a
 *     fizetendő bruttó csökken. A leírás megmondja, mivel fizették ki.
 *   `discount` (ALAP, A; Balázs döntése 2026-11-24): a hűségpont ÁRENGEDMÉNY. A negatív sorok a tételek ÁFA-kulcsai szerint, a bruttójuk arányában oszlanak meg, tehát az
 *     ÁFA-alap is csökken.
 * Az AJÁNDÉKKÁRTYA mindig fizetés (az `payment` alak), a kapcsoló csak a hűségpontra vonatkozik. Ismeretlen jóváírást NEM találgatunk:
 * a számla nem készül el, mert nem tudjuk, adóalapot csökkent-e.
 * Váltás B-re: a `WEBSHOP_LOYALTY_INVOICE_SHAPE=payment` környezeti változó az OS API-n (lásd `loyaltyInvoiceShapeOf`).
 */
type CreditLinesResult =
  | { ok: true; lines: BillingDocumentLineInput[]; gross: number }
  | { ok: false; message: string };

/** A kedvezmény-sor neve: „Hűségpont kedvezmény” (a régi bolt „kedvezmény”-t írt); több ÁFA-kulcsnál a kulcs is áll rajta. */
const discountDescription = (
  points: number | null,
  rate: number,
  rateCount: number,
) =>
  `Hűségpont kedvezmény (${[points ? `${points} pont` : null, rateCount > 1 ? `${rate}% ÁFA` : null].filter(Boolean).join(", ")})`.replace(
    / \(\)$/,
    "",
  );

function creditLinesOf(
  order: MedusaOrderDetailRow,
  itemParts: { rate: number; gross: number }[],
  shape: LoyaltyInvoiceShape,
  currency: string,
): CreditLinesResult {
  const credits = orderCreditsOf(order);
  const lines: BillingDocumentLineInput[] = [];
  let gross = 0;
  const unknown = credits.find((credit) => credit.kind === "other");
  if (unknown)
    return {
      ok: false,
      message: `A rendelésen ismeretlen jóváírás áll („${unknown.label}”, ${unknown.amount} ${currency}), ezért a számla nem készül el: nem tudjuk, az ÁFA-alapot csökkenti-e.`,
    };
  const paymentLine = (description: string, amount: number) => {
    lines.push({
      productId: null,
      description,
      quantity: "1",
      // a credit line counts once: "db", said here, since the issue no longer fills an empty unit (L5, c37ea343)
      unit: "db",
      unitNet: `-${decimalText(amount)}`,
      vatRatePercent: "0",
      discountPercent: null,
      comment: null,
    });
    gross = Math.round((gross - amount) * 100) / 100;
  };
  for (const credit of credits) {
    if (credit.kind === "gift_card") {
      paymentLine("Ajándékkártyával kifizetve", credit.amount);
    } else if (shape === "payment") {
      paymentLine(
        credit.points
          ? `Hűségpontból kifizetve (${credit.points} pont)`
          : "Hűségpontból kifizetve",
        credit.amount,
      );
    } else {
      // ÁRENGEDMÉNY: kulcsonként, a tételek bruttójának arányában; az utolsó kulcs viszi a kerekítési maradékot
      const byRate = new Map<number, number>();
      for (const part of itemParts)
        byRate.set(part.rate, (byRate.get(part.rate) ?? 0) + part.gross);
      const rates = [...byRate.keys()].sort((a, b) => a - b);
      const base = rates.reduce((sum, rate) => sum + byRate.get(rate)!, 0);
      if (!(base > 0))
        return {
          ok: false,
          message:
            "A hűségpont árengedményét nincs mire felosztani: a rendelésnek nincs adóköteles tétele.",
        };
      let left = credit.amount;
      rates.forEach((rate, index) => {
        const share =
          index === rates.length - 1
            ? left
            : Math.round(((credit.amount * byRate.get(rate)!) / base) * 100) /
              100;
        left = Math.round((left - share) * 100) / 100;
        if (!(share > 0)) return;
        const amounts = rate
          ? szamlazzUnitNetFromGross({
              grossAmount: decimalText(share),
              quantity: "1",
              vatRatePercent: decimalText(rate),
              currency,
            })
          : null;
        const unitNet =
          amounts && amounts.ok ? amounts.unitNet : decimalText(share);
        const lineGross =
          amounts && amounts.ok ? Number(amounts.grossAmount) : share;
        lines.push({
          productId: null,
          description: discountDescription(credit.points, rate, rates.length),
          quantity: "1",
          // as above: "db", since the issue no longer fills an empty unit (L5, c37ea343)
          unit: "db",
          unitNet: `-${unitNet}`,
          vatRatePercent: decimalText(rate),
          discountPercent: null,
          comment: null,
        });
        gross = Math.round((gross - lineGross) * 100) / 100;
      });
    }
  }
  return { ok: true, lines, gross };
}

export type InvoiceDraftResult =
  | {
      ok: true;
      draft: BillingDocumentDraftInput;
      /** A számla bruttója mínusz a rendelés végösszege; 1 Ft alatt maradhat (fillér-kerekítés). */
      difference: number;
    }
  | { ok: false; message: string };

/**
 * A VÁZLAT A RENDELÉSBŐL. A soronkénti bruttóból visszaszámolt nettó a
 * Számlázz.hu szabályával nem mindig adja vissza pontosan a bruttót (mérve:
 * 27%-on a sorok kb. ötödénél 1 fillér az eltérés). Fillérnyi eltérés
 * megengedett; ha a számla bruttója 1 Ft-tal vagy többel tér el a rendelés
 * végösszegétől, az már nem kerekítés, hanem hiányzó vagy el nem osztott tétel
 * (például egy szállításra adott kedvezmény), és a számla nem készül el.
 */
export function invoiceDraftOf(
  order: MedusaOrderDetailRow,
  input: {
    customerId: string;
    now: Date;
    /** A hűségpont sorának alakja (kártya e62a1a64); alap `discount` (Balázs döntése), lásd `creditLinesOf`. */
    loyaltyShape?: LoyaltyInvoiceShape;
    /**
     * ÉÉÉÉ-HH-NN: the day the prepaid transfer came in (card d31a66a3, S1). The invoice of a paid transfer is fulfilled
     * and due on that day: the money is in, nothing is left to pay.
     */
    paidOn?: string;
  },
): InvoiceDraftResult {
  const currency = (order.currency_code ?? "huf").toUpperCase();
  const lines: BillingDocumentLineInput[] = [];
  const itemParts: { rate: number; gross: number }[] = [];
  let invoiceGross = 0;
  for (const source of sourceLinesOf(order)) {
    const rate = rateOf(source.taxLines);
    if (rate === null)
      return {
        ok: false,
        message: `A webshop nem adott egyértelmű ÁFA-kulcsot ehhez a tételhez: „${source.description}”. A számla nem állítható ki.`,
      };
    if (source.gross === null)
      return {
        ok: false,
        message: `A webshop nem adta meg ennek a tételnek az összegét: „${source.description}”. A számla nem állítható ki.`,
      };
    if (!(source.quantity > 0) || source.gross < 0)
      return {
        ok: false,
        message: `A tétel mennyisége vagy összege nem számlázható: „${source.description}”.`,
      };
    const amounts = szamlazzUnitNetFromGross({
      grossAmount: decimalText(source.gross),
      quantity: String(source.quantity),
      vatRatePercent: rate,
      currency,
    });
    if (!amounts.ok)
      return {
        ok: false,
        message: `A tétel nettó ára nem számolható vissza: „${source.description}” (${amounts.error}).`,
      };
    invoiceGross =
      Math.round((invoiceGross + Number(amounts.grossAmount)) * 100) / 100;
    itemParts.push({ rate: Number(rate), gross: Number(amounts.grossAmount) });
    lines.push({
      productId: null,
      description: source.description,
      quantity: String(source.quantity),
      unit: "db",
      unitNet: amounts.unitNet,
      vatRatePercent: rate,
      discountPercent: null,
      comment: source.comment,
    });
  }
  if (!lines.length)
    return { ok: false, message: "A rendelésnek nincs számlázható tétele." };
  // A JÓVÁÍRÁSOK (hűségpont, ajándékkártya) negatív sorai: a számla bruttója a rendelés végösszege (a pénzben fizetendő) legyen
  const credit = creditLinesOf(
    order,
    itemParts,
    input.loyaltyShape ?? "discount",
    currency,
  );
  if (!credit.ok) return { ok: false, message: credit.message };
  lines.push(...credit.lines);
  invoiceGross = Math.round((invoiceGross + credit.gross) * 100) / 100;
  const orderTotal = amountOf(order.total);
  if (orderTotal === null)
    return {
      ok: false,
      message:
        "A webshop nem adta meg a rendelés végösszegét, ezért a számla nem állítható ki.",
    };
  const difference = Math.round((invoiceGross - orderTotal) * 100) / 100;
  if (Math.abs(difference) >= 1)
    return {
      ok: false,
      message: `A számla tételei (${invoiceGross} ${currency}) nem adják ki a rendelés végösszegét (${orderTotal} ${currency}). Valószínűleg kedvezmény áll a rendelésen, amit a tételek nem viselnek; a számla nem készül el.`,
    };
  const today = budapestDayKey(input.now);
  // a fizetési mód a rendelés fizetési gyűjtőjének szolgáltatójából jön (`invoicePaymentMethodOf`)
  const paymentMethod = invoicePaymentMethodOf(order);
  return {
    ok: true,
    difference,
    draft: {
      id: invoiceDraftIdOf(order.id),
      documentType: "INVOICE",
      invoiceFormat: "ELECTRONIC",
      customerId: input.customerId,
      fulfillmentDate: input.paidOn ?? today,
      // A HATÁRIDŐ (Balázs, 2026-11-11 12:07 és 12:10 UTC): bankkártyás (Stripe) rendelésnél a Számlázás gombra a Stripe levonja az
      // összeget, és a számla kelte, a teljesítés napja ÉS a fizetési határidő UGYANAZ a nap: a kiállítás napja (ahogy eddig). Minden
      // más fizetési módnál (előreutalás, utánvét ...) a kiállítás napja + 8 nap, a vevő saját napjaitól függetlenül. A nap Budapest
      // szerint számít, mint a díjbekérőnél.
      // A paid transfer's invoice (S1) is due the day the money came in.
      dueDate:
        input.paidOn ??
        (paymentMethod === CARD_PAYMENT_METHOD
          ? today
          : budapestDayKey(
              startOfBudapestDay(input.now, WEBSHOP_INVOICE_DUE_DAYS),
            )),
      paymentMethod,
      currency,
      language: "hu",
      reference: `Webshop rendelés #${order.display_id}`,
      note: null,
      sourceType: "WEBSHOP_ORDER",
      sourceId: order.id,
      lines,
    },
  };
}

const comparable = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const taxComparable = (value: string | null | undefined) =>
  (value ?? "").replace(/[\s-]/g, "");

/**
 * A SZÁMLÁRA A PARTNER ADATAI KERÜLNEK, NEM A RENDELÉSÉ (a kiállítás a
 * partnerből rögzíti a vevőt). Egy e-mail alapján megtalált, régebbi partner
 * régi címmel vagy más névvel állhat az OS-ben, és akkor a számla rossz vevőre
 * szólna. Ezért kiállítás előtt összevetjük: ha a név, az adószám vagy a
 * számlázási cím eltér, a számla nem készül el, és a mondat megnevezi az
 * eltérést. A partnert a kezelő javítja; magától nem írjuk át.
 */
export function buyerMismatch(
  order: MedusaOrderDetailRow,
  buyer: {
    name: string;
    taxNumber: string | null;
    postalCode: string | null;
    city: string | null;
    line: string | null;
  },
): string | null {
  const wanted = newCustomerOf(order);
  if (!wanted.ok) return wanted.message;
  const customer = wanted.customer;
  const address = customer.addresses[0]!;
  const differences: string[] = [];
  const name = customer.companyName ?? customer.displayName;
  if (comparable(name) !== comparable(buyer.name))
    differences.push(`név: „${buyer.name}” helyett „${name}”`);
  if (taxComparable(customer.taxNumber) !== taxComparable(buyer.taxNumber))
    differences.push(
      `adószám: „${buyer.taxNumber ?? "nincs"}” helyett „${customer.taxNumber ?? "nincs"}”`,
    );
  const line = [address.line1, address.line2].filter(Boolean).join(", ");
  if (
    comparable(address.postalCode) !== comparable(buyer.postalCode) ||
    comparable(address.city) !== comparable(buyer.city) ||
    comparable(line) !== comparable(buyer.line)
  )
    differences.push(
      `cím: „${[buyer.postalCode, buyer.city].filter(Boolean).join(" ")}, ${buyer.line ?? ""}” helyett „${address.postalCode} ${address.city}, ${line}”`,
    );
  return differences.length
    ? `Az OS-partner adatai eltérnek a rendelés számlázási adataitól (${differences.join("; ")}). Javítsd a partnert, és utána állítsd ki a számlát.`
    : null;
}

/**
 * A DÍJBEKÉRŐ VÁZLATA (kártya bb3a6bd5): ugyanazok a tételek és ugyanaz az
 * ellenőrzés, mint a számlánál (a végösszegnek ki kell jönnie), csak a típus
 * PROFORMA, a fizetési mód átutalás, és a határidő 8 nap (Balázs, 2026-10-06
 * 16:32 UTC). A határidő napja Budapest szerint számít.
 */
export function proformaDraftOf(
  order: MedusaOrderDetailRow,
  input: {
    customerId: string;
    now: Date;
    loyaltyShape?: LoyaltyInvoiceShape;
  },
): InvoiceDraftResult {
  const invoice = invoiceDraftOf(order, input);
  if (!invoice.ok) return invoice;
  return {
    ...invoice,
    draft: {
      ...invoice.draft,
      id: proformaDraftIdOf(order.id),
      documentType: "PROFORMA",
      invoiceFormat: null,
      dueDate: budapestDayKey(
        startOfBudapestDay(input.now, WEBSHOP_PROFORMA_DUE_DAYS),
      ),
      paymentMethod: "Átutalás",
    },
  };
}

/**
 * AZ ELŐLEG-DÍJBEKÉRŐ (kártya d31a66a3, 2a; Balázs, 2026-11-25 10:19 UTC): nagy értékű terméknél a rendelést előre utalásra állítjuk,
 * és a díjbekérő nem a teljes összeget kéri, hanem előleget. A kezelő a végösszeg százalékát VAGY egy forintösszeget ír be.
 *
 * A SOROK: ÁFA-kulcsonként egy „Előleg” sor, a teljes díjbekérő kulcsonkénti bruttója szerint arányosan (mint az árajánlat
 * mérföldkövénél, #1634, csak bruttóból: a vevő forintban kapja meg, mennyi az előleg). A forint-maradék a legnagyobb kulcsra megy,
 * tehát a díjbekérő végösszege (a Számlázz.hu szabályával, tételenként forintra kerekítve) PONTOSAN a beírt előleg: a banki
 * párosítás erre az összegre vár.
 *
 * Amit elutasít: nem forintos rendelés; üres, nem szám, 0 vagy kisebb, a végösszeg vagy nagyobb (az már nem előleg: arra a teljes
 * díjbekérő való); egy sor, amelynek bruttója nem jön ki pontosan.
 */
export function advanceProformaDraftOf(
  order: MedusaOrderDetailRow,
  input: {
    customerId: string;
    now: Date;
    loyaltyShape?: LoyaltyInvoiceShape;
    advance: WebshopProformaAdvance;
  },
): InvoiceDraftResult {
  const full = proformaDraftOf(order, input);
  if (!full.ok) return full;
  const currency = full.draft.currency;
  if (currency !== "HUF")
    return {
      ok: false,
      message: "Előleg-díjbekérő csak forintos rendelésre készíthető.",
    };
  const total = amountOf(order.total);
  if (total === null)
    return {
      ok: false,
      message:
        "A webshop nem adta meg a rendelés végösszegét, ezért az előleg nem számolható.",
    };
  const advance = advanceAmountOf(input.advance, total);
  if (typeof advance === "string") return { ok: false, message: advance };

  // the full proforma's gross per VAT rate, its credits included (the order's total is what they add up to)
  const byRate = new Map<string, number>();
  for (const line of full.draft.lines) {
    const amounts = szamlazzLineAmounts({
      quantity: line.quantity,
      unitNet: line.unitNet,
      vatRatePercent: line.vatRatePercent,
      currency,
    });
    if (!amounts.ok)
      return {
        ok: false,
        message: `A díjbekérő egy tételének összege nem számolható: „${line.description}”.`,
      };
    const key = String(line.vatRatePercent);
    byRate.set(
      key,
      Math.round(((byRate.get(key) ?? 0) + Number(amounts.grossAmount)) * 100) /
        100,
    );
  }
  // a credit taken as a payment (points, a gift card: a negative 0% line) is no rate of the goods: the advance splits over the
  // rates that carry goods, so a rate whose lines add up to nothing or less gives no share
  const rates = [...byRate]
    .filter(([, gross]) => gross > 0)
    .sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]));
  const base = rates.reduce((sum, [, gross]) => sum + gross, 0);
  const shares = rates.map(([, gross]) => Math.floor((advance * gross) / base));
  if (shares.length)
    shares[0] = shares[0]! + advance - shares.reduce((sum, x) => sum + x, 0);

  const lines: BillingDocumentLineInput[] = [];
  for (const [i, [rate]] of rates.entries()) {
    const gross = shares[i]!;
    if (gross <= 0) continue;
    const amounts = szamlazzUnitNetFromGross({
      grossAmount: String(gross),
      quantity: "1",
      vatRatePercent: rate,
      currency,
    });
    // a forint invoice's total rounds each line to the forint (`szamlazzDocumentTotals`, what the stored total and the bank
    // pairing read): 27% of 10 000,00 comes out as 10 000,01, which is 10 000 on the proforma
    if (!amounts.ok || Math.round(Number(amounts.grossAmount)) !== gross)
      return {
        ok: false,
        message: `Az előleg ${rate}% ÁFA-kulcsú része (${gross} Ft) nem állítható elő pontosan; adj meg más összeget.`,
      };
    lines.push({
      productId: null,
      description: `${ADVANCE_LINE_PREFIX}${order.display_id}`,
      quantity: "1",
      unit: "db",
      unitNet: amounts.unitNet,
      vatRatePercent: rate,
      discountPercent: null,
      comment: null,
    });
  }
  lines.sort((a, b) => Number(b.vatRatePercent) - Number(a.vatRatePercent));
  const proformaGross = Number(
    szamlazzDocumentTotals(
      lines.map((line) => {
        const amounts = szamlazzLineAmounts({ ...line, currency });
        if (!amounts.ok) throw new Error("ADVANCE_LINE_AMOUNTS");
        return amounts;
      }),
      currency,
    ).grossAmount,
  );
  if (proformaGross !== advance)
    return {
      ok: false,
      message: `Az előleg-díjbekérő végösszege (${proformaGross} Ft) nem a beírt előleg (${advance} Ft); adj meg más összeget.`,
    };
  return { ok: true, difference: 0, draft: { ...full.draft, lines } };
}

/** Every line of an advance proforma starts so (`advanceProformaDraftOf`). */
export const ADVANCE_LINE_PREFIX = "Előleg: webshop rendelés #";

/**
 * AN ADVANCE PROFORMA, STORED ON THE DOCUMENT (card 2c5fbfb5; barracuda on #2839): the shop takes a transfer below the order as an
 * advance only when the OS says so, and the OS says so only for a proforma it made as one. The mark is the document's own tag,
 * written when the proforma's draft is saved: not the lines' text, which the billing editor may change, and not the amounts, since a
 * full proforma is also below the order's total when the order was edited after it. Nothing else reads or writes `Invoice.tags`.
 */
export const WEBSHOP_ADVANCE_TAG = "WEBSHOP_ADVANCE";

/** The document's tags with the advance mark set or cleared, the others kept. */
export const tagsWithAdvance = (
  tags: readonly string[],
  advance: boolean,
): string[] => {
  const others = tags.filter((tag) => tag !== WEBSHOP_ADVANCE_TAG);
  return advance ? [...others, WEBSHOP_ADVANCE_TAG] : others;
};

/** The advance in whole forints, or why it cannot be one. */
export function advanceAmountOf(
  advance: WebshopProformaAdvance,
  total: number,
): number | string {
  const tooLarge =
    "Az előleg nem lehet a rendelés végösszege vagy annál több: arra a teljes díjbekérő való.";
  if ("percent" in advance) {
    const text = advance.percent.trim().replace(",", ".");
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(text) || !(Number(text) > 0))
      return "Az előleg százaléka 0-nál nagyobb, 100-nál kisebb szám legyen (legfeljebb két tizedessel).";
    const amount = Math.round((total * Number(text)) / 100);
    if (amount <= 0) return "Az előleg ennél a százaléknál 0 Ft lenne.";
    return amount >= total ? tooLarge : amount;
  }
  const text = advance.amount.trim().replace(/\s/g, "");
  if (!/^\d+$/.test(text) || !(Number(text) > 0))
    return "Az előleg összege egész forint legyen, 0-nál nagyobb.";
  return Number(text) >= total ? tooLarge : Number(text);
}

/** A lista jelölése: a rendelés díjbekérője lejárt-e (nincs díjbekérő: nem). */
export function proformaExpiredOf(
  row: Parameters<typeof proformaOf>[0] | undefined,
  now: Date,
): boolean {
  return row ? proformaOf(row, now).expired : false;
}

/** A díjbekérő az adatlapon: a határidő napja és hogy lejárt-e (Budapest szerint). */
export function proformaOf(
  row: {
    id: string;
    status: BillingDocumentStatus;
    number: string | null;
    dueDate: Date | null;
    emailStatus: string | null;
    grossAmount?: { toFixed(digits: number): string } | null;
  },
  now: Date,
): WebshopOrderProforma {
  const dueDate = row.dueDate ? budapestDayKey(row.dueDate) : null;
  return {
    id: row.id,
    status: row.status as WebshopOrderProforma["status"],
    number: row.number,
    dueDate,
    emailStatus: row.emailStatus,
    grossAmount: row.grossAmount ? row.grossAmount.toFixed(4) : null,
    expired: webshopProformaExpired(
      { status: row.status, dueDate },
      budapestDayKey(now),
    ),
  };
}
