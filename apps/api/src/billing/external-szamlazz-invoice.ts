import { Prisma } from "@acropora/database";

import {
  SZAMLA_NAMESPACE,
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

/**
 * EGY SZÁMLÁZZ.HU-BÓL KAPOTT KIMENŐ SZÁMLA, AHOGY A SZÁMLÁZÁS LISTÁJA ÉS
 * ADATLAPJA MUTATJA (acrobot 25812). A forrás a `szamla.xsd` szerinti nyers
 * üzenet (SzamlazzFeedMessage, kind SZAMLAKI); ez a leképezés TISZTA FÜGGVÉNY,
 * a tárolás a hívóé.
 *
 * A MEZŐK (szamla.xsd):
 *
 *   alap.id            externalId (a Számlázz.hu azonosítója, a változatok kulcsa)
 *   alap.szamlaszam    documentNumber
 *   alap.tipus         kindCode, nyersen (a felirat: EXTERNAL_KIND_LABELS)
 *   alap.eszamla       electronic (1: e-számla)
 *   alap.kelt          issueDate      (xs:date, az időzóna-utótag nélkül)
 *   alap.telj          fulfillmentDate
 *   alap.fizh          dueDate
 *   alap.fizmod        paymentMethod
 *   alap.devizanem     currency (a forint minden írásmódja HUF, lásd #1355)
 *   alap.sztornozott   cancelled
 *   vevo.nev, vevo.adoszam (vagy adoszameu), vevo.cim
 *                      customerName, customerTaxNumber, customerAddress
 *   tetelek.tetel[]    lines, a számla sorrendjében
 *   osszegek.totalossz netAmount, vatAmount, grossAmount
 *   kifizetesek.kifizetes[]
 *                      payments, és belőlük paidAmount (összeg) és lastPaidAt
 *                      (a legkésőbbi dátum). A Számlázz.hu egy kifizetés után
 *                      újraküldi a számlát (acrobot 25894, élesen mérve), és a
 *                      saját banki párosítása is ide ír; az igazság ez.
 *
 * A KÖTELEZŐ MEZŐK (az XSD szerint is kötelezők) hiányánál a leképezés HIBÁT
 * DOB: egy fél számla a listán rosszabb, mint egy, ami nincs ott (a nyers
 * üzenet megmarad, és a hiba naplózódik).
 */
export interface ExternalInvoiceLine {
  name: string;
  quantity: string;
  unit: string;
  unitNet: string;
  /** A kulcs, ahogy a számlán áll (27, 5, AAM, TAM, ...). */
  vatRate: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
}

/** Egy kifizetés, ahogy a számlán áll (szamla.xsd `kifizetes`). */
export interface ExternalInvoicePayment {
  date: string;
  /** A jogcím, nyersen (átutalás, készpénz, utánvét, ...). */
  method: string;
  amount: string;
  note: string | null;
  /** A Számlázz.hu banki párosításának azonosítója, ha onnan jött. */
  bankTransactionId: string | null;
}

export interface ExternalInvoiceProjection {
  externalId: string;
  kindCode: string;
  documentNumber: string;
  electronic: boolean;
  issueDate: string;
  fulfillmentDate: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  currency: string;
  customerName: string;
  customerTaxNumber: string | null;
  customerAddress: string | null;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  lines: ExternalInvoiceLine[];
  cancelled: boolean;
  payments: ExternalInvoicePayment[];
  /** A kifizetések összege, két tizedesre. */
  paidAmount: string;
  /** A legkésőbbi kifizetés napja; kifizetés nélkül `null`. */
  lastPaidAt: string | null;
}

/**
 * A SZÁMLÁZZ.HU BIZONYLATTÍPUSAI. A forrás a kimenő számlák dokumentációjának
 * minta-XML-je (docs.szamlazz.hu/hu/penzugyi-adatkapcsolat/kimeno-szamlak; az XSD
 * maga csak `string`-et mond): külön kódtábla nincs, ez a nyolc kód van leírva.
 * Ismeretlen kódnál a felület a nyers kódot mutatja, nem találgat.
 */
export const EXTERNAL_KIND_LABELS: Readonly<Record<string, string>> = {
  SZ: "Számla",
  SS: "Sztornó számla",
  JS: "Jóváíró számla",
  HS: "Helyesbítő számla",
  ES: "Előlegszámla",
  VS: "Végszámla",
  D: "Díjbekérő",
  SL: "Szállítólevél",
};

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function number(value: string | null, field: string): string {
  if (!value || !NUMBER.test(value) || !Number.isFinite(Number(value)))
    throw new SzamlazzFeedParseError(`a(z) ${field} nem szám`);
  return value;
}

function required(root: XmlElement, ...path: string[]): string {
  const value = textAt(root, ...path);
  if (!value)
    throw new SzamlazzFeedParseError(`hiányzó mező: ${path.join(".")}`);
  return value;
}

function day(value: string | null): string | null {
  return value ? xsDateDay(value) : null;
}

function payment(kifizetes: XmlElement, index: number): ExternalInvoicePayment {
  const field = (name: string) => `kifizetes[${index + 1}].${name}`;
  const date = day(required(kifizetes, "datum"));
  if (!date)
    throw new SzamlazzFeedParseError(`a(z) ${field("datum")} nem dátum`);
  return {
    date,
    method: required(kifizetes, "jogcim"),
    amount: number(textAt(kifizetes, "osszeg"), field("osszeg")),
    note: textAt(kifizetes, "megjegyzes"),
    bankTransactionId: textAt(kifizetes, "banktranzid"),
  };
}

function address(cim: XmlElement | undefined): string | null {
  if (!cim) return null;
  const parts = [
    textAt(cim, "irsz"),
    textAt(cim, "telepules"),
    textAt(cim, "cim"),
  ].filter((part): part is string => Boolean(part));
  const country = textAt(cim, "orszag");
  if (country && country.toUpperCase() !== "HU" && country !== "Magyarország")
    parts.unshift(country);
  return parts.length ? parts.join(" ") : null;
}

function line(tetel: XmlElement, index: number): ExternalInvoiceLine {
  const field = (name: string) => `tetel[${index + 1}].${name}`;
  return {
    name: required(tetel, "nev"),
    quantity: number(textAt(tetel, "mennyiseg"), field("mennyiseg")),
    unit: textAt(tetel, "mennyisegiegyseg") ?? "",
    unitNet: number(textAt(tetel, "nettoegysegar"), field("nettoegysegar")),
    vatRate: required(tetel, "afakulcs"),
    netAmount: number(textAt(tetel, "netto"), field("netto")),
    vatAmount: number(textAt(tetel, "afa"), field("afa")),
    grossAmount: number(textAt(tetel, "brutto"), field("brutto")),
  };
}

export function projectExternalInvoice(xml: string): ExternalInvoiceProjection {
  const root = rootOf(xml, "szamla", SZAMLA_NAMESPACE);
  const externalId = required(root, "alap", "id");
  if (!/^-?\d{1,10}$/.test(externalId))
    throw new SzamlazzFeedParseError("az id nem egész");
  const issueDate = day(required(root, "alap", "kelt"));
  if (!issueDate) throw new SzamlazzFeedParseError("a kelt nem dátum");
  const tetelek = child(root, "tetelek");
  const lines = (tetelek?.children ?? [])
    .filter((element) => element.name === "tetel")
    .map(line);
  const truthy = (value: string | null) => value === "true" || value === "1";
  const payments = (child(root, "kifizetesek")?.children ?? [])
    .filter((element) => element.name === "kifizetes")
    .map(payment);
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
    customerName: required(root, "vevo", "nev"),
    customerTaxNumber:
      textAt(root, "vevo", "adoszam") ?? textAt(root, "vevo", "adoszameu"),
    customerAddress: address(child(child(root, "vevo"), "cim")),
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
    lines,
    cancelled: truthy(textAt(root, "alap", "sztornozott")),
    payments,
    paidAmount: payments
      .reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0))
      .toFixed(2),
    lastPaidAt: payments.reduce<string | null>(
      (last, p) => (last === null || p.date > last ? p.date : last),
      null,
    ),
  };
}
