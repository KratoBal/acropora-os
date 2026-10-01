/**
 * A SZÁMLÁZZ.HU SZÁMLA- ÉS NYUGTA-TOVÁBBÍTÁS ÜZENETEI (online pénzügyi
 * adatkapcsolat; acrobot 25686, eredetileg nautilusnak 25659). A szerződés a
 * hivatalos XSD (`exchange/szamlazz-xsd/`, 2026-10-01):
 *
 *   szamlabe   egy NEKÜNK kiállított számla (bejövő), `szamlabe.xsd`; a PDF a
 *              `pdf` elemben, ha a fiókban `pdfszamlabe = igen`
 *   szamla     egy általunk kiállított számla (kimenő), `szamla.xsd`
 *   nyugta     kérés-XSD NINCS: csak nyers tárolás
 *
 *   válasz     `szamlabevalasz` / `szamlavalasz`: az `alap.id` visszaadva (a
 *              Számlázz.hu leírása szerint a kapott azonosítót vissza kell adni),
 *              hibánál `hibakod` (KEY_ERR | KEY_DEL); `nyugtavalasz` csak hibakódot
 *              hordoz.
 *
 * A `szamlabe` sémája BEÁGYAZOTT (a `cim` típusnak is van `cim` eleme), ezért a
 * banki üzenet lapos olvasója nem elég rá. Ez egy kicsi fa-olvasó: elemek,
 * szöveg, CDATA és a megjegyzés; DOCTYPE, ENTITY és feldolgozási utasítás (az
 * XML-deklaráción kívül) elutasítva, tehát külső entitást (XXE) nem nyit.
 * TISZTA FÜGGVÉNYEK, hálózat és adatbázis nélkül.
 */

import { szamlazzCurrency, xsDateDay } from "./szamlazz-values.js";

export class SzamlazzFeedParseError extends Error {}

/**
 * Egy kérés felső határa. A PDF base64-ben jön az XML-ben (a 15 MB-os számla
 * felső határunk egyharmaddal nagyobb lesz), és a tételek mellette.
 */
export const SZAMLAZZ_FEED_MAX_BYTES = 24 * 1024 * 1024;

export interface XmlElement {
  readonly name: string;
  readonly attributes: string;
  readonly children: XmlElement[];
  text: string;
}

function decodeEntities(raw: string): string {
  return raw.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);|&/g,
    (whole, ref?: string) => {
      if (!ref) throw new SzamlazzFeedParseError("csupasz & a szövegben");
      if (ref === "amp") return "&";
      if (ref === "lt") return "<";
      if (ref === "gt") return ">";
      if (ref === "quot") return '"';
      if (ref === "apos") return "'";
      const code = ref.startsWith("#x")
        ? Number.parseInt(ref.slice(2), 16)
        : Number(ref.slice(1));
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff)
        throw new SzamlazzFeedParseError("érvénytelen karakter-hivatkozás");
      void whole;
      return String.fromCodePoint(code);
    },
  );
}

/** Az egész dokumentum fája; a gyökérelemet adja vissza (névtér-előtag nélküli névvel). */
export function parseXmlTree(xml: string): XmlElement {
  if (xml.length > SZAMLAZZ_FEED_MAX_BYTES)
    throw new SzamlazzFeedParseError("túl nagy üzenet");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new SzamlazzFeedParseError("DOCTYPE és ENTITY nem megengedett");
  const doc = xml.replace(/^﻿/, "").replace(/^\s*<\?xml[^>]*\?>/, "");
  if (/<\?/.test(doc))
    throw new SzamlazzFeedParseError("feldolgozási utasítás nem megengedett");

  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  const token =
    /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\s*>|<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
  for (const m of doc.matchAll(token)) {
    const [
      whole,
      cdata,
      closing,
      opening,
      attributes,
      selfClosing,
      text,
      stray,
    ] = m;
    if (whole.startsWith("<!--")) continue;
    if (stray) throw new SzamlazzFeedParseError("hibás jelölés");
    const top = stack[stack.length - 1];
    if (cdata !== undefined) {
      if (!top) throw new SzamlazzFeedParseError("szöveg a gyökérelemen kívül");
      top.text += cdata;
      continue;
    }
    if (text !== undefined) {
      if (!top) {
        if (text.trim())
          throw new SzamlazzFeedParseError("szöveg a gyökérelemen kívül");
        continue;
      }
      top.text += decodeEntities(text);
      continue;
    }
    if (closing) {
      if (!top || top.name !== closing)
        throw new SzamlazzFeedParseError(`nem várt záró elem: ${closing}`);
      stack.pop();
      continue;
    }
    if (root && stack.length === 0)
      throw new SzamlazzFeedParseError("egynél több gyökérelem");
    const element: XmlElement = {
      name: opening!,
      attributes: attributes ?? "",
      children: [],
      text: "",
    };
    if (top) top.children.push(element);
    else root = element;
    if (!selfClosing) stack.push(element);
  }
  if (!root || stack.length > 0)
    throw new SzamlazzFeedParseError("hiányos dokumentum");
  return root;
}

/** Az elem névtere (az alapértelmezett `xmlns`), ha meg van adva. */
function namespaceOf(element: XmlElement): string | null {
  return element.attributes.match(/xmlns\s*=\s*"([^"]*)"/)?.[1] ?? null;
}

function child(
  element: XmlElement | undefined,
  name: string,
): XmlElement | undefined {
  const found = element?.children.filter((c) => c.name === name) ?? [];
  if (found.length > 1)
    throw new SzamlazzFeedParseError(`ismételt elem: ${name}`);
  return found[0];
}

function textAt(
  element: XmlElement | undefined,
  ...path: string[]
): string | null {
  let at = element;
  for (const name of path) at = child(at, name);
  const value = at?.text.trim();
  return value ? value : null;
}

/** A dokumentum gyökere a várt néven és névtérrel. */
export function rootOf(
  xml: string,
  name: string,
  namespace: string,
): XmlElement {
  const root = parseXmlTree(xml);
  if (root.name !== name)
    throw new SzamlazzFeedParseError(`a gyökérelem nem ${name}`);
  const ns = namespaceOf(root);
  if (ns && ns !== namespace) throw new SzamlazzFeedParseError("idegen névtér");
  return root;
}

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Egy bejövő számla, amennyit a Hiányzó számlák párosítója használ. */
export interface SzamlabeMessage {
  /** A Számlázz.hu belső azonosítója (`alap.id`): ezt kell visszaadni. */
  readonly id: string;
  readonly szamlaszam: string;
  /** ÉÉÉÉ-HH-NN */
  readonly kelt: string;
  readonly devizanem: string;
  /** A teljes bruttó, az XML szövege változatlanul. */
  readonly brutto: string;
  readonly szallitoNev: string;
  readonly szallitoAdoszam: string;
  readonly vevoNev: string;
  readonly vevoAdoszam: string | null;
  readonly vevoAdoszamEu: string | null;
  readonly teszt: boolean;
  readonly sztornozott: boolean;
  /** A `pdf` elem szövege, nyersen; a kódolását a hívó ellenőrzi. */
  readonly pdf: string | null;
}

export const SZAMLABE_NAMESPACE = "http://www.szamlazz.hu/szamlabe";
export const SZAMLA_NAMESPACE = "http://www.szamlazz.hu/szamla";

const truthy = (value: string | null) => value === "true" || value === "1";

export function parseSzamlabe(xml: string): SzamlabeMessage {
  const root = rootOf(xml, "szamlabe", SZAMLABE_NAMESPACE);
  const required = (...path: string[]) => {
    const value = textAt(root, ...path);
    if (!value)
      throw new SzamlazzFeedParseError(`hiányzó mező: ${path.join(".")}`);
    return value;
  };
  const id = required("alap", "id");
  if (!/^-?\d{1,10}$/.test(id))
    throw new SzamlazzFeedParseError("az id nem egész");
  const kelt = xsDateDay(required("alap", "kelt"));
  if (!kelt) throw new SzamlazzFeedParseError("a kelt nem dátum");
  const brutto = required("osszegek", "totalossz", "brutto");
  if (!NUMBER.test(brutto) || !Number.isFinite(Number(brutto)))
    throw new SzamlazzFeedParseError("a bruttó nem szám");
  // az XSD-ben string: a „Ft” is jó, és egy ismeretlen szöveg sem buktatja el
  // az üzenetet (lásd `szamlazzCurrency`)
  const devizanem = szamlazzCurrency(required("alap", "devizanem"));
  return {
    id,
    szamlaszam: required("alap", "szamlaszam"),
    kelt,
    devizanem,
    brutto,
    szallitoNev: required("szallito", "nev"),
    szallitoAdoszam: required("szallito", "adoszam"),
    vevoNev: required("vevo", "nev"),
    vevoAdoszam: textAt(root, "vevo", "adoszam"),
    vevoAdoszamEu: textAt(root, "vevo", "adoszameu"),
    teszt: truthy(textAt(root, "alap", "teszt")),
    sztornozott: truthy(textAt(root, "alap", "sztornozott")),
    pdf: textAt(root, "pdf"),
  };
}

/** Egy kimenő számla azonosítója és száma; a többit nyersen tároljuk. */
export function parseSzamlaKi(xml: string): { id: string; szamlaszam: string } {
  const root = rootOf(xml, "szamla", SZAMLA_NAMESPACE);
  const id = textAt(root, "alap", "id");
  if (!id || !/^-?\d{1,10}$/.test(id))
    throw new SzamlazzFeedParseError("az id hiányzik vagy nem egész");
  const szamlaszam = textAt(root, "alap", "szamlaszam");
  if (!szamlaszam)
    throw new SzamlazzFeedParseError("hiányzó mező: alap.szamlaszam");
  return { id, szamlaszam };
}

/** A nyugta: kérés-XSD nincs, csak az ellenőrzés, hogy jól formált XML. */
export function checkNyugta(xml: string): void {
  parseXmlTree(xml);
}

/**
 * A PDF a `pdf` elemben. Az XSD csak `string`-et mond, a kódolást nem; a
 * base64-et akkor fogadjuk el, ha a dekódolt bájtok PDF-fejléccel kezdődnek.
 * Másképp `null`: a hívó nyersen tárol és naplóz, nem találgat.
 */
export function pdfFromField(value: string | null): Buffer | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  const bytes = Buffer.from(compact, "base64");
  return bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) ? bytes : null;
}

type ReplyKind = "szamlabevalasz" | "szamlavalasz" | "nyugtavalasz";

/** A válasz a séma szerint: siker esetén az azonosító (ahol a séma ismeri), hibánál a kód. */
export function feedReply(
  kind: ReplyKind,
  options: { id?: string; hibakod?: "KEY_ERR" | "KEY_DEL" } = {},
): string {
  const parts: string[] = [];
  if (options.id && kind !== "nyugtavalasz")
    parts.push(`<alap><id>${options.id}</id></alap>`);
  if (options.hibakod) parts.push(`<hibakod>${options.hibakod}</hibakod>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${kind} xmlns="http://www.szamlazz.hu/${kind}">${parts.join("")}</${kind}>\n`;
}
