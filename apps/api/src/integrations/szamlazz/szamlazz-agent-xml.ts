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
  /**
   * MELYIK BIZONYLAT (Számlázás v0.1). A négy típus UGYANAZ a kérés, csak a
   * `fejlec` egy jelzője más (XSD 114, 119, 120): díjbekérő = `dijbekero`,
   * előlegszámla = `elolegszamla`, szállítólevél = `szallitolevel`, a számla
   * jelző nélkül. Hiányzó érték: számla (a karbantartási számla így hív).
   */
  documentType?: SzamlazzDocumentType;
  /**
   * `eszamla` (XSD 56, KÖTELEZŐ minden kérésben). Hiányzó: `true`, a
   * karbantartási számla eddigi viselkedése. Díjbekérőnél és szállítólevélnél
   * az adapter `false`-t ad: ott a formátum nem értelmezett (brief 32. pont).
   */
  electronic?: boolean;
  /** A díjbekérő száma, amelyből a számla vagy az előleg készül (`dijbekeroSzamlaszam`). */
  proformaNumber?: string;
  /**
   * A mi azonosítónk a Számlázz.hu-n (`szamlaKulsoAzon`). Ezzel egy ismeretlen
   * kimenetű kiállítás utólag lekérdezhető (01-es doksi): "later the invoice can
   * be queried with this key".
   */
  externalId?: string;
  /** `szamlaNyelve`; hiányzó: "hu". */
  language?: SzamlazzInvoiceLanguage;
  seller: {
    bank?: string;
    bankAccount?: string;
  };
  buyer: SzamlazzAgentBuyer;
  items: SzamlazzAgentItem[];
}

export type SzamlazzDocumentType =
  "INVOICE" | "PROFORMA" | "ADVANCE_INVOICE" | "DELIVERY_NOTE";

/** Az XSD `szamlaNyelveTipus` értékkészlete. */
export const SZAMLAZZ_INVOICE_LANGUAGES = [
  "hu",
  "en",
  "de",
  "it",
  "ro",
  "sk",
  "hr",
  "fr",
  "es",
  "cz",
  "pl",
] as const;
export type SzamlazzInvoiceLanguage =
  (typeof SZAMLAZZ_INVOICE_LANGUAGES)[number];

/** A típus jelzője a `fejlec`-ben; a számlának nincs. */
const DOCUMENT_FLAG: Record<SzamlazzDocumentType, string | null> = {
  INVOICE: null,
  PROFORMA: "dijbekero",
  ADVANCE_INVOICE: "elolegszamla",
  DELIVERY_NOTE: "szallitolevel",
};

export function buildSzamlazzAgentInvoiceXml(
  input: SzamlazzAgentInvoiceInput,
): string {
  const settings =
    tag("szamlaagentkulcs", input.agentKey) +
    tag("eszamla", input.electronic ?? true) +
    tag("szamlaLetoltes", true) +
    // valaszVerzio=2: strukturált XML válasz, a base64 PDF-fel együtt --
    // lásd generating_invoice_response.txt. Az 1-es (szöveg/PDF) alak nem
    // adna gépileg elemezhető sikeres/hiba jelzést.
    tag("valaszVerzio", 2) +
    // az XSD sorrendjében a `beallitasok` utolsó eleme
    (input.externalId === undefined
      ? ""
      : tag("szamlaKulsoAzon", input.externalId));

  const flag = DOCUMENT_FLAG[input.documentType ?? "INVOICE"];

  const header =
    tag("teljesitesDatum", input.fulfillmentDate) +
    tag("fizetesiHataridoDatum", input.paymentDueDate) +
    tag("fizmod", input.paymentMethod) +
    tag("penznem", input.currency) +
    tag("szamlaNyelve", input.language ?? "hu") +
    (input.comment === undefined ? "" : tag("megjegyzes", input.comment)) +
    (input.orderNumber === undefined
      ? ""
      : tag("rendelesSzam", input.orderNumber)) +
    (input.proformaNumber === undefined
      ? ""
      : tag("dijbekeroSzamlaszam", input.proformaNumber)) +
    // XSD 114: elolegszamla áll a dijbekero és a szallitolevel ELŐTT
    (flag === "elolegszamla" ? tag("elolegszamla", true) : "") +
    (flag === "dijbekero" ? tag("dijbekero", true) : "") +
    (flag === "szallitolevel" ? tag("szallitolevel", true) : "") +
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
    // SOHA NEM A SZÁMLÁZZ.HU KÜLDI A BIZONYLATOT (Balázs döntése, 2026-09-30,
    // Eldöntendő szál, message_id 1554826347300392992): mi kérjük le a PDF-et,
    // és mi küldjük. A doksi szerint ha a vevőnek van e-mail címe, arra a
    // Számlázz.hu elküldi a számlát; ezért a jelző NEM hívófüggő, hanem minden
    // számla-XML-ben kifejezetten false, akkor is, ha e-mail cím nincs.
    tag("sendEmail", false) +
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

/**
 * A JÓVÁÍRÁS RÖGZÍTÉSE egy általunk kiállított számlán (Számla Agent,
 * `xmlszamlakifiz`; acrobot 25989). ELSŐDLEGES FORRÁS: a hivatalos XSD
 * (https://www.szamlazz.hu/szamla/docs/xsds/agentkifiz/xmlszamlakifiz.xsd,
 * letöltve 2026-10-02) és a docs.szamlazz.hu/agent/credit_entry/{xml,response}
 * oldalak. A `beallitasok` sorrendje a sémáé: szamlaagentkulcs, szamlaszam,
 * additiv, valaszVerzio.
 *
 * AZ `additiv` MINDIG `true`: a `false` a számla ÖSSZES korábbi kifizetését
 * lecseréli a miénkre, tehát egy kézzel vagy banki párosítással rögzített
 * kifizetést csendben törölne. Ezért nem is paraméter.
 *
 * `valaszVerzio=2`: a válasz `xmlszamlavalasz`, ugyanaz az alak, mint a
 * számla-készítésé, a `kintlevoseg` (a még nyitott összeg) mezővel.
 */
export interface SzamlazzAgentPaymentInput {
  agentKey: string;
  invoiceNumber: string;
  /** Legfeljebb 5 (a séma `maxOccurs`). */
  payments: readonly {
    /** ÉÉÉÉ-HH-NN */
    date: string;
    title: string;
    /** Tizedes szöveg, pont elválasztóval. */
    amount: string;
    note?: string;
  }[];
}

export function buildSzamlazzAgentPaymentXml(
  input: SzamlazzAgentPaymentInput,
): string {
  if (input.payments.length < 1 || input.payments.length > 5)
    throw new Error("a jóváírás 1..5 kifizetést visz (xmlszamlakifiz.xsd)");
  const settings =
    tag("szamlaagentkulcs", input.agentKey) +
    tag("szamlaszam", input.invoiceNumber) +
    tag("additiv", true) +
    tag("valaszVerzio", 2);
  const payments = input.payments
    .map(
      (payment) =>
        "<kifizetes>" +
        tag("datum", payment.date) +
        tag("jogcim", payment.title) +
        tag("osszeg", payment.amount) +
        tag("leiras", payment.note) +
        "</kifizetes>",
    )
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<xmlszamlakifiz xmlns="http://www.szamlazz.hu/xmlszamlakifiz" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlakifiz https://www.szamlazz.hu/szamla/docs/xsds/agentkifiz/xmlszamlakifiz.xsd">' +
    `<beallitasok>${settings}</beallitasok>${payments}</xmlszamlakifiz>`
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
  /** A jóváírás után a még nyitott összeg (`kintlevoseg`). */
  outstanding?: number;
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
    outstanding: num(root, "kintlevoseg"),
    pdf: pdfBase64 === undefined ? undefined : Buffer.from(pdfBase64, "base64"),
  };
}
