import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { partnerTermsFor } from "./partner-payment-terms.js";

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
