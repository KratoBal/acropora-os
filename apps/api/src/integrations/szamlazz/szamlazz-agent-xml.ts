import { SaxesParser } from "saxes";

/**
 * A Számlázz.hu Agent API XML alakja.
 *
 * ELSŐDLEGES FORRÁS: a hivatalos XSD (letöltve 2026-09-24,
 * https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd) és a
 * docs.szamlazz.hu/agent/generating_invoice/{request,response,xml} oldalak,
 * lásd exchange/szamlazz-agent-doksi/. NEM kitalált alak -- ahol a séma és a
 * dokumentáció eltér, a séma a mérvadó (acrobot kikötése, 23127).
 *
 * A MEZŐSORREND KÖTÖTT: a docs kifejezetten kimondja, hogy a mezők sorrendje
 * a beküldött XML-ben rögzített, nem cserélhető fel. A builder ezért NEM egy
 * objektum bejárásával épít, hanem a séma sorrendjét követő, egyenkénti
 * összefűzéssel -- ugyanaz a minta, mint a NAV `buildEnvelopeXml`-nél
 * (nav-xml.util.ts).
 */

export function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function tag(
  name: string,
  value: string | number | boolean | undefined,
): string {
  if (value === undefined) return "";
  return `<${name}>${typeof value === "string" ? escapeXml(value) : value}</${name}>`;
}

export interface SzamlazzAgentBuyer {
  name: string;
  country?: string;
  zip: string;
  city: string;
  address: string;
  email?: string;
  sendEmail?: boolean;
  taxNumber?: string;
  phone?: string;
  comment?: string;
}

export interface SzamlazzAgentItem {
  name: string;
  externalId?: string;
  quantity: number;
  unit: string;
  netUnitPrice: number;
  vatRatePercent: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  comment?: string;
}

/**
 * A HÍVÓ SZÁNDÉKA, NEM A TELJES XSD.
 *
 * Csak azok a mezők szerepelnek, amiket a karbantartási piszkozat-számla
 * ténylegesen kitölt (ADR-014, 4. szelet). A `fuvarlevel` (szállítólevél) és
 * a fuvarozó-specifikus blokkok (TOF/PPP/Sprinter/MPL) szándékosan nincsenek
 * benne -- a docs is kimondja, hogy ezek nélkül a teljes tag kihagyandó, és
 * karbantartási munkánál soha nem releváns.
 */
export interface SzamlazzAgentInvoiceInput {
  agentKey: string;
  /** `true`: valódi előnézeti PDF, bizonylat NEM készül. `false`/hiányzó: valódi kiállítás. */
  previewOnly?: boolean;
  /** ISO 8601 dátum (yyyy-MM-dd) mind a háromhoz. */
  paymentDueDate: string;
  fulfillmentDate: string;
  paymentMethod: string;
  currency: string;
  comment?: string;
  /** A Számlázz.hu saját külső azonosítója (`rendelesSzam`) -- a teljesítési igazolás száma. */
  orderNumber?: string;
  seller: {
    bank?: string;
    bankAccount?: string;
  };
  buyer: SzamlazzAgentBuyer;
  items: SzamlazzAgentItem[];
}

export function buildSzamlazzAgentInvoiceXml(
  input: SzamlazzAgentInvoiceInput,
): string {
  const settings =
    tag("szamlaagentkulcs", input.agentKey) +
    tag("eszamla", true) +
    tag("szamlaLetoltes", true) +
    // valaszVerzio=2: strukturált XML válasz, a base64 PDF-fel együtt --
    // lásd generating_invoice_response.txt. Az 1-es (szöveg/PDF) alak nem
    // adna gépileg elemezhető sikeres/hiba jelzést.
    tag("valaszVerzio", 2);

  const header =
    tag("teljesitesDatum", input.fulfillmentDate) +
    tag("fizetesiHataridoDatum", input.paymentDueDate) +
    tag("fizmod", input.paymentMethod) +
    tag("penznem", input.currency) +
    tag("szamlaNyelve", "hu") +
    (input.comment === undefined ? "" : tag("megjegyzes", input.comment)) +
    (input.orderNumber === undefined
      ? ""
      : tag("rendelesSzam", input.orderNumber)) +
    // elonezetpdf: lásd a fejlecTipus doc-commentjét a séma 128. sorában:
    // "bizonylat előnézeti pdf (bizonylat nem készül)". Csak akkor kerül a
    // kimenetbe, ha kifejezetten kértük -- a mező hiánya a valódi kiállítás.
    (input.previewOnly ? tag("elonezetpdf", true) : "");

  const seller =
    (input.seller.bank === undefined ? "" : tag("bank", input.seller.bank)) +
    (input.seller.bankAccount === undefined
      ? ""
      : tag("bankszamlaszam", input.seller.bankAccount));

  const buyer =
    tag("nev", input.buyer.name) +
    (input.buyer.country === undefined
      ? ""
      : tag("orszag", input.buyer.country)) +
    tag("irsz", input.buyer.zip) +
    tag("telepules", input.buyer.city) +
    tag("cim", input.buyer.address) +
    (input.buyer.email === undefined ? "" : tag("email", input.buyer.email)) +
    (input.buyer.sendEmail === undefined
      ? ""
      : tag("sendEmail", input.buyer.sendEmail)) +
    (input.buyer.taxNumber === undefined
      ? ""
      : tag("adoszam", input.buyer.taxNumber)) +
    (input.buyer.phone === undefined
      ? ""
      : tag("telefonszam", input.buyer.phone)) +
    (input.buyer.comment === undefined
      ? ""
      : tag("megjegyzes", input.buyer.comment));

  const items = input.items
    .map(
      (item) =>
        "<tetel>" +
        tag("megnevezes", item.name) +
        (item.externalId === undefined
          ? ""
          : tag("azonosito", item.externalId)) +
        tag("mennyiseg", item.quantity) +
        tag("mennyisegiEgyseg", item.unit) +
        tag("nettoEgysegar", item.netUnitPrice) +
        tag("afakulcs", item.vatRatePercent) +
        tag("nettoErtek", item.netAmount) +
        tag("afaErtek", item.vatAmount) +
        tag("bruttoErtek", item.grossAmount) +
        (item.comment === undefined ? "" : tag("megjegyzes", item.comment)) +
        "</tetel>",
    )
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">` +
    `<beallitasok>${settings}</beallitasok>` +
    `<fejlec>${header}</fejlec>` +
    `<elado>${seller}</elado>` +
    `<vevo>${buyer}</vevo>` +
    `<tetelek>${items}</tetelek>` +
    `</xmlszamla>`
  );
}

export const SZAMLAZZ_AGENT_XML_ERROR_CODES = [
  "SZAMLAZZ_AGENT_RESPONSE_INVALID",
] as const;
export type SzamlazzAgentXmlErrorCode =
  (typeof SZAMLAZZ_AGENT_XML_ERROR_CODES)[number];

export class SzamlazzAgentXmlError extends Error {
  constructor(
    readonly code: SzamlazzAgentXmlErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SzamlazzAgentXmlError";
  }
}

/**
 * A válasz -- lásd generating_invoice_response.txt "Successful/Unsuccessful
 * request" példáit és a hozzájuk tartozó XSD-t.
 *
 * `invoiceNumber` MINDIG hiányozhat: `elonezetpdf=true` mellett a doksi
 * szerint bizonylat nem készül, tehát számot sem kapunk -- a hívó ezt a
 * mezőt SOHA nem olvassa piszkozat-kéréshez (lásd
 * maintenance-invoice-draft.service.ts).
 */
export interface SzamlazzAgentResponse {
  successful: boolean;
  errorCode?: string;
  errorMessage?: string;
  invoiceNumber?: string;
  netTotal?: number;
  grossTotal?: number;
  customerAccountUrl?: string;
  /** A base64 `<pdf>` már bájtokra dekódolva. */
  pdf?: Buffer;
}

interface XmlNode {
  name: string;
  text: string;
  children: XmlNode[];
}

function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((item) => item.name === name);
}

function text(node: XmlNode, name: string): string | undefined {
  const value = child(node, name)?.text.trim();
  return value === undefined || value === "" ? undefined : value;
}

function num(node: XmlNode, name: string): number | undefined {
  const value = text(node, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A válasz XML SAX-elemzése, a NAV `parseXml` mintájára
 * (nav-xml.util.ts) -- SZÁNDÉKOSAN KÜLÖN MÁSOLAT, nem megosztott import: a
 * három integráció (UNAS, NAV, Számlázz) hitelesítője és alacsony szintű
 * elemzője is külön él (lásd medusa-connection.types.ts doc-commentjét
 * ugyanerről az elvről), amíg valaki külön körben nem dönt a közös
 * szolgáltatásról.
 */
function parseXmlDocument(xml: string): XmlNode {
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tagInfo) => {
    const node: XmlNode = { name: tagInfo.name, text: "", children: [] };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  parser.on("text", (value) => {
    const current = stack.at(-1);
    if (current) current.text += value;
  });
  parser.on("cdata", (value) => {
    const current = stack.at(-1);
    if (current) current.text += value;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    throw new SzamlazzAgentXmlError(
      "SZAMLAZZ_AGENT_RESPONSE_INVALID",
      error instanceof Error ? error.message : undefined,
    );
  }
  if (roots.length !== 1 || roots[0]!.name !== "xmlszamlavalasz")
    throw new SzamlazzAgentXmlError("SZAMLAZZ_AGENT_RESPONSE_INVALID");
  return roots[0]!;
}

export function parseSzamlazzAgentXmlResponse(
  xml: string,
): SzamlazzAgentResponse {
  const root = parseXmlDocument(xml);
  const successfulText = text(root, "sikeres");
  if (successfulText === undefined)
    throw new SzamlazzAgentXmlError("SZAMLAZZ_AGENT_RESPONSE_INVALID");
  const successful = successfulText === "true";

  const pdfBase64 = text(root, "pdf");

  return {
    successful,
    errorCode: text(root, "hibakod"),
    errorMessage: text(root, "hibauzenet"),
    invoiceNumber: text(root, "szamlaszam"),
    netTotal: num(root, "szamlanetto"),
    grossTotal: num(root, "szamlabrutto"),
    customerAccountUrl: text(root, "vevoifiokurl"),
    pdf: pdfBase64 === undefined ? undefined : Buffer.from(pdfBase64, "base64"),
  };
}
