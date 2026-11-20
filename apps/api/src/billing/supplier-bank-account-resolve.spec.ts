import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveSupplierAccounts,
  type ResolveFill,
  type ResolveMaster,
  type ResolveRow,
} from "./supplier-bank-account-resolve.js";

/*
  A SZÁLLÍTÓ SZÁMLASZÁMA A LISTÁN, HA A SORBAN NINCS (acrobot 58654, 58655). MI PIROSÍT: ha a sor saját számlaszáma felülíródna; ha a szállító másik számláján álló számlaszám nem töltene; ha két
  különböző számlaszám közül az egyiket választanánk; ha az ellentmondó szinten az alacsonyabb szintre lépnénk; ha egy másik szállító számlaszáma átszivárogna; ha a csak névvel azonosított szállítóra
  pótolnánk; ha a sorrend (másik számla, törzs, kitöltés) felcserélődne; ha a forrás-jelölés elveszne.
*/
const OTP = "11773016-11111018-00000000";
const OTP16 = "1177301611111018";
const OTHER = "10918001-00000017";
const row = (id: string, over: Partial<ResolveRow> = {}): ResolveRow => ({
  id,
  supplierName: "Példa Kft.",
  supplierTaxNumber: "12345678-2-13",
  supplierEuTaxNumber: null,
  supplierBankAccount: null,
  ...over,
});
const fill = (over: Partial<ResolveFill> = {}): ResolveFill => ({
  supplierName: "Példa Kft.",
  supplierTaxNumber: "12345678-2-13",
  supplierEuTaxNumber: null,
  account: OTP16,
  source: "INVOICE_PDF",
  ...over,
});
const master = (over: Partial<ResolveMaster> = {}): ResolveMaster => ({
  name: "Példa Kft.",
  taxNumber: "12345678",
  accounts: [OTHER, null],
  ...over,
});

describe("a szállító számlaszáma a listán, ha a sor saját adatában nincs", () => {
  it("a szállító másik számláján álló számlaszám tölt, az eredeti szöveggel és OTHER_INVOICE jelöléssel; a saját számlaszámú sor nem kap semmit", () => {
    const out = resolveSupplierAccounts(
      [row("a"), row("b", { supplierBankAccount: OTP })],
      [],
      [],
    );
    assert.deepEqual(out.get("a"), { account: OTP, source: "OTHER_INVOICE" });
    assert.equal(out.has("b"), false);
  });

  it("ugyanaz a szám több számlán (más írásmóddal is) egy jelölt; két különböző ellentmondás: nincs adat, és az alacsonyabb szintre sem lépünk", () => {
    const same = resolveSupplierAccounts(
      [
        row("a"),
        row("b", { supplierBankAccount: OTP }),
        row("c", { supplierBankAccount: OTP16 }),
      ],
      [],
      [],
    );
    assert.equal(same.get("a")?.source, "OTHER_INVOICE");
    const conflict = resolveSupplierAccounts(
      [
        row("a"),
        row("b", { supplierBankAccount: OTP }),
        row("c", { supplierBankAccount: OTHER }),
      ],
      [master()],
      [fill()],
    );
    assert.equal(conflict.has("a"), false);
  });

  it("a sorrend: másik számla, törzs, kitöltés; a törzs és a kitöltés is jelöli a forrását", () => {
    const rows = [row("a")];
    assert.deepEqual(
      resolveSupplierAccounts(
        [...rows, row("b", { supplierBankAccount: OTP })],
        [master()],
        [fill()],
      ).get("a"),
      { account: OTP, source: "OTHER_INVOICE" },
    );
    assert.deepEqual(
      resolveSupplierAccounts(rows, [master()], [fill()]).get("a"),
      {
        account: OTHER,
        source: "MASTER",
      },
    );
    assert.deepEqual(resolveSupplierAccounts(rows, [], [fill()]).get("a"), {
      account: "11773016-11111018",
      source: "INVOICE_PDF",
    });
    for (const source of ["PAIRED_DEBIT", "MANUAL"] as const)
      assert.equal(
        resolveSupplierAccounts(rows, [], [fill({ source })]).get("a")?.source,
        source,
      );
  });

  it("a törzs két különböző számlaszáma vagy két különböző kitöltés: nincs adat", () => {
    assert.equal(
      resolveSupplierAccounts(
        [row("a")],
        [master({ accounts: [OTHER, OTP] })],
        [],
      ).has("a"),
      false,
    );
    assert.equal(
      resolveSupplierAccounts(
        [row("a")],
        [],
        [fill(), fill({ account: "1091800100000017" })],
      ).has("a"),
      false,
    );
  });

  it("másik szállító számlaszáma nem szivárog át: az adószám-törzs a kulcs", () => {
    const out = resolveSupplierAccounts(
      [
        row("a"),
        row("x", {
          supplierName: "Másik Kft.",
          supplierTaxNumber: "99999999-2-13",
          supplierBankAccount: OTP,
        }),
      ],
      [master({ taxNumber: "99999999", name: "Másik Kft." })],
      [fill({ supplierTaxNumber: "99999999", supplierName: "Másik Kft." })],
    );
    assert.equal(out.has("a"), false);
  });

  it("a csak névvel azonosított szállítóra nem pótolunk, a közösségi adószámosra igen", () => {
    const named = (id: string, over: Partial<ResolveRow> = {}) =>
      row(id, {
        supplierTaxNumber: null,
        supplierName: "Euro Corals",
        ...over,
      });
    assert.equal(
      resolveSupplierAccounts(
        [named("a"), named("b", { supplierBankAccount: OTP })],
        [],
        [],
      ).size,
      0,
    );
    const eu = (id: string, over: Partial<ResolveRow> = {}) =>
      row(id, {
        supplierTaxNumber: null,
        supplierEuTaxNumber: "ATU63964918",
        ...over,
      });
    assert.equal(
      resolveSupplierAccounts(
        [eu("a"), eu("b", { supplierBankAccount: OTP })],
        [],
        [],
      ).get("a")?.source,
      "OTHER_INVOICE",
    );
  });

  it("az üres és szóközös számlaszám nem számlaszám", () => {
    const out = resolveSupplierAccounts(
      [
        row("a"),
        row("b", { supplierBankAccount: "   " }),
        row("c", { supplierBankAccount: "" }),
      ],
      [master({ accounts: ["", "  ", null] })],
      [],
    );
    assert.equal(out.size, 0);
  });
});
