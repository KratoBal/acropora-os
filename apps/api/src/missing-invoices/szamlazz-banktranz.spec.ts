import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type {
  BankStatementImportRepository,
  IngestRow,
} from "./bank-statement-import.repository.js";
import {
  banktranzReply,
  BanktranzParseError,
  parseBanktranz,
} from "./szamlazz-banktranz.js";
import { SzamlazzBanktranzService } from "./szamlazz-banktranz.service.js";

/* A minta a banktranz.xsd szerint (nyers bajtkent merve 2026-10-01). */
const xml = (
  inner: string,
  root = 'banktranz xmlns="http://www.szamlazz.hu/banktranz"',
) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<${root}>${inner}</${root.split(" ")[0]}>`;
const FULL = xml(
  "<id>4711</id><bankszamla>11709002-20624460</bankszamla><erteknap>2026-09-25</erteknap>" +
    "<irany>KI</irany><tipus>AZONNALI FIZETÉS</tipus><technikai>false</technikai>" +
    "<osszeg>6012764.0</osszeg><devizanem>HUF</devizanem>" +
    "<partner><nev>Fluidra Magyarország Kft.</nev><bankszamla>11773016-00000000</bankszamla></partner>" +
    "<kozlemeny>KS26/08132 &amp; KS26/08382</kozlemeny>",
);

describe("parseBanktranz", () => {
  it("reads every field of the schema, entities decoded", () => {
    assert.deepEqual(parseBanktranz(FULL), {
      id: "4711",
      bankszamla: "11709002-20624460",
      erteknap: "2026-09-25",
      irany: "KI",
      tipus: "AZONNALI FIZETÉS",
      technikai: false,
      osszeg: "6012764.0",
      devizanem: "HUF",
      partnerNev: "Fluidra Magyarország Kft.",
      partnerBankszamla: "11773016-00000000",
      kozlemeny: "KS26/08132 & KS26/08382",
    });
  });

  it("takes a prefixed root, CDATA, and leaves the optional fields out", () => {
    const m = parseBanktranz(
      xml(
        "<b:id>1</b:id><b:bankszamla>1</b:bankszamla><b:erteknap>2026-09-01</b:erteknap><b:irany>BE</b:irany>" +
          "<b:technikai>1</b:technikai><b:osszeg>10</b:osszeg><b:devizanem>eur</b:devizanem>" +
          "<b:kozlemeny><![CDATA[a <b> c]]></b:kozlemeny>",
        'b:banktranz xmlns:b="http://www.szamlazz.hu/banktranz"',
      ),
    );
    assert.equal(m.kozlemeny, "a <b> c");
    assert.equal(m.technikai, true);
    assert.equal(m.devizanem, "EUR");
    assert.equal(m.partnerNev, null);
    assert.equal(m.tipus, null);
  });

  it("refuses DOCTYPE and entities, a foreign root or namespace, unknown or repeated elements", () => {
    // a DOCTYPE-ot a saját őrzője fogja meg, nem csak a gyökér-illesztés
    for (const decl of [
      `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>`,
      `<!ENTITY e "x">`,
    ])
      assert.throws(
        () => parseBanktranz(FULL.replace("<banktranz", `${decl}<banktranz`)),
        /DOCTYPE és ENTITY/,
      );
    const bad = [
      `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${FULL}`,
      FULL.replace("banktranz xmlns", "nyugta xmlns").replace(
        "</banktranz>",
        "</nyugta>",
      ),
      FULL.replace("http://www.szamlazz.hu/banktranz", "http://example.com/x"),
      FULL.replace("<id>4711</id>", "<id>4711</id><szia>1</szia>"),
      FULL.replace("<id>4711</id>", "<id>4711</id><id>4712</id>"),
    ];
    for (const b of bad)
      assert.throws(
        () => parseBanktranz(b),
        BanktranzParseError,
        b.slice(0, 60),
      );
  });

  it("refuses a missing or malformed required field", () => {
    const bad = [
      FULL.replace("<id>4711</id>", ""),
      FULL.replace("<irany>KI</irany>", "<irany>OUT</irany>"),
      FULL.replace("<osszeg>6012764.0</osszeg>", "<osszeg>sok</osszeg>"),
      FULL.replace(
        "<erteknap>2026-09-25</erteknap>",
        "<erteknap>2026.09.25</erteknap>",
      ),
      FULL.replace(
        "<devizanem>HUF</devizanem>",
        "<devizanem>FORINT</devizanem>",
      ),
      FULL.replace(
        "<technikai>false</technikai>",
        "<technikai>nem</technikai>",
      ),
    ];
    for (const b of bad)
      assert.throws(() => parseBanktranz(b), BanktranzParseError);
  });

  it("the reply is an empty banktranzvalasz on success, and carries the code otherwise", () => {
    assert.match(
      banktranzReply(),
      /<banktranzvalasz xmlns="http:\/\/www\.szamlazz\.hu\/banktranzvalasz"><\/banktranzvalasz>/,
    );
    assert.match(banktranzReply("KEY_ERR"), /<hibakod>KEY_ERR<\/hibakod>/);
  });
});

const KEY = "acropora-banktranz-teszt-kulcs-abcde";

function setup(env: Record<string, string> = {}) {
  const ingested: IngestRow[][] = [];
  const repository = {
    ownAccounts: async () =>
      new Map([["1170900220624460", "1170900220624460"]]),
    ingest: async (input: { rows: IngestRow[] }) => {
      ingested.push(input.rows);
      return { importId: "imp", createdCount: 1, claimedCount: 0 };
    },
  } as unknown as BankStatementImportRepository;
  const service = new SzamlazzBanktranzService(repository, {
    SZAMLAZZ_BANKTRANZ_MODE: "live",
    SZAMLAZZ_BANKTRANZ_KEY: KEY,
    ...env,
  });
  return { service, ingested };
}

describe("SzamlazzBanktranzService", () => {
  it("off unless switched on and keyed: 404, nothing written", async () => {
    for (const env of <Record<string, string>[]>[
      { SZAMLAZZ_BANKTRANZ_MODE: "on" },
      { SZAMLAZZ_BANKTRANZ_KEY: " " },
    ]) {
      const { service, ingested } = setup(env);
      assert.deepEqual(await service.receive(KEY, FULL), {
        status: 404,
        body: "",
      });
      assert.equal(ingested.length, 0);
    }
  });

  it("a wrong, missing, shorter or longer key: KEY_ERR, nothing written", async () => {
    const { service, ingested } = setup();
    for (const key of ["rossz", undefined, KEY.slice(0, -1), `${KEY}x`]) {
      const r = await service.receive(key, FULL);
      assert.equal(r.status, 200);
      assert.match(r.body, /<hibakod>KEY_ERR<\/hibakod>/);
    }
    assert.equal(ingested.length, 0);
  });

  it("an unreadable message: 400, not acknowledged, so it is resent and seen", async () => {
    const { service, ingested } = setup();
    assert.deepEqual(await service.receive(KEY, "<banktranz/>"), {
      status: 400,
      body: "",
    });
    assert.equal(ingested.length, 0);
  });

  it("another account's transaction is acknowledged but not written", async () => {
    const { service, ingested } = setup();
    const other = FULL.replace(
      "<bankszamla>11709002-20624460</bankszamla>",
      "<bankszamla>12345678-12345678</bankszamla>",
    );
    const r = await service.receive(KEY, other);
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.body, /hibakod/);
    assert.equal(ingested.length, 0);
  });

  it("a debit goes in under its own key, on our account, with the value day as the booking day", async () => {
    const { service, ingested } = setup();
    const r = await service.receive(KEY, FULL);
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.body, /hibakod/);
    const row = ingested[0]![0]!;
    assert.equal(row.source, "SZAMLAZZ");
    assert.equal(row.sourceKey, "szamlazz:4711");
    assert.equal(row.accountNumber, "1170900220624460");
    assert.equal(row.direction, "DEBIT");
    assert.ok(row.amount.equals(new Prisma.Decimal("6012764")));
    assert.equal(row.bookingDate.toISOString().slice(0, 10), "2026-09-25");
    assert.equal(row.sourceValueDate?.toISOString().slice(0, 10), "2026-09-25");
    assert.equal(row.counterpartyAccount, "11773016-00000000");
    assert.equal(row.narrative, "KS26/08132 & KS26/08382");
  });
});
