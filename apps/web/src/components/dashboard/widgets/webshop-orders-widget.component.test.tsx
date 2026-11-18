import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { webshopOrdersWidget } from "./webshop-orders-widget";

/*
  WEBSHOP RENDELÉSI SOR (T2.1). MI PIROSÍT: ha a fő szám nem a feldolgozásra váró rendelés; ha
  egy szakasz hiányzik vagy más néven áll, mint a listán; ha az elavult nem kiemelt; ha a csonka
  beolvasás nem jelzett; ha a csupa nulla nem üres állapot.
*/
const counters = {
  processing: 4,
  invoice: 7,
  dispatch: 2,
  pickup: 1,
  stale: 53,
};

describe("a webshop rendelési sor kártyája", () => {
  it("a fő szám a feldolgozásra váró, alatta minden szakasz a lista nevével", () => {
    const { Body } = webshopOrdersWidget;
    render(<Body data={{ counters, shortageOrders: 0, truncated: false }} />);
    expect(screen.getByText("rendelés feldolgozásra vár")).toBeTruthy();
    for (const [label, value] of [
      ["Feldolgozásra vár", "4"],
      ["Számlára vár", "7"],
      ["Feladásra vár", "2"],
      ["Átvehető", "1"],
      ["Elavult", "53"],
    ] as const) {
      const row = screen.getByText(label).closest("li")!;
      expect(row.textContent).toContain(value);
    }
    // the stale orders stand out in red; a waiting stage does not
    expect(screen.getByText("53").className).toContain("text-pilot-red-700");
    expect(screen.getByText("7").className).not.toContain("text-pilot-red-700");
    expect(screen.queryByText(/alsó becslések/)).toBeNull();
  });

  it("a csonka beolvasásnál kimondja, hogy a szám alsó becslés", () => {
    const { Body } = webshopOrdersWidget;
    render(<Body data={{ counters, shortageOrders: 0, truncated: true }} />);
    expect(screen.getByText(/alsó becslések/)).toBeTruthy();
  });

  it("csupa nullánál üres állapot, nem nullás kártya", () => {
    const zero = {
      processing: 0,
      invoice: 0,
      dispatch: 0,
      pickup: 0,
      stale: 0,
    };
    expect(
      webshopOrdersWidget.emptyMessage({
        counters: zero,
        shortageOrders: 0,
        truncated: false,
      }),
    ).toBe("Nincs nyitott webshop rendelés.");
    expect(
      webshopOrdersWidget.emptyMessage({
        counters,
        shortageOrders: 0,
        truncated: false,
      }),
    ).toBeNull();
  });

  // card ac167fc2: the number of orders with an active stock shortage, the list's own count
  it("a készlethiányos rendelések számát külön sorban mutatja, amikor van", () => {
    const { Body } = webshopOrdersWidget;
    render(<Body data={{ counters, shortageOrders: 3, truncated: false }} />);
    const row = screen.getByText("Készlethiányos").closest("li")!;
    expect(row.textContent).toContain("3");
    // an order that needs a person's decision is amber, not the red of a stale one
    expect(within(row).getByText("3").className).toContain(
      "text-pilot-amber-700",
    );
  });

  it("hiány nélkül nincs készlethiányos sor, nulla sem", () => {
    const { Body } = webshopOrdersWidget;
    render(<Body data={{ counters, shortageOrders: 0, truncated: false }} />);
    expect(screen.queryByText("Készlethiányos")).toBeNull();
  });

  it("csupa nulla szakasznál is kártya, ha van készlethiányos rendelés (nem üres állapot)", () => {
    const zero = {
      processing: 0,
      invoice: 0,
      dispatch: 0,
      pickup: 0,
      stale: 0,
    };
    expect(
      webshopOrdersWidget.emptyMessage({
        counters: zero,
        shortageOrders: 2,
        truncated: false,
      }),
    ).toBeNull();
  });
});
