import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaymentBadge } from "./billing-payment";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/*
  A SIMPLEPAY-FORRÁS FELIRATA (acrobot 25964, 25979). MI PIROSÍT: ha a
  SimplePay-ből számolt „Fizetve” nem mondaná meg a forrását; ha a teljes
  visszatérítés nem látszana a feliratból, és a „Nincs fizetve” ok nélkül állna.
*/
describe("PaymentBadge with a SimplePay source", () => {
  it("names SimplePay, and a refund", () => {
    const { unmount } = render(
      <PaymentBadge
        paymentState="PAID"
        paidAmount="29210"
        lastPaymentDate="2026-09-28"
        paymentSource="SIMPLEPAY"
        currency="HUF"
      />,
    );
    expect(screen.getByText("Fizetve (SimplePay)")).toBeInTheDocument();
    expect(screen.getByText("2026. 09. 28.")).toBeInTheDocument();
    unmount();

    render(
      <PaymentBadge
        paymentState="UNPAID"
        paidAmount="0"
        lastPaymentDate="2026-09-28"
        paymentSource="SIMPLEPAY_REFUNDED"
        currency="HUF"
      />,
    );
    expect(
      screen.getByText("Nincs fizetve (SimplePay, visszatérítve)"),
    ).toBeInTheDocument();
  });
});

/*
  A BEJÖVŐ SZÁMLA BANKI PÁROSÍTÁSA (acrobot 25988). MI PIROSÍT: ha a nálunk
  jelölt „Fizetve” nem mondaná meg, hogy a banki párosításból jön; ha a feed és
  a párosítás eltérése nem látszana.
*/
describe("PaymentBadge for an incoming invoice paired to the bank", () => {
  it("names the bank pairing, and flags a conflict with the feed", () => {
    const { unmount } = render(
      <PaymentBadge
        paymentState="PAID"
        paidAmount="12700"
        lastPaymentDate="2026-09-30"
        paymentSource="BANK_PAIRING"
        currency="HUF"
      />,
    );
    expect(screen.getByText("Fizetve (banki párosítás)")).toBeInTheDocument();
    expect(screen.queryByText("Eltér a banki párosítástól")).toBeNull();
    unmount();

    render(
      <PaymentBadge
        paymentState="PARTIAL"
        paidAmount="5000"
        lastPaymentDate="2026-09-29"
        paymentSource="SZAMLAZZ"
        paymentConflict
        currency="HUF"
      />,
    );
    expect(screen.getByText("Eltér a banki párosítástól")).toBeInTheDocument();
  });
});
