import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeAccount } from "../missing-invoices/missing-invoices.repository.js";
import {
  formatSupplierAccount,
  hungarianBlockValid,
  ibanValid,
  normalizeSupplierAccount,
  supplierAccountCandidates,
  supplierAccountVerdict,
} from "./supplier-bank-account-text.js";

/*
  A SZÁLLÍTÓ BANKSZÁMLASZÁMA A PDF SZÖVEGÉBŐL (acrobot 58428). MI PIROSÍT: ha egy ellenőrző összeg nélküli vagy hibás összegű szám jelölt lenne; ha címke
  nélkül is jelölt lenne egy érvényes alakú szám; ha a „számlaszám” címke mellett a tagolatlan 16 jegyű (a számla száma is lehet) jelölt lenne; ha a
  saját bankszámlánk jelölt lenne; ha két különböző számlaszám közül az egyiket választanánk; ha a hazai szám és ugyanannak az IBAN-ja két jelölt lenne;
  ha egy érvénytelen IBAN (összeg, hossz, ismeretlen ország) jelölt lenne; ha a harmadik, érvénytelen blokk elvinné a 16 jegyű számot; ha a címke a
  következő oldalról „érne át”.
*/
const OTP = "11773016-11111018-00000000";
const OTP16 = "1177301611111018";
const OTP_IBAN = "HU42117730161111101800000000";

const accounts = (lines: string[], own: string[] = []) =>
  supplierAccountCandidates(lines, own).map((c) => c.account);

describe("a hazai bankszámlaszám blokk-ellenőrzése", () => {
  it("a 9-7-3-1 súlyozott összeg 10-zel osztható: az éles minták érvényesek, egy elütött számjegy nem", () => {
    for (const block of ["11773016", "11111018", "10918001", "00000000"])
      assert.equal(hungarianBlockValid(block), true, block);
    for (const block of ["11773017", "11111019", "1177301", "117730160"])
      assert.equal(hungarianBlockValid(block), false, block);
  });
});

describe("az IBAN-ellenőrzés", () => {
  it("érvényes: hossz, ország és mod 97 együtt", () => {
    for (const iban of [
      OTP_IBAN,
      "DE89370400440532013000",
      "NL91ABNA0417164300",
      "GB82WEST12345698765432",
    ])
      assert.equal(ibanValid(iban), true, iban);
  });
  it("érvénytelen: rossz ellenőrző összeg, rossz hossz, ismeretlen ország", () => {
    for (const iban of [
      "DE89370400440532013001",
      "DE8937040044053201300",
      "XX89370400440532013000",
      "HU42117730161111101800000001",
      // az ellenőrző összeg érvényes, de a hossz nem a német 22: rövid és hosszú
      "DE5137040044053201300",
      "DE813704004405320130000",
    ])
      assert.equal(ibanValid(iban), false, iban);
  });
});

describe("a bankszámlaszám jelöltjei a PDF soraiból", () => {
  it("a címkés, tagolt hazai szám jelölt, normalizáltan (a 24 jegyű, nullára végződő a 16 jegyű)", () => {
    const found = supplierAccountCandidates([
      "Szállító: Példa Kft.",
      `Bankszámlaszám: ${OTP}`,
    ]);
    assert.deepEqual(
      found.map((c) => [c.account, c.kind, c.label, c.line]),
      [[OTP16, "HU_ACCOUNT", "BANK", 1]],
    );
  });

  it("a táblázatos számlán a címke a cella fölött vagy mellett áll: az előző sor és a ' | ' cellák is jók", () => {
    assert.deepEqual(accounts(["Bankszámlaszám", OTP]), [OTP16]);
    assert.deepEqual(accounts([`Bank | OTP | Bankszámla | ${OTP}`]), [OTP16]);
  });

  it("címke nélkül egy érvényes alakú szám sem jelölt", () => {
    assert.deepEqual(accounts([OTP, `Rendelésszám ${OTP}`]), []);
  });

  it("ellenőrző összeg nélkül nem jelölt: egy elütött számjegy kizárja", () => {
    assert.deepEqual(
      accounts(["Bankszámlaszám: 11773016-11111019-00000000"]),
      [],
    );
    assert.deepEqual(accounts(["Bankszámlaszám: 11773017-11111018"]), []);
  });

  it("a „számlaszám” címkével csak a tagolt alak elég; a tagolatlan 16 jegyű a számla száma is lehet", () => {
    assert.deepEqual(accounts([`Számlaszám: ${OTP}`]), [OTP16]);
    assert.deepEqual(accounts(["Számlaszám: 11773016 11111018"]), [OTP16]);
    assert.deepEqual(accounts([`Számlaszám: ${OTP16}`]), []);
    // a bank-címkével a tagolatlan alak is jó
    assert.deepEqual(accounts([`Bankszámlaszám: ${OTP16}`]), [OTP16]);
  });

  it("a harmadik, érvénytelen blokk nem viszi el a számot (egy másik szám kezdete), az érvényes, nem nulla marad 24 jegyűnek", () => {
    assert.deepEqual(accounts(["Bankszámlaszám: 11773016-11111018 12345678"]), [
      OTP16,
    ]);
    assert.deepEqual(accounts(["Bankszámlaszám: 11773016-11111018-12345676"]), [
      "117730161111101812345676",
    ]);
  });

  it("az IBAN szóközökkel és tagolatlanul is jelölt, címkével; a hazai IBAN a hazai számmal azonos jelölt", () => {
    assert.deepEqual(accounts(["IBAN: DE89 3704 0044 0532 0130 00"]), [
      "DE89370400440532013000",
    ]);
    assert.deepEqual(accounts(["Bank account NL91ABNA0417164300"]), [
      "NL91ABNA0417164300",
    ]);
    assert.deepEqual(
      accounts([`Bankszámlaszám: ${OTP}`, `IBAN: ${OTP_IBAN}`]),
      [OTP16],
    );
  });

  it("érvénytelen IBAN nem jelölt", () => {
    assert.deepEqual(accounts(["IBAN: DE89370400440532013001"]), []);
    assert.deepEqual(accounts(["IBAN: DE8937040044053201300"]), []);
  });

  it("a saját bankszámlánk kiesik, akár hazai alakban, akár IBAN-ként áll a számlán", () => {
    assert.deepEqual(
      accounts(
        [`Vevő bankszámlaszáma: ${OTP}`, "IBAN: DE89370400440532013000"],
        [OTP16],
      ),
      ["DE89370400440532013000"],
    );
    assert.deepEqual(
      accounts([`IBAN: ${OTP_IBAN}`], ["117730161111101800000000"]),
      [],
    );
  });

  it("az oldalvég-jel megszakítja a címke hatókörét: az előző oldal utolsó sorának címkéje nem érvényes a következő oldal első számára", () => {
    assert.deepEqual(
      accounts(["Bankszámlaszám", "=== oldal vege ===", OTP]),
      [],
    );
    // a címke és a szám ugyanazon az oldalon: jó
    assert.deepEqual(accounts(["=== oldal vege ===", "Bankszámlaszám", OTP]), [
      OTP16,
    ]);
  });
});

describe("a döntés a jelöltek darabszámából jön", () => {
  const verdict = (lines: string[], own: string[] = []) =>
    supplierAccountVerdict(supplierAccountCandidates(lines, own));

  it("egy különböző számlaszám: kitölthető (többször említve is)", () => {
    assert.deepEqual(
      verdict([`Bankszámlaszám: ${OTP}`, `Bank account ${OTP}`]),
      { state: "ONE", account: OTP16 },
    );
  });
  it("két különböző számlaszám (HUF és EUR): nincs adat, 2 jelölt; nem választunk", () => {
    assert.deepEqual(
      verdict([
        `HUF bankszámlaszám: ${OTP}`,
        "EUR IBAN: DE89370400440532013000",
      ]),
      { state: "SEVERAL", count: 2 },
    );
  });
  it("semmi: nincs adat", () => {
    assert.deepEqual(verdict(["Köszönjük a vásárlást"]), { state: "NONE" });
    assert.deepEqual(verdict([]), { state: "NONE" });
  });
});

describe("a normalizálás és a megjelenítés", () => {
  it("megegyezik a Hiányzó számlák normalizálásával", () => {
    for (const value of [
      OTP,
      OTP16,
      OTP_IBAN,
      "117730161111101812345676",
      "de89 3704 0044 0532 0130 00",
      "  ",
    ])
      assert.equal(
        normalizeSupplierAccount(value),
        normalizeAccount(value),
        value,
      );
  });
  it("a hazai szám kötőjelesen, az IBAN négyes csoportokban jelenik meg", () => {
    assert.equal(formatSupplierAccount(OTP16), "11773016-11111018");
    assert.equal(
      formatSupplierAccount("117730161111101812345676"),
      "11773016-11111018-12345676",
    );
    assert.equal(
      formatSupplierAccount("DE89370400440532013000"),
      "DE89 3704 0044 0532 0130 00",
    );
  });
});
