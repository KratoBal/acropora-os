import {
  SZAMLABE_NAMESPACE,
  SzamlazzFeedParseError,
  child,
  rootOf,
  textAt,
  type XmlElement,
} from "../missing-invoices/szamlazz-feed-xml.js";
import {
  szamlazzCurrency,
  xsDateDay,
} from "../missing-invoices/szamlazz-values.js";
import {
  address,
  day,
  line,
  number,
  required,
  type ExternalInvoiceLine,
} from "./external-szamlazz-invoice.js";

/**
 * EGY SZÁMLÁZZ.HU-BÓL KAPOTT BEJÖVŐ SZÁMLA, AHOGY A SZÁMLÁZÁS „BEJÖVŐ SZÁMLÁK”
 * NÉZETE MUTATJA (Balázs újraterv-promptja, acrobot 25869). A forrás a
 * `szamlabe.xsd` szerinti nyers üzenet (SzamlazzFeedMessage, kind SZAMLABE); ez
 * a leképezés TISZTA FÜGGVÉNY, a tárolás a hívóé.
 *
 * A MEZŐK (szamlabe.xsd):
 *
 *   alap.id, szamlaszam, tipus, eszamla       azonosító, szám, típus, e-számla
 *   alap.kelt, telj, fizh                     kelt, teljesítés, határidő
 *   alap.fizmod                               fizetési mód
 *   alap.devizanem, devizaarf, devizabank     pénznem (Ft -> HUF), árfolyam, bank
 *   alap.megjegyzes, rendelesszam             megjegyzés, rendelésszám
 *   alap.hivszamlaszam, hivdijbekszam         hivatkozott számla és díjbekérő
 *   alap.sztornozott, teszt                   sztornózott; a teszt-számla NEM vetül
 *   szallito.nev, cim, adoszam, adoszameu, bank.bankszamla
 *   vevo.nev, adoszam                          a mi adataink, ahogy a számlán állnak
 *   tetelek.tetel[]                            a tételek, sorrendben
 *   osszegek.afakulcsossz[], totalossz         ÁFA-kulcsonként és összesen
 *   kifizetesek.kifizetes[]                    dátum, jogcím, összeg, banki tranzakció
 *
 * A KIFIZETÉSEK HIÁNYA NEM AZONOS A „NEM FIZETETT”-TEL: a `kifizetesek` elem
 * opcionális. A `paymentsKnown` mondja meg, hogy a Számlázz.hu küldött-e róla
 * adatot; a felület ebből dönt, nem a nulla összegből.
 */
export interface IncomingVatSummary {
  vatRate: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
}

export interface IncomingPayment {
  date: string;
  title: string;
  amount: string;
  note: string | null;
  bankTransactionId: string | null;
}

export interface IncomingInvoiceProjection {
  externalId: string;
  kindCode: string;
  documentNumber: string;
  electronic: boolean;
  issueDate: string;
  fulfillmentDate: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  currency: string;
  exchangeRate: string | null;
  exchangeBank: string | null;
  supplierName: string;
  supplierTaxNumber: string | null;
  supplierEuTaxNumber: string | null;
  supplierAddress: string | null;
  supplierBankAccount: string | null;
  buyerName: string;
  buyerTaxNumber: string | null;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  lines: ExternalInvoiceLine[];
  vatSummary: IncomingVatSummary[];
  paymentsKnown: boolean;
  payments: IncomingPayment[];
  note: string | null;
  orderNumber: string | null;
  referencedInvoiceNumber: string | null;
  referencedProformaNumber: string | null;
  cancelled: boolean;
}

/** A teszt-számla nem vetül (a Hiányzó számlák forrásai közé sem kerül). */
export class IncomingTestInvoice extends Error {}

const children = (element: XmlElement | undefined, name: string) =>
  (element?.children ?? []).filter((c) => c.name === name);

function payment(kifizetes: XmlElement, index: number): IncomingPayment {
  const date = xsDateDay(required(kifizetes, "datum"));
  if (!date)
    throw new SzamlazzFeedParseError(
      `a(z) kifizetes[${index + 1}].datum nem dátum`,
    );
  return {
    date,
    title: required(kifizetes, "jogcim"),
    amount: number(
      textAt(kifizetes, "osszeg"),
      `kifizetes[${index + 1}].osszeg`,
    ),
    note: textAt(kifizetes, "megjegyzes"),
    bankTransactionId: textAt(kifizetes, "banktranzid"),
  };
}

function vatRow(row: XmlElement, index: number): IncomingVatSummary {
  const field = (name: string) => `afakulcsossz[${index + 1}].${name}`;
  return {
    vatRate: required(row, "afakulcs"),
    netAmount: number(textAt(row, "netto"), field("netto")),
    vatAmount: number(textAt(row, "afa"), field("afa")),
    grossAmount: number(textAt(row, "brutto"), field("brutto")),
  };
}

export function projectIncomingInvoice(xml: string): IncomingInvoiceProjection {
  const root = rootOf(xml, "szamlabe", SZAMLABE_NAMESPACE);
  const truthy = (value: string | null) => value === "true" || value === "1";
  if (truthy(textAt(root, "alap", "teszt")))
    throw new IncomingTestInvoice("teszt-számla");
  const externalId = required(root, "alap", "id");
  if (!/^-?\d{1,10}$/.test(externalId))
    throw new SzamlazzFeedParseError("az id nem egész");
  const issueDate = day(required(root, "alap", "kelt"));
  if (!issueDate) throw new SzamlazzFeedParseError("a kelt nem dátum");
  const rate = textAt(root, "alap", "devizaarf");
  const kifizetesek = child(root, "kifizetesek");
  const szallito = child(root, "szallito");
  return {
    externalId,
    kindCode: required(root, "alap", "tipus"),
    documentNumber: required(root, "alap", "szamlaszam"),
    electronic: textAt(root, "alap", "eszamla") === "1",
    issueDate,
    fulfillmentDate: day(textAt(root, "alap", "telj")),
    dueDate: day(textAt(root, "alap", "fizh")),
    paymentMethod: textAt(root, "alap", "fizmod"),
    currency: szamlazzCurrency(required(root, "alap", "devizanem")),
    exchangeRate: rate ? number(rate, "devizaarf") : null,
    exchangeBank: textAt(root, "alap", "devizabank"),
    supplierName: required(root, "szallito", "nev"),
    supplierTaxNumber: textAt(root, "szallito", "adoszam"),
    supplierEuTaxNumber: textAt(root, "szallito", "adoszameu"),
    supplierAddress: address(child(szallito, "cim")),
    supplierBankAccount: textAt(root, "szallito", "bank", "bankszamla"),
    buyerName: required(root, "vevo", "nev"),
    buyerTaxNumber:
      textAt(root, "vevo", "adoszam") ?? textAt(root, "vevo", "adoszameu"),
    netAmount: number(
      textAt(root, "osszegek", "totalossz", "netto"),
      "totalossz.netto",
    ),
    vatAmount: number(
      textAt(root, "osszegek", "totalossz", "afa"),
      "totalossz.afa",
    ),
    grossAmount: number(
      textAt(root, "osszegek", "totalossz", "brutto"),
      "totalossz.brutto",
    ),
    lines: children(child(root, "tetelek"), "tetel").map(line),
    vatSummary: children(child(root, "osszegek"), "afakulcsossz").map(vatRow),
    paymentsKnown: kifizetesek !== undefined,
    payments: children(kifizetesek, "kifizetes").map(payment),
    note: textAt(root, "alap", "megjegyzes"),
    orderNumber: textAt(root, "alap", "rendelesszam"),
    referencedInvoiceNumber: textAt(root, "alap", "hivszamlaszam"),
    referencedProformaNumber: textAt(root, "alap", "hivdijbekszam"),
    cancelled: truthy(textAt(root, "alap", "sztornozott")),
  };
}
