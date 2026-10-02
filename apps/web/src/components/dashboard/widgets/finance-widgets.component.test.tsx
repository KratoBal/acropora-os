import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { incomingInvoicesWidget } from "./incoming-invoices-widget";
import { missingInvoicesWidget } from "./missing-invoices-widget";
import { overdueInvoicesWidget } from "./overdue-invoices-widget";
import { settlementsWidget } from "./settlements-widget";

describe("a pénzügyi widgetek", () => {
  it("a lejárt számla a nyitott összeggel áll, a fizetési adat nélküli külön sorban", () => {
    const { Body } = overdueInvoicesWidget;
    render(
      <Body
        data={{
          overdue: {
            count: 2,
            openAmounts: [{ currency: "HUF", amount: "12700" }],
          },
          dueToday: 1,
          dueWithinWeek: 3,
          noPaymentDataPastDue: 4,
        }}
      />,
    );
    // the UNKNOWN ones are NOT in the headline figure
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText(/2 · 12\s700 Ft/)).toBeTruthy();
    expect(screen.getByText("Lejárt, nincs fizetési adat")).toBeTruthy();
  });

  it("a hiányzó számlák a két hónapot nevükön mutatják", () => {
    const { Body } = missingInvoicesWidget;
    render(
      <Body
        data={{
          months: [
            {
              month: "2026-09",
              missing: 4,
              originalMissing: 1,
              notMatched: 2,
              noInvoice: 1,
              missingAmountHuf: "0",
              status: "INCOMPLETE",
            },
            {
              month: "2026-08",
              missing: 2,
              originalMissing: 0,
              notMatched: 2,
              noInvoice: 0,
              missingAmountHuf: "0",
              status: "INCOMPLETE",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Szeptember")).toBeTruthy();
    expect(screen.getByText("Augusztus")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
  });

  it("a bejövő számlák üres állapota csak akkor áll, ha semmi nem vár", () => {
    const zero = {
      navToBook: 0,
      navErrors: 0,
      mailboxFailed: 0,
      lateCorrections: 0,
    };
    expect(incomingInvoicesWidget.emptyMessage(zero)).toBe(
      "Nincs feldolgozásra váró bejövő számla.",
    );
    expect(
      incomingInvoicesWidget.emptyMessage({ ...zero, navErrors: 1 }),
    ).toBeNull();
  });

  it("az elszámolás a sikertelen szinkront hibaként mutatja, még eltérés nélkül is", () => {
    const sources = [
      {
        source: "FOXPOST" as const,
        needsReview: 0,
        errors: 0,
        lastRun: { status: "FAILED", startedAt: "2026-10-02T05:00:00Z" },
      },
      { source: "GLS" as const, needsReview: 2, errors: 0, lastRun: null },
      {
        source: "SIMPLEPAY" as const,
        needsReview: 0,
        errors: 0,
        lastRun: { status: "APPLIED", startedAt: "2026-10-02T05:00:00Z" },
      },
    ];
    expect(settlementsWidget.emptyMessage({ sources })).toBeNull();
    const { Body } = settlementsWidget;
    render(<Body data={{ sources }} />);
    expect(screen.getByText("szinkron hiba")).toBeTruthy();
    expect(screen.getByText("2 eltérés")).toBeTruthy();
    expect(screen.getByText("rendben")).toBeTruthy();
  });
});
