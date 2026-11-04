import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  pendingPaymentMarks: vi.fn(),
  resolvePaymentMark: vi.fn(),
}));
vi.mock("@/lib/api/billing-documents", () => ({ billingDocumentsApi: api }));
// the date helper's module reaches the pilot font through the external document page
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

import { PendingPaymentMarks } from "./pending-payment-marks";

/*
  A BERAGADT KIFIZETÉS-JELÖLÉS LEZÁRÁSA (barracuda, #2168 review). MI PIROSÍT: ha a függő jelölés nem látszik;
  ha a lezárás megerősítés nélkül megy; ha nem a választott kimenetet küldi; ha a lezárás után nem olvas újra;
  ha függő jelölés nélkül is megjelenik valami.
*/
const mark = {
  id: "m1",
  source: "MANUAL",
  state: "UNKNOWN" as const,
  date: "2026-11-04",
  amount: "127000.00",
  createdAt: "2026-11-04T17:00:00.000Z",
  responseMessage: "TimeoutError",
};

beforeEach(() => {
  api.pendingPaymentMarks.mockReset();
  api.resolvePaymentMark.mockReset().mockResolvedValue({ ok: true });
});

describe("PendingPaymentMarks", () => {
  it("függő jelölés nélkül nem mutat semmit", async () => {
    api.pendingPaymentMarks.mockResolvedValue([]);
    const { container } = render(
      <PendingPaymentMarks
        token="t"
        invoiceNumber="ACRW-2026/00084"
        currency="HUF"
      />,
    );
    await waitFor(() => expect(api.pendingPaymentMarks).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("a függő jelölést kiírja, és megerősítés után a választott kimenettel zárja le", async () => {
    api.pendingPaymentMarks
      .mockResolvedValueOnce([mark])
      .mockResolvedValueOnce([]);
    const onResolved = vi.fn();
    render(
      <PendingPaymentMarks
        token="t"
        invoiceNumber="ACRW-2026/00084"
        currency="HUF"
        onResolved={onResolved}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Nem került be" }),
    );
    expect(api.resolvePaymentMark).not.toHaveBeenCalled();
    expect(
      screen.getByText(/a Számlázz.hu felületén megnézted/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lezárom" }));
    await waitFor(() =>
      expect(api.resolvePaymentMark).toHaveBeenCalledWith("t", "m1", "FAILED"),
    );
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(api.pendingPaymentMarks).toHaveBeenCalledTimes(2);
  });
});
