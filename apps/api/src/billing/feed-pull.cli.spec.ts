import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { main } from "./feed-pull.cli.js";
import {
  diagnoseQueryFailure,
  ownNumberKnown,
  pullFromSzamlazz,
  type FeedPullDeps,
} from "./feed-pull.js";

/*
  THE MISSING FEED INVOICE PULLED FROM SZÁMLÁZZ.HU (aeddb2c3; Balázs's live run 2026-11-05: ACRW-2026/00469 paired on
  the GLS page, "nincs a Számlázz.hu feedben" for the paid-marking). WHAT TURNS THIS RED: the dry run writes; the
  apply does not store the answer as a feed message, or stores it under another id or hash; another invoice's answer
  is stored in place of the asked one; a "not found" or an error stored; the report carries the buyer (the full XML
  stays out of the output); a malformed number queried.
*/
const szamla = (number: string) => `<?xml version="1.0" encoding="UTF-8"?>
<szamla xmlns="http://www.szamlazz.hu/szamla">
  <szallito><id>1</id><nev>Acropora Kft.</nev>
    <cim><irsz>1106</irsz><telepules>Budapest</telepules><cim>Pesti Gábor utca 35.</cim></cim>
    <adoszam>23916229-2-42</adoszam></szallito>
  <alap><id>4469</id><szamlaszam>${number}</szamlaszam><gazdEsemAzon>1</gazdEsemAzon><forras>34</forras>
    <tipus>SZ</tipus><eszamla>1</eszamla>
    <kelt>2026-09-08</kelt><telj>2026-09-08</telj><fizh>2026-09-08</fizh>
    <fizmod>Utánvét</fizmod><fizmodunified>utánvét</fizmodunified><keszpenz>false</keszpenz>
    <nyelv>hu</nyelv><devizanem>Ft</devizanem><penzforg>false</penzforg>
    <kata>false</kata><katafokonyv>false</katafokonyv><teszt>false</teszt></alap>
  <vevo><nev>Kitalált Vevő</nev>
    <cim><orszag>HU</orszag><irsz>1031</irsz><telepules>Budapest</telepules><cim>Minta utca 1.</cim></cim>
    <lokacio>1</lokacio><privatePersonIndicator>true</privatePersonIndicator></vevo>
  <tetelek>
    <tetel><nev>Áramoltató</nev><mennyiseg>1.0</mennyiseg><mennyisegiegyseg>db</mennyisegiegyseg>
      <nettoegysegar>22756.0</nettoegysegar><afakulcs>27</afakulcs><netto>22756.0</netto><afa>6144.0</afa>
      <brutto>28900.0</brutto><sztetordering>1</sztetordering></tetel>
  </tetelek>
  <osszegek><afakulcsossz><afakulcs>27</afakulcs><netto>22756.0</netto><afa>6144.0</afa><brutto>28900.0</brutto></afakulcsossz>
    <totalossz><netto>22756.0</netto><afa>6144.0</afa><brutto>28900.0</brutto></totalossz></osszegek>
</szamla>`;
const notFound = `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz"><sikeres>false</sikeres><hibakod>7</hibakod><hibauzenet>nincs</hibauzenet></xmlszamlavalasz>`;

function fake(answers: Record<string, string>) {
  const queries: string[] = [];
  const stored: { externalId: string; sha256: string; body: string }[] = [];
  const projected: string[] = [];
  const deps: FeedPullDeps = {
    agentKey: async () => "kulcs-teszt",
    client: {
      queryDocument: async (xml: string) => {
        queries.push(xml);
        const number = /<szamlaszam>([^<]*)<\/szamlaszam>/.exec(xml)?.[1] ?? "";
        const answer = answers[number];
        if (answer === undefined) throw new TypeError("network");
        return answer;
      },
    },
    store: async (input) => {
      stored.push(input);
      return "NEW";
    },
    project: async (externalId) => {
      projected.push(externalId);
      return "PROJECTED";
    },
  };
  return { deps, queries, stored, projected };
}

describe("feed-pull", () => {
  it("dry: queries by the exact number, reads the answer like a pushed feed message, and writes nothing", async () => {
    const { deps, queries, stored, projected } = fake({
      "ACRW-2026/00469": szamla("ACRW-2026/00469"),
    });
    const lines = await pullFromSzamlazz(["ACRW-2026/00469"], false, deps);
    assert.match(queries[0]!, /<szamlaszam>ACRW-2026\/00469<\/szamlaszam>/);
    assert.deepEqual(stored, []);
    assert.deepEqual(projected, []);
    assert.equal(lines[0]!.outcome, "WOULD_STORE");
    assert.equal(
      lines[0]!.detail,
      "SZ, bruttó 28900.0 HUF, fizetve 0.00, kifizetések elem nélkül",
    );
  });

  it("apply: stores the answer as a feed message under its Számlázz.hu id and hash, then projects it", async () => {
    const body = szamla("ACRW-2026/00469");
    const { deps, stored, projected } = fake({ "ACRW-2026/00469": body });
    const lines = await pullFromSzamlazz(["ACRW-2026/00469"], true, deps);
    assert.deepEqual(stored, [
      {
        externalId: "4469",
        sha256: createHash("sha256").update(body).digest("hex"),
        body,
      },
    ]);
    assert.deepEqual(projected, ["4469"]);
    assert.equal(lines[0]!.outcome, "STORED");
  });

  it("stores nothing for a number Számlázz.hu does not have, an error, or an answer naming another invoice", async () => {
    const { deps, stored } = fake({
      "ACRW-2026/00436": notFound,
      "ACRW-2026/00419": szamla("ACRW-2026/00420"),
    });
    const lines = await pullFromSzamlazz(
      ["ACRW-2026/00436", "ACRW-2026/00419", "ACRW-2026/00070"],
      true,
      deps,
    );
    assert.deepEqual(
      lines.map((l) => l.outcome),
      ["NOT_FOUND", "OTHER_NUMBER", "ERROR"],
    );
    assert.deepEqual(stored, []);
  });

  // acrobot 57804: a 2026-11-19-i kör mind az 542 számra "nincs ilyen szám"-ot rögzített, és az ok nem látszott
  it("the detail names the Számlázz.hu's own error code and wording, and a number that exists is WOULD_STORE", async () => {
    const { deps } = fake({
      "2026/00058": szamla("2026/00058"),
      "2026/00001": notFound,
      "2026/00002": `<xmlszamlavalasz><sikeres>false</sikeres><hibakod>3</hibakod><hibauzenet>Hibás\n  kulcs</hibauzenet></xmlszamlavalasz>`,
      "2026/00003": `<xmlszamlavalasz><sikeres>false</sikeres><hibakod>7</hibakod></xmlszamlavalasz>`,
    });
    const lines = await pullFromSzamlazz(
      ["2026/00058", "2026/00001", "2026/00002", "2026/00003"],
      false,
      deps,
    );
    assert.deepEqual(
      lines.map((l) => [l.number, l.outcome]),
      [
        ["2026/00058", "WOULD_STORE"],
        ["2026/00001", "NOT_FOUND"],
        ["2026/00002", "ERROR"],
        ["2026/00003", "NOT_FOUND"],
      ],
    );
    assert.equal(
      lines[1]!.detail,
      "a Számlázz.hu 7-es hibakóddal felelt: nincs",
    );
    assert.equal(
      lines[2]!.detail,
      "a Számlázz.hu hibát jelzett (hibakód 3): Hibás kulcs",
    );
    assert.equal(
      lines[3]!.detail,
      "a Számlázz.hu 7-es hibakóddal felelt (üzenet nélkül)",
    );
  });

  it("the report carries no buyer, and a malformed number is not queried", async () => {
    const { deps, queries } = fake({
      "ACRW-2026/00469": szamla("ACRW-2026/00469"),
    });
    let out = "";
    assert.equal(await main(["ACRW-2026/00469"], (t) => (out += t), deps), 0);
    assert.doesNotMatch(out, /Kitalált Vevő|Minta utca/);
    assert.match(out, /SZÁRAZ \(nem ír\): 1 szám/);
    assert.equal(await main(["2026-00083"], () => {}, deps), 2);
    assert.equal(await main([], () => {}, deps), 2);
    assert.equal(queries.length, 1);
  });
});

/*
  A KONTROLL BUKÁSÁNAK DIAGNOSZTIKÁJA (acrobot 57902: a feed legnagyobb száma sem kapott választ a Számlázz.hu-tól, 7-es hibakóddal).
  MI PIROSÍT: ha a diagnosztika nem kérdezi ugyanazt a számot a kiírt `<pdf>false</pdf>` elemmel; ha a PDF-lekérés kimarad (az élesben
  működő művelet, amihez az XML-lekérdezés mérhető); ha az OS által kiállított számra nem kérdez; ha a válasz XML-je (vevő, tételek)
  a kimenetbe kerül; ha egy hálózati hiba kivételként kiszalad.
*/
describe("diagnoseQueryFailure", () => {
  const pdfOk = `<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz"><sikeres>true</sikeres><pdf>JVBERg==</pdf></xmlszamlavalasz>`;
  const code7 = `<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz"><sikeres>false</sikeres><hibakod>7</hibakod><hibauzenet>Hiányzó adat: számla xml</hibauzenet></xmlszamlavalasz>`;

  function setup(input: {
    xml: (number: string, hasPdfFlag: boolean) => string | Error;
    pdf?: (number: string) => string | Error;
    own?: string | null;
  }) {
    const queries: { number: string; hasPdfFlag: boolean }[] = [];
    const pdfs: string[] = [];
    const deps: FeedPullDeps = {
      agentKey: async () => "kulcs-teszt",
      client: {
        queryDocument: async (xml: string) => {
          const number =
            /<szamlaszam>([^<]*)<\/szamlaszam>/.exec(xml)?.[1] ?? "";
          const hasPdfFlag = xml.includes("<pdf>false</pdf>");
          queries.push({ number, hasPdfFlag });
          const answer = input.xml(number, hasPdfFlag);
          if (answer instanceof Error) throw answer;
          return answer;
        },
      },
      ...(input.pdf
        ? {
            pdf: {
              downloadInvoicePdf: async (xml: string) => {
                const number =
                  /<szamlaszam>([^<]*)<\/szamlaszam>/.exec(xml)?.[1] ?? "";
                pdfs.push(number);
                const answer = input.pdf!(number);
                if (answer instanceof Error) throw answer;
                const { parseSzamlazzAgentXmlResponse } =
                  await import("../integrations/szamlazz/szamlazz-agent-xml.js");
                return parseSzamlazzAgentXmlResponse(answer);
              },
            },
          }
        : {}),
      ...(input.own !== undefined
        ? { ownIssuedNumber: async () => input.own ?? null }
        : {}),
      store: async () => "NEW",
      project: async () => "PROJECTED",
    };
    return { deps, queries, pdfs };
  }

  it("asks the same number with the written pdf flag, by the PDF route, and an OS-issued number both ways", async () => {
    const { deps, queries, pdfs } = setup({
      xml: (number) => (number === "E-2026-5" ? szamla("E-2026-5") : code7),
      pdf: (number) => (number === "2026/00090" ? pdfOk : code7),
      own: "E-2026-5",
    });
    const lines = await diagnoseQueryFailure("2026/00090", deps);
    assert.deepEqual(queries, [
      { number: "2026/00090", hasPdfFlag: true },
      { number: "E-2026-5", hasPdfFlag: false },
    ]);
    assert.deepEqual(pdfs, ["2026/00090", "E-2026-5"]);
    assert.deepEqual(lines, [
      "2026/00090, XML-lekérdezés kiírt <pdf>false</pdf> elemmel: 7-es hibakód: Hiányzó adat: számla xml",
      "2026/00090, PDF-lekérés: megvan (PDF 4 bájt)",
      "az OS által kiállított E-2026-5, XML-lekérdezés: megvan (E-2026-5)",
      "az OS által kiállított E-2026-5, PDF-lekérés: hibakód 7: Hiányzó adat: számla xml",
    ]);
  });

  it("the output carries no buyer or line data from a found document", async () => {
    const { deps } = setup({
      xml: (number) => szamla(number),
      own: "E-2026-5",
    });
    const lines = await diagnoseQueryFailure("2026/00090", deps);
    assert.doesNotMatch(lines.join("\n"), /Pesti Gábor|Acropora Kft|23916229/);
  });

  it("a network error on one question is a line, not an exception, and the others still run", async () => {
    const { deps, queries } = setup({
      xml: (number) =>
        number === "2026/00090" ? new TypeError("network") : code7,
      own: "E-2026-5",
    });
    const lines = await diagnoseQueryFailure("2026/00090", deps);
    assert.match(lines[0]!, /nem olvasható válasz \(TypeError\)/);
    assert.equal(queries.length, 2);
  });

  it("without a PDF client or an OS-issued number it says so and does not invent one", async () => {
    const { deps } = setup({ xml: () => code7, own: null });
    const lines = await diagnoseQueryFailure("2026/00090", deps);
    assert.equal(lines.length, 2);
    assert.equal(lines[1], "OS által kiállított számlaszám: nincs ilyen sor");
  });
});

/*
  A KULCS LÁTJA-E A SAJÁT SZÁMÁT (acrobot 58095: a kontroll 7-esét csak ez teszi "nem a mi fiókunk"-ká). MI PIROSÍT: ha a
  megtalált saját számra nem igaz jön; ha a 7-es válaszra igaz jön (a kulcs hibája is 7-et adna); ha nincs saját számla, és
  mégis ítél (null a helyes: nem tudni); ha a hálózati hiba kivétel lesz, vagy ha a kérés NEM a saját számot kérdezi.
*/
describe("ownNumberKnown", () => {
  const code7 = `<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz"><sikeres>false</sikeres><hibakod>7</hibakod><hibauzenet>Hiányzó adat: számla xml</hibauzenet></xmlszamlavalasz>`;
  const deps = (
    answer: (number: string) => string | Error,
    own: string | null,
  ): { deps: FeedPullDeps; asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      deps: {
        agentKey: async () => "kulcs-teszt",
        client: {
          queryDocument: async (xml: string) => {
            const number =
              /<szamlaszam>([^<]*)<\/szamlaszam>/.exec(xml)?.[1] ?? "";
            asked.push(number);
            const result = answer(number);
            if (result instanceof Error) throw result;
            return result;
          },
        },
        ownIssuedNumber: async () => own,
        store: async () => "NEW",
        project: async () => "PROJECTED",
      },
    };
  };

  it("true when the key finds the invoice the OS issued, and it asks that number, nothing else", async () => {
    const { deps: d, asked } = deps((number) => szamla(number), "E-2026-5");
    assert.equal(await ownNumberKnown(d), true);
    assert.deepEqual(asked, ["E-2026-5"]);
  });

  it("false when even the OS's own invoice answers 7 (a broken key proves nothing about the other numbers)", async () => {
    const { deps: d } = deps(() => code7, "E-2026-5");
    assert.equal(await ownNumberKnown(d), false);
  });

  it("null when there is no OS-issued invoice to ask, and a network error is thrown to the caller (the service turns it into null)", async () => {
    const none = deps(() => code7, null);
    assert.equal(await ownNumberKnown(none.deps), null);
    assert.deepEqual(none.asked, []);
    const broken = deps(() => new TypeError("network"), "E-2026-5");
    await assert.rejects(ownNumberKnown(broken.deps), TypeError);
  });
});
