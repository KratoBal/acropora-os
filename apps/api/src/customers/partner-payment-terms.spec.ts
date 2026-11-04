import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  partnerTaxNumberFor,
  partnerTermsFor,
} from "./partner-payment-terms.js";

/*
  KÁRTYA 7be4a85b: a vevő-sor napjai üresek, ugyanez a cég a Partnerek oldalon
  napot visel. MI PIROSÍT: ha a név nem párosít; ha két adószámos fél között a
  név dönt az adószám helyett; ha két ellentmondó partnerből választ.
*/
describe("partnerTermsFor", () => {
  const allatkert = {
    name: "Fővárosi Állat- és Növénykert",
    taxNumber: null,
    paymentDueDays: 30,
  };

  it("matches the same company by name when a tax number is missing", () => {
    assert.deepEqual(
      partnerTermsFor(
        {
          displayName: "Fővárosi Állat- és Növénykert",
          companyName: "FŐVÁROSI ÁLLAT ÉS NÖVÉNYKERT",
          taxNumber: "15490658-2-42",
        },
        [allatkert],
      ),
      { paymentDueDays: 30, partnerName: "Fővárosi Állat- és Növénykert" },
    );
  });

  it("lets the tax number decide when both sides have one", () => {
    const partner = { ...allatkert, taxNumber: "15490658-2-42" };
    assert.equal(
      partnerTermsFor(
        {
          displayName: "Más név Kft.",
          companyName: null,
          taxNumber: "HU15490658",
        },
        [partner],
      )?.paymentDueDays,
      30,
    );
    assert.equal(
      partnerTermsFor(
        {
          displayName: "Fővárosi Állat- és Növénykert",
          companyName: null,
          taxNumber: "99999999-2-42",
        },
        [partner],
      ),
      null,
    );
  });

  it("does not choose between partners with different days, nor match a stranger", () => {
    assert.equal(
      partnerTermsFor(
        {
          displayName: "Fővárosi Állat- és Növénykert",
          companyName: null,
          taxNumber: null,
        },
        [allatkert, { ...allatkert, paymentDueDays: 15 }],
      ),
      null,
    );
    assert.equal(
      partnerTermsFor(
        {
          displayName: "Xantus János Állatkert Kft.",
          companyName: null,
          taxNumber: null,
        },
        [allatkert],
      ),
      null,
    );
  });
});

/*
  A NÉVVEL EGYEZŐ PARTNER ADÓSZÁMA (kártya aaf4f09d; Luca, 2026-11-04 13:53 UTC). MI
  PIROSÍT: ha a régi vevő-sor nem kapja meg a partner adószámát a kapu okához; ha két
  különböző adószámú partner közül választ; ha adószám nélküli partnert ad.
*/
describe("partnerTaxNumberFor", () => {
  const oldRow = {
    displayName: "Fővárosi Állat- és Növénykert",
    companyName: null,
  };

  it("a névvel egyező partner adószámát adja, írásjel és kisbetű nélkül egyeztetve", () => {
    assert.deepEqual(
      partnerTaxNumberFor(oldRow, [
        { name: "Másik Kft.", taxNumber: "11111111-2-42" },
        { name: "FŐVÁROSI ÁLLAT ÉS NÖVÉNYKERT", taxNumber: " 15490658-2-42 " },
      ]),
      {
        partnerName: "FŐVÁROSI ÁLLAT ÉS NÖVÉNYKERT",
        taxNumber: "15490658-2-42",
      },
    );
  });

  it("nem dönt két különböző adószám között, és adószám nélküli partnert nem ad", () => {
    assert.equal(
      partnerTaxNumberFor(oldRow, [
        { name: "Fővárosi Állat- és Növénykert", taxNumber: "15490658-2-42" },
        { name: "Fővárosi Állat- és Növénykert", taxNumber: "22222222-2-42" },
      ]),
      null,
    );
    assert.equal(
      partnerTaxNumberFor(oldRow, [
        { name: "Fővárosi Állat- és Növénykert", taxNumber: "  " },
      ]),
      null,
    );
    // the same base twice (HU prefix, hyphens) is one company
    assert.equal(
      partnerTaxNumberFor(oldRow, [
        { name: "Fővárosi Állat- és Növénykert", taxNumber: "15490658-2-42" },
        { name: "Fővárosi Állat- és Növénykert", taxNumber: "HU15490658" },
      ])?.taxNumber,
      "15490658-2-42",
    );
  });
});
