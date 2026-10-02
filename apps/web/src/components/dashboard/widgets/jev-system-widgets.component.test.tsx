import { render, screen } from "@testing-library/react";
import type { DashboardJevCounts } from "@acropora/types";
import { describe, expect, it } from "vitest";

import { attentionWidget } from "./attention-widget";
import { jevIntelligenceWidget } from "./jev-intelligence-widget";
import { systemStatusWidget } from "./system-status-widget";

const counts = (
  over: Partial<DashboardJevCounts> = {},
): DashboardJevCounts => ({
  runs: 0,
  errors: 0,
  shown: { accepted: 0, overridden: 0, lapsed: 0, open: 0 },
  shadow: { match: 0, mismatch: 0, open: 0 },
  ...over,
});

describe("a JEV- és rendszer-csempék", () => {
  it("a JEV árnyékmérés külön, felcímkézve áll, és sehol nem ír várakozó javaslatot", () => {
    const { Body } = jevIntelligenceWidget;
    const { container } = render(
      <Body
        data={{
          windowDays: 7,
          today: { runs: 4, errors: 1 },
          week: counts({
            runs: 20,
            shadow: { match: 9, mismatch: 2, open: 3 },
          }),
          policies: [
            {
              policyKey: "acropora-missing-invoice-pair-v1",
              ...counts({
                runs: 14,
                shadow: { match: 9, mismatch: 2, open: 3 },
              }),
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Árnyékmérés — nem javaslat")).toBeTruthy();
    expect(screen.getByText("Hiányzó számla párosítás")).toBeTruthy();
    expect(screen.getByText("9 egyezik · 2 eltér")).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(
      /javaslat vár|vár.*javaslat/i,
    );
  });

  it("a rendszerállapot a négy állapotot magyarul mondja ki, UNAS és Medusa sor nélkül", () => {
    const { Body } = systemStatusWidget;
    const row = (
      source: "NAV" | "MAIL" | "FOXPOST" | "GLS",
      state: "ok" | "warning" | "error" | "no-data",
    ) => ({
      source,
      state,
      lastRunStatus: null,
      lastRunAt: null,
      errorCode: null,
      detail: null,
    });
    const { container } = render(
      <Body
        data={{
          sources: [
            row("NAV", "ok"),
            row("MAIL", "warning"),
            row("FOXPOST", "error"),
            row("GLS", "no-data"),
          ],
        }}
      />,
    );
    for (const label of ["OK", "Figyelmeztetés", "Hiba", "Nincs adat"])
      expect(screen.getByText(label)).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(/UNAS|Medusa|uptime/i);
  });

  it("a figyelmet igényel lista a kiesett forrást nem elérhetőnek mondja, és akkor nem üres", () => {
    expect(
      attentionWidget.emptyMessage({
        items: [],
        unavailable: [
          { widgetId: "overdue-invoices", title: "Lejáró számlák" },
        ],
      }),
    ).toBeNull();
    expect(attentionWidget.emptyMessage({ items: [], unavailable: [] })).toBe(
      "Nincs figyelmet igénylő tétel.",
    );
    const { Body } = attentionWidget;
    render(
      <Body
        data={{
          items: [
            {
              widgetId: "service-tickets",
              key: "new",
              label: "Új hibajegy",
              count: 3,
              href: "/szerviz/hibajegyek",
              tone: "warning",
            },
          ],
          unavailable: [
            { widgetId: "overdue-invoices", title: "Lejáró számlák" },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Új hibajegy" }).getAttribute("href"),
    ).toBe("/szerviz/hibajegyek");
    expect(screen.getByText("nem elérhető")).toBeTruthy();
  });
});
