import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  unasCustomerUpdateData,
  type CanonicalCustomer,
} from "./unas-customer-sync.repository.js";

/*
  WHAT TURNS THIS RED (acrobot 42510: an existing customer can be edited on the customer page, a UNAS one too). A UNAS
  update that writes the tax number, the EU tax number, the company name, the billing e-mail, the consents or the payment
  days of the row: a colleague's edit of those would be gone at the next sync that finds the UNAS record changed.
*/
const canonical: CanonicalCustomer = {
  type: "COMPANY",
  displayName: "Kovács Anna",
  email: "anna@example.hu",
  phone: "+36 30 111 2222",
  billing: null,
  shipping: null,
};

describe("what a UNAS update writes on an existing customer", () => {
  it("is the type, the name, the e-mail and the phone, and no other key", () => {
    assert.deepEqual(Object.keys(unasCustomerUpdateData(canonical)).sort(), [
      "displayName",
      "email",
      "phone",
      "type",
    ]);
  });

  it("never carries the fields a colleague edits by hand", () => {
    const written = unasCustomerUpdateData(canonical) as Record<
      string,
      unknown
    >;
    for (const kept of [
      "taxNumber",
      "euTaxNumber",
      "companyName",
      "billingEmail",
      "paymentDueDays",
      "marketingEmailConsent",
      "marketingSmsConsent",
      "worksheetPartnerCode",
    ])
      assert.equal(kept in written, false, kept);
  });

  it("passes the values through as the canonical form has them", () => {
    assert.deepEqual(unasCustomerUpdateData(canonical), {
      type: "COMPANY",
      displayName: "Kovács Anna",
      email: "anna@example.hu",
      phone: "+36 30 111 2222",
    });
  });
});
