import {
  WEBSHOP_PROFORMA_DUE_DAYS,
  szamlazzUnitNetFromGross,
  webshopProformaExpired,
  type BillingDocumentDetail,
  type BillingDocumentStatus,
  type WebshopOrderProforma,
  type BillingDocumentDraftInput,
  type BillingDocumentLineInput,
  type WebshopOrderStatus,
} from "@acropora/types";

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

/** A számlán álló fizetési mód (a Számlázz.hu ezt a szöveget írja ki). */
export function invoicePaymentMethodOf(order: MedusaOrderDetailRow): string {
  // az utánvétnek csak munkamenete van a leadáskor: a rekordra várva a
  // számlán „Átutalás” állt volna (mérve a stage-en, 2026-10-06)
  const provider = orderPaymentProviderId(order.payment_collections?.[0]);
  if (provider === "pp_stripe_stripe") return "Bankkártya";
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
  input: { customerId: string; now: Date },
): InvoiceDraftResult {
  const currency = (order.currency_code ?? "huf").toUpperCase();
  const lines: BillingDocumentLineInput[] = [];
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
      message: `A számla tételei (${invoiceGross} ${currency}) nem adják ki a rendelés végösszegét (${orderTotal} ${currency}). Valószínűleg kedvezmény vagy jóváírás áll a rendelésen, amit a tételek nem viselnek; a számla nem készül el.`,
    };
  const today = budapestDayKey(input.now);
  return {
    ok: true,
    difference,
    draft: {
      id: invoiceDraftIdOf(order.id),
      documentType: "INVOICE",
      invoiceFormat: "ELECTRONIC",
      customerId: input.customerId,
      fulfillmentDate: today,
      dueDate: today,
      paymentMethod: invoicePaymentMethodOf(order),
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
  input: { customerId: string; now: Date },
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
    expired: webshopProformaExpired(
      { status: row.status, dueDate },
      budapestDayKey(now),
    ),
  };
}
