import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { main } from "./feed-pull.cli.js";
import { pullFromSzamlazz, type FeedPullDeps } from "./feed-pull.js";

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
