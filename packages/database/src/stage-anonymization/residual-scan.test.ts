import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createResidualDictionary,
  scanRows,
  scanText,
  type ResidualDictionary,
} from "./residual-scan.js";
import { createPseudonymizer } from "./pseudonymizer.js";

/*
  THE RESIDUAL SCAN (S4). WHAT TURNS THIS RED: a real e-mail, phone (with or WITHOUT a prefix), tax number, IBAN or full name that
  is in the dictionary and survives in a text or at any JSON depth without a finding; a finding for a value that is not in the
  dictionary (a false alarm that would block every swap); a report that names a value, a row or a position; a dictionary that
  keeps a value instead of a digest; a scan that read no row but says clean; a short or malformed value that gets into the dictionary.
*/
const KEY = "proba-futas-kulcs-nem-valodi-0123456789-abcdef";
const REAL = {
  email: "teszt.elek@example.com",
  phone: "+36 30 123 4567",
  taxNumber: "8123456789",
  iban: "HU42117730161111101800000000",
  name: "Teszt Elek",
};

function dictionary(): ResidualDictionary {
  const builder = createResidualDictionary(KEY);
  builder.add("email", REAL.email);
  builder.add("phone", REAL.phone);
  builder.add("taxNumber", REAL.taxNumber);
  builder.add("taxNumber", "12345678-2-42");
  builder.add("iban", REAL.iban);
  builder.add("name", "Dr. " + REAL.name);
  return builder.build();
}

describe("what the scan finds in a text", () => {
  const d = dictionary();

  it("finds each kind of real value, in any writing", () => {
    assert.deepEqual(scanText(d, "Írt: TESZT.ELEK@Example.com"), ["email"]);
    assert.deepEqual(scanText(d, "Hívja: +36 30 123 4567"), ["phone"]);
    assert.deepEqual(scanText(d, "Hívja: 06 30 123 4567"), ["phone"]);
    assert.deepEqual(scanText(d, "Hívja: 30 123 4567"), ["phone"]); // no prefix: what the S2 pattern scrubber cannot see
    assert.deepEqual(scanText(d, "Adóazonosító: 8123456789"), ["taxNumber"]);
    assert.deepEqual(scanText(d, "Adószám: 12345678-2-42, vagy 12345678242"), [
      "taxNumber",
    ]);
    assert.deepEqual(scanText(d, "EU: HU12345678"), ["taxNumber"]);
    assert.deepEqual(
      scanText(d, "Utalás: HU42 1177 3016 1111 1018 0000 0000"),
      ["iban"],
    );
    assert.deepEqual(scanText(d, "Hívta Teszt Elek ma"), ["name"]);
    assert.deepEqual(scanText(d, "hívta ELEK TESZT"), ["name"]);
    assert.deepEqual(scanText(d, "Dr. Teszt Elek"), ["name"]);
  });

  it("finds several kinds in one text, each once", () => {
    const found = scanText(
      d,
      "Teszt Elek (teszt.elek@example.com, +36 30 123 4567), Teszt Elek újra",
    ).sort();
    assert.deepEqual(found, ["email", "name", "phone"]);
  });

  it("does not find a value that is not in the dictionary, a lone surname, or a lone given name", () => {
    assert.deepEqual(
      scanText(
        d,
        "Írt: mas@example.com, hívja +36 20 765 4321, adó 8000000001",
      ),
      [],
    );
    assert.deepEqual(scanText(d, "Teszt volt itt. Elek is. Teszt, Elek"), []);
    assert.deepEqual(
      scanText(d, "Rendelés 1234567, összeg 1 234 567 Ft, dátum 2026-11-09"),
      [],
    );
  });
});

describe("what the scan reports", () => {
  const d = dictionary();

  it("walks rows and JSON to any depth, and names the column and the kind with a count", () => {
    const report = scanRows(d, [
      {
        model: "Customer",
        row: {
          id: "c1",
          notes: "Hívta Teszt Elek",
          payload: { a: [{ b: "x", mail: "teszt.elek@example.com" }] },
        },
      },
      {
        model: "Customer",
        row: { id: "c2", notes: "Teszt Elek ismét", payload: null },
      },
      { model: "Invoice", row: { id: "i1", memo: "ok" } },
    ]);
    assert.equal(report.clean, false);
    assert.equal(report.rowsScanned, 3);
    assert.deepEqual(report.findings, [
      { model: "Customer", field: "notes", kind: "name", count: 2 },
      { model: "Customer", field: "payload", kind: "email", count: 1 },
    ]);
  });

  it("never carries a value, a row or a position in the report", () => {
    const report = scanRows(d, [
      {
        model: "Customer",
        row: { notes: "Hívta Teszt Elek: +36 30 123 4567", x: REAL.email },
      },
    ]);
    const text = JSON.stringify(report);
    for (const value of [REAL.email, "Teszt", "Elek", "123 4567", "301234567"])
      assert.ok(!text.includes(value), value);
  });

  it("is clean for clean rows, and counts the rows it read", () => {
    const report = scanRows(d, [
      { model: "A", row: { id: "1", n: 5, d: new Date(), notes: "semmi" } },
    ]);
    assert.deepEqual(report, { clean: true, rowsScanned: 1, findings: [] });
    assert.deepEqual(scanRows(d, []), {
      clean: true,
      rowsScanned: 0,
      findings: [],
    });
  });

  it("finds a fake that equals a real value too (a true collision worth a look)", () => {
    const engine = createPseudonymizer(
      "proba-kulcs-nem-valodi-0123456789-abcdef-xyz",
    );
    const fake = engine.personName("Valaki Mas");
    const builder = createResidualDictionary(KEY);
    builder.add("name", fake);
    assert.equal(
      scanRows(builder.build(), [{ model: "C", row: { n: fake } }]).clean,
      false,
    );
  });
});

describe("credential keys left in a JSON value (barracuda, #2322)", () => {
  const d = dictionary();

  it("finds a credential or network key at any depth, by a part of the name, naming the column and counting", () => {
    const report = scanRows(d, [
      {
        model: "AuditLog",
        row: {
          id: "a",
          payload: {
            ok: 1,
            nested: [
              { resetToken: "x" },
              { deeper: { "x-api-key": "y", remoteAddr: "z" } },
            ],
          },
        },
      },
      { model: "AuditLog", row: { id: "b", payload: { setCookie: "c" } } },
      {
        model: "AuditLog",
        row: {
          id: "c",
          payload: { description: "ok", recipient: "r", scripts: 1 },
        },
      },
    ]);
    assert.deepEqual(report.findings, [
      { model: "AuditLog", field: "payload", kind: "credentialKey", count: 4 },
    ]);
    assert.equal(report.clean, false);
    assert.ok(!JSON.stringify(report).includes("resetToken"));
  });

  it("does not take a top-level COLUMN name for a JSON key (the register decides columns)", () => {
    assert.equal(
      scanRows(d, [
        { model: "Session", row: { tokenHash: "x", ipAddress: "y" } },
      ]).clean,
      true,
    );
  });
});

describe("the dictionary", () => {
  it("keeps digests, not values, and ignores a value too short or malformed for its kind", () => {
    const builder = createResidualDictionary(KEY);
    builder.add("email", "nem-email");
    builder.add("phone", "12345");
    builder.add("taxNumber", "123");
    builder.add("iban", "HU12");
    builder.add("name", "Egyedül");
    builder.add("email", REAL.email);
    const d = builder.build();
    assert.deepEqual(d.sizes, {
      email: 1,
      phone: 0,
      taxNumber: 0,
      iban: 0,
      name: 0,
    });
    assert.equal(d.has("email", REAL.email), true);
    assert.equal(d.has("email", "mas@example.com"), false);
    assert.ok(!JSON.stringify(d).includes(REAL.email));
  });

  it("refuses a key under 32 bytes, and depends on the key", () => {
    assert.throws(() => createResidualDictionary("rovid"), /at least 32 bytes/);
    const a = createResidualDictionary(KEY);
    a.add("email", REAL.email);
    const b = createResidualDictionary(KEY + "-masik");
    b.add("email", REAL.email);
    assert.equal(a.build().has("email", REAL.email), true);
    assert.equal(b.build().has("email", REAL.email), true);
  });
});
