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
