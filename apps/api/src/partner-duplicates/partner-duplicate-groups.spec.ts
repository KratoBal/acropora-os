import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  customerKeys,
  duplicateReportLine,
  euKey,
  findDuplicates,
  huBase,
  supplierKey,
  type CustomerRow,
  type SupplierRow,
} from "./partner-duplicate-groups.js";

/*
  WHAT TURNS THIS RED (egy partnertörzs, 1. lépés; a mérés kulcsai, barracuda 15:36). Egy `DE123456789` és egy magyar,
  ugyanazzal a nyolc jeggyel kezdődő szám egy csoportban; a 4-gyel kezdődő magyar alap az erős párok közt (csoportos
  adóalanyiság: több cég közös alapja lehet); a kis- és nagybetűs `hu` előtag nem illeszkedik; az ország nélküli
  szállító (NULL) csendben kimarad; egy szállító és egy vevő ugyanazon a kulcson, de már összekötve, párként jelenik
  meg; a naplósorban név, adószám vagy azonosító.
*/
const customer = (
  over: Partial<CustomerRow> & { id: string },
): CustomerRow => ({
  customerNumber: `VEVO-${over.id}`,
  displayName: `Név ${over.id}`,
  companyName: null,
  type: "COMPANY",
  taxNumber: null,
  euTaxNumber: null,
  partnerMirror: false,
  fromUnas: false,
  ...over,
});

const supplier = (
  over: Partial<SupplierRow> & { id: string },
): SupplierRow => ({
  code: `SZALL-${over.id}`,
  name: `Szállító ${over.id}`,
  taxNumber: null,
  country: "HU",
  customerId: null,
  ...over,
});

describe("a kulcsok", () => {
  it("huBase: a magyar adószám első nyolc számjegye, kis- és nagybetűs előtaggal, kötőjellel és anélkül", () => {
    for (const typed of [
      "12345678-1-42",
      "12345678142",
      "HU12345678-1-42",
      "hu12345678142",
      "hu 12345678-1-42",
      "12345678",
    ])
      assert.equal(huBase(typed), "12345678", typed);
    for (const typed of ["", "1234567", "DE123456789", "12345678-1-4", "abc"])
      assert.equal(huBase(typed), null, typed);
  });

  it("euKey: országkóddal együtt, normalizálva; magyar számból nem lesz közösségi kulcs", () => {
    assert.equal(euKey("de 123.456-789"), "DE123456789");
    assert.equal(euKey("SK2020123456"), "SK2020123456");
    assert.equal(euKey("12345678"), null);
    assert.equal(euKey(""), null);
    assert.equal(euKey(null), null);
  });

  it("a magyar és a közösségi kulcs KÜLÖN fajta: ugyanaz a nyolc jegy nem azonos a DE-s számmal", () => {
    const hu = customerKeys(customer({ id: "a", taxNumber: "12345678-1-42" }));
    const de = customerKeys(customer({ id: "b", euTaxNumber: "DE12345678" }));
    assert.deepEqual(hu, [{ kind: "HU", value: "12345678" }]);
    assert.deepEqual(de, [{ kind: "EU", value: "DE12345678" }]);
    const report = findDuplicates(
      [
        customer({ id: "a", taxNumber: "12345678-1-42" }),
        customer({ id: "b", euTaxNumber: "DE12345678" }),
      ],
      [],
    );
    assert.equal(report.strong.length, 0);
  });

  it("a 4-gyel kezdődő magyar alap külön fajta (HU4): csoportos adóalanyiság lehet", () => {
    assert.deepEqual(
      customerKeys(customer({ id: "g", taxNumber: "41234567-5-13" })),
      [{ kind: "HU4", value: "41234567" }],
    );
  });
});

describe("supplierKey: az ország nélküli szállítónál az alak dönt, ahogy a tükör adószám-átvitelében", () => {
  it("HU ország: magyar alap; más ország: közösségi kulcs", () => {
    assert.deepEqual(
      supplierKey(
        supplier({ id: "a", taxNumber: "12345678-1-42", country: "HU" }),
      ),
      {
        kind: "HU",
        value: "12345678",
      },
    );
    assert.deepEqual(
      supplierKey(
        supplier({ id: "b", taxNumber: "DE123456789", country: "DE" }),
      ),
      {
        kind: "EU",
        value: "DE123456789",
      },
    );
  });

  it("NULL vagy üres ország: az alak dönt, és a szállító NEM marad ki", () => {
    for (const country of [null, "", "  "]) {
      assert.deepEqual(
        supplierKey(supplier({ id: "a", taxNumber: "12345678-1-42", country })),
        { kind: "HU", value: "12345678" },
        `HU-alak, ország: ${JSON.stringify(country)}`,
      );
      assert.deepEqual(
        supplierKey(supplier({ id: "b", taxNumber: "DE123456789", country })),
        { kind: "EU", value: "DE123456789" },
        `EU-alak, ország: ${JSON.stringify(country)}`,
      );
    }
  });

  it("a kisbetűs hu előtagú magyar szám ország nélkül is magyar, nem közösségi", () => {
    assert.deepEqual(
      supplierKey(
        supplier({ id: "a", taxNumber: "hu12345678142", country: null }),
      ),
      { kind: "HU", value: "12345678" },
    );
  });

  it("adószám nélküli szállítónak nincs kulcsa", () => {
    assert.equal(supplierKey(supplier({ id: "a" })), null);
  });
});

describe("findDuplicates", () => {
  it("azonos magyar alapú vevő-sorok erős csoport; egy sor csak egyszer számít, az egyedi nem csoport", () => {
    const report = findDuplicates(
      [
        customer({ id: "a", taxNumber: "12345678-1-42" }),
        customer({ id: "b", taxNumber: "HU12345678142", partnerMirror: true }),
        customer({ id: "c", taxNumber: "87654321-2-13" }),
      ],
      [],
    );
    assert.equal(report.strong.length, 1);
    assert.deepEqual(
      report.strong[0]!.customers.map((row) => row.id),
      ["a", "b"],
    );
    assert.equal(report.strong[0]!.kind, "HU");
  });

  it("azonos közösségi kulcs is erős csoport", () => {
    const report = findDuplicates(
      [
        customer({ id: "a", euTaxNumber: "SK2020123456" }),
        customer({ id: "b", euTaxNumber: "sk 2020-123456" }),
      ],
      [],
    );
    assert.equal(report.strong.length, 1);
    assert.equal(report.strong[0]!.kind, "EU");
  });

  it("a 4-gyel kezdődő alap NEM erős pár, hanem a gyenge listán", () => {
    const report = findDuplicates(
      [
        customer({ id: "a", taxNumber: "41234567-5-13" }),
        customer({ id: "b", taxNumber: "41234567-1-13" }),
      ],
      [],
    );
    assert.equal(report.strong.length, 0);
    assert.equal(report.weakGroupTax.length, 1);
  });

  it("egy sor, amelynek mindkét kulcsa ugyanaz a másikéval, egy csoportban egyszer szerepel", () => {
    const report = findDuplicates(
      [
        customer({
          id: "a",
          taxNumber: "12345678-1-42",
          euTaxNumber: "DE12345678",
        }),
        customer({
          id: "b",
          taxNumber: "12345678-1-42",
          euTaxNumber: "DE12345678",
        }),
      ],
      [],
    );
    assert.equal(report.strong.length, 2, "két kulcs, két csoport");
    for (const group of report.strong) assert.equal(group.customers.length, 2);
  });

  it("szállító és vevő ugyanazon a kulcson, összekötés nélkül: pár; az összekötött nem pár", () => {
    const report = findDuplicates(
      [
        customer({ id: "old", taxNumber: "12345678-1-42" }),
        customer({
          id: "mirror",
          taxNumber: "12345678-1-42",
          partnerMirror: true,
        }),
      ],
      [supplier({ id: "s", taxNumber: "12345678-1-42", customerId: "mirror" })],
    );
    assert.equal(report.unlinked.length, 1);
    assert.equal(report.unlinked[0]!.customer.id, "old");
  });

  it("az ország nélküli szállító is párt ad (nem marad ki)", () => {
    const report = findDuplicates(
      [customer({ id: "old", taxNumber: "12345678-1-42" })],
      [supplier({ id: "s", taxNumber: "hu12345678142", country: null })],
    );
    assert.equal(report.unlinked.length, 1);
  });

  it("a UNAS-ból jött vevők: összesen és adószám nélkül (a rosszul írt szám szám, nem hiány)", () => {
    const report = findDuplicates(
      [
        customer({ id: "u1", fromUnas: true }),
        customer({ id: "u2", fromUnas: true, taxNumber: "12345678-1-42" }),
        customer({ id: "u3", fromUnas: true, taxNumber: "rossz" }),
        customer({ id: "m", fromUnas: false }),
      ],
      [],
    );
    assert.deepEqual(report.unas, { total: 3, withoutTaxNumber: 1 });
  });
});

describe("duplicateReportLine", () => {
  it("csak számokat ír: nincs benne név, adószám vagy azonosító", () => {
    const report = findDuplicates(
      [
        customer({
          id: "a",
          displayName: "Titkos Név Kft.",
          taxNumber: "12345678-1-42",
        }),
        customer({
          id: "b",
          displayName: "Másik Név",
          taxNumber: "12345678-1-42",
        }),
      ],
      [],
    );
    const line = duplicateReportLine(report);
    assert.equal(
      line,
      "PARTNER-DUPLIKATUM eros_csoport=1 eros_sor=2 csoportos_adoalany_csoport=0 szallito_vevo_osszekotes_nelkul=0 unas_vevo=0 unas_adoszam_nelkul=0",
    );
    for (const secret of ["Titkos", "Másik", "12345678", "VEVO-"])
      assert.equal(line.includes(secret), false, secret);
  });
});
