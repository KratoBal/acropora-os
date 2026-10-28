import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSzamlazzQueryXml,
  parseSzamlazzQueryResponse,
} from "./billing-szamlazz-query.js";

/**
 * A SZÁMLÁZZ.HU LEKÉRDEZÉS KÉRÉSE ÉS VÁLASZA (docs.szamlazz.hu/agent/querying_xml,
 * letöltve 2026-10-28). Mi pirosít: a kérés elemeinek sorrendje (az XSD fix
 * sorrendet kér), két azonosító egyszerre egy kérésben, a `pdf` elem a kérésben
 * (a lekérdezés ne hozzon le PDF-et), a külső azonosító kiszökése az XML-ből;
 * a válaszban: a 7-es hibakód más hibának olvasása és fordítva, egy siker-
 * jelzés számlaszám nélkül, egy ismeretlen gyökér találatként.
 */
const SZAMLA = (body: string, ns = ' xmlns="http://www.szamlazz.hu/szamla"') =>
  `<?xml version="1.0" encoding="UTF-8"?><szamla${ns}>${body}</szamla>`;
const FOUND_BODY =
  "<alap><id>1</id><szamlaszam>E-TST-2026-7</szamlaszam><tipus>SZ</tipus><kelt>2026-10-27</kelt></alap>" +
  "<vevo><nev>Kitalált Vevő</nev></vevo>" +
  "<osszegek><totalossz><netto>1000</netto><afa>270</afa><brutto>1270</brutto></totalossz></osszegek>";

describe("buildSzamlazzQueryXml", () => {
  it("a kulcs után egyetlen azonosítót küld: a külső azonosítót", () => {
    const xml = buildSzamlazzQueryXml({
      agentKey: "k1",
      key: { by: "externalId", value: "doc-1" },
    });
    assert.match(
      xml,
      /<xmlszamlaxml xmlns="http:\/\/www\.szamlazz\.hu\/xmlszamlaxml"/,
    );
    assert.match(
      xml,
      /<szamlaagentkulcs>k1<\/szamlaagentkulcs><szamlaKulsoAzon>doc-1<\/szamlaKulsoAzon><\/xmlszamlaxml>$/,
    );
    assert.doesNotMatch(xml, /szamlaszam|rendelesSzam|<pdf>/);
  });

  it("számlaszám szerint a szamlaszam elemet küldi, külső azonosító nélkül", () => {
    const xml = buildSzamlazzQueryXml({
      agentKey: "k1",
      key: { by: "invoiceNumber", value: "E-TST-2026-7" },
    });
    assert.match(
      xml,
      /<szamlaszam>E-TST-2026-7<\/szamlaszam><\/xmlszamlaxml>$/,
    );
    assert.doesNotMatch(xml, /szamlaKulsoAzon|<pdf>/);
  });

  it("az azonosító és a kulcs XML-védett", () => {
    const xml = buildSzamlazzQueryXml({
      agentKey: "a&b",
      key: { by: "externalId", value: "x</szamlaKulsoAzon><pdf>true</pdf>" },
    });
    assert.match(xml, /<szamlaagentkulcs>a&amp;b</);
    assert.doesNotMatch(xml, /<pdf>/);
  });
});

describe("parseSzamlazzQueryResponse", () => {
  it("a talált dokumentumból csak a számot, típust, keltet és végösszeget veszi ki", () => {
    const result = parseSzamlazzQueryResponse(SZAMLA(FOUND_BODY));
    assert.deepEqual(result, {
      outcome: "FOUND",
      invoiceNumber: "E-TST-2026-7",
      kindCode: "SZ",
      issueDate: "2026-10-27",
      netTotal: "1000",
      grossTotal: "1270",
    });
    assert.doesNotMatch(JSON.stringify(result), /Kitalált Vevő/);
  });

  it("a 7-es hibakód: nincs ilyen azonosító (névtér nélkül és névtérrel is)", () => {
    const body =
      "<xmlszamlavalasz><sikeres>false</sikeres><hibakod>7</hibakod><hibauzenet>Missing data</hibauzenet></xmlszamlavalasz>";
    assert.deepEqual(parseSzamlazzQueryResponse(body), {
      outcome: "NOT_FOUND",
    });
    assert.deepEqual(
      parseSzamlazzQueryResponse(
        body.replace(
          "<xmlszamlavalasz>",
          '<xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz">',
        ),
      ),
      { outcome: "NOT_FOUND" },
    );
  });

  it("más hibakód NEM nincs-találat", () => {
    assert.deepEqual(
      parseSzamlazzQueryResponse(
        "<xmlszamlavalasz><sikeres>false</sikeres><hibakod>3</hibakod></xmlszamlavalasz>",
      ),
      { outcome: "ERROR", errorCode: "3" },
    );
    assert.deepEqual(
      parseSzamlazzQueryResponse(
        "<xmlszamlavalasz><sikeres>false</sikeres></xmlszamlavalasz>",
      ),
      { outcome: "ERROR", errorCode: null },
    );
  });

  it("siker-jelzés számlaszám nélkül, ismeretlen gyökér, szám nélküli szamla és idegen névtér hibát dob", () => {
    for (const body of [
      "<xmlszamlavalasz><sikeres>true</sikeres></xmlszamlavalasz>",
      "<valami><x>1</x></valami>",
      SZAMLA("<alap><tipus>SZ</tipus></alap>"),
      SZAMLA(FOUND_BODY, ' xmlns="http://idegen.example/ns"'),
      "ez nem is xml",
      "",
    ])
      assert.throws(() => parseSzamlazzQueryResponse(body), body);
  });
});
