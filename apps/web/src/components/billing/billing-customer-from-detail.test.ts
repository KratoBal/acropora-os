import type { CustomerDetail } from "@acropora/types";
import { describe, expect, it } from "vitest";

import { billingCustomerFromDetail } from "./billing-partner-card";

/**
 * Balázs, 2026-10-26: one record, two addresses. The invoice's recipient is the
 * billing e-mail; the ordering one only when there is no usable billing one.
 * MI PIROSÍT: ha a számla a rendelési címre menne, amikor van számlázási; ha a
 * szóközös számlázási cím elnyomná a rendelésit; ha egyik sincs, nem null lenne.
 */
const detail = (over: Partial<CustomerDetail>): CustomerDetail =>
  ({
    id: "c-1",
    customerNumber: "VEVO-1",
    displayName: "Állatkert",
    address: null,
    paymentDueDays: null,
    partnerTerms: null,
    ...over,
  }) as CustomerDetail;

describe("billingCustomerFromDetail: the invoice recipient", () => {
  it("prefers the billing e-mail over the ordering one", () => {
    expect(
      billingCustomerFromDetail(
        detail({ email: "beszerzes@x.hu", billingEmail: "penzugy@x.hu" }),
      ).customer.email,
    ).toBe("penzugy@x.hu");
  });

  it("falls back to the ordering e-mail when the billing one is missing or blank", () => {
    for (const billingEmail of [undefined, "", "   "])
      expect(
        billingCustomerFromDetail(
          detail({ email: "beszerzes@x.hu", billingEmail }),
        ).customer.email,
      ).toBe("beszerzes@x.hu");
  });

  it("is null when there is no e-mail at all", () => {
    expect(billingCustomerFromDetail(detail({})).customer.email).toBeNull();
  });
});
