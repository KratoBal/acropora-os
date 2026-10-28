import { escapeXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import {
  SZAMLA_NAMESPACE,
  SzamlazzFeedParseError,
  parseXmlTree,
  textAt,
} from "../missing-invoices/szamlazz-feed-xml.js";

/**
 * A KIÁLLÍTOTT BIZONYLAT LEKÉRDEZÉSE A SZÁMLÁZZ.HU-N (Számla Agent, "Query
 * document (XML)", `action-szamla_agent_xml`). CSAK OLVAS: a Számlázz.hu-ban
 * semmit nem változtat, és kiállítást nem indít.
 *
 * ELSŐDLEGES FORRÁS: docs.szamlazz.hu/agent/querying_xml/{request,xml,response}
 * (letöltve 2026-10-28; a letöltő összefoglalót adott, nem szó szerinti
 * szöveget, ezért az első élő olvasás a valódi igazolás). A kérés gyökere
 * `xmlszamlaxml` (névtér http://www.szamlazz.hu/xmlszamlaxml), a gyerek-
 * elemek FIX sorrendben: szamlaagentkulcs, szamlaszam, rendelesSzam, pdf,
 * szamlaKulsoAzon. Egy bizonylatot a számlaszám, a rendelésszám VAGY a külső
 * azonosító jelöl; mi csak az egyiket küldjük, a `pdf`-et soha (a lekérdezés
 * ne hozzon le PDF-et, és ne kerüljön semmi személyes adat a válaszból
 * tárolásra).
 *
 * A VÁLASZ: siker esetén egy teljes `szamla` dokumentum; ha nincs ilyen
 * számlaszám / rendelésszám / külső azonosító, `xmlszamlavalasz`
 * `sikeres=false` és `hibakod=7`. A hibaválasz névterét a doksi nem mondja
 * meg, ezért a gyökérnevet nézzük, a névteret nem.
 *
 * AMIT A VÁLASZBÓL TAROLUNK: csak a számlaszámot, a keltet, a nettó és bruttó
 * végösszeget, a bizonylat típusát és a hibakódot (acrobot, 2026-10-28). A
 * teljes XML-t (vevő, tételek) nem őrizzük meg és nem naplózzuk.
 */
export type SzamlazzQueryKey =
  { by: "externalId"; value: string } | { by: "invoiceNumber"; value: string };

/** A kérés. A sorrend az XSD-é: a kulcs, majd (egyetlen) azonosító. */
export function buildSzamlazzQueryXml(input: {
  agentKey: string;
  key: SzamlazzQueryKey;
}): string {
  const value = escapeXml(input.key.value);
  const identifier =
    input.key.by === "invoiceNumber"
      ? `<szamlaszam>${value}</szamlaszam>`
      : `<szamlaKulsoAzon>${value}</szamlaKulsoAzon>`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<xmlszamlaxml xmlns="http://www.szamlazz.hu/xmlszamlaxml" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlaxml https://www.szamlazz.hu/szamla/docs/xsds/agentxml/xmlszamlaxml.xsd">' +
    `<szamlaagentkulcs>${escapeXml(input.agentKey)}</szamlaagentkulcs>` +
    identifier +
    "</xmlszamlaxml>"
  );
}

/** A "nincs ilyen szám / rendelésszám / külső azonosító" hibakód a doksiban. */
export const SZAMLAZZ_NOT_FOUND_CODE = "7";

export type SzamlazzQueryResult =
  | {
      outcome: "FOUND";
      invoiceNumber: string;
      /** `alap.tipus`: SZ, ES, VS, HS, SS, JS, D, SL. */
      kindCode: string | null;
      /** `alap.kelt`, ÉÉÉÉ-HH-NN (az időzóna-utótag nélkül), ha olvasható. */
      issueDate: string | null;
      netTotal: string | null;
      grossTotal: string | null;
    }
  | { outcome: "NOT_FOUND" }
  | { outcome: "ERROR"; errorCode: string | null };

/**
 * A válasz értelmezése. Ismeretlen gyökérelem vagy hibás XML hibát dob
 * (`SzamlazzFeedParseError`): az nem "nincs találat", és a hívó "nem tudjuk"-ként
 * kezeli. Siker csak akkor, ha a `szamla` dokumentumnak van számlaszáma.
 */
export function parseSzamlazzQueryResponse(body: string): SzamlazzQueryResult {
  const root = parseXmlTree(body);
  if (root.name === "xmlszamlavalasz") {
    const successful = textAt(root, "sikeres");
    if (successful === "true")
      // siker-jelzés számlaszám nélkül nem bizonylat: nem találat és nem szám
      throw new SzamlazzFeedParseError(
        "xmlszamlavalasz siker, de nem szamla dokumentum",
      );
    const errorCode = textAt(root, "hibakod");
    return errorCode === SZAMLAZZ_NOT_FOUND_CODE
      ? { outcome: "NOT_FOUND" }
      : { outcome: "ERROR", errorCode };
  }
  if (root.name !== "szamla")
    throw new SzamlazzFeedParseError("ismeretlen gyökérelem");
  const namespace = /xmlns="([^"]*)"/.exec(root.attributes)?.[1];
  if (namespace && namespace !== SZAMLA_NAMESPACE)
    throw new SzamlazzFeedParseError("idegen névtér");
  const invoiceNumber = textAt(root, "alap", "szamlaszam");
  if (!invoiceNumber)
    throw new SzamlazzFeedParseError("a szamla dokumentumban nincs számlaszám");
  return {
    outcome: "FOUND",
    invoiceNumber,
    kindCode: textAt(root, "alap", "tipus"),
    issueDate:
      /^\d{4}-\d{2}-\d{2}/.exec(textAt(root, "alap", "kelt") ?? "")?.[0] ??
      null,
    netTotal: textAt(root, "osszegek", "totalossz", "netto"),
    grossTotal: textAt(root, "osszegek", "totalossz", "brutto"),
  };
}
