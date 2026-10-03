import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type {
  ProductFieldReview,
  ProductQualityQueueRow,
} from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import { JevDisabledAction } from "./jev-decision-action";
import { JevFieldReviewRow } from "./jev-field-review-row";
import {
  JEV_STATE_MESSAGE,
  JevHealthChips,
  JevReviewStateMessage,
  JevReviewSummary,
} from "./jev-review-summary";
import { JevSourceCard } from "./jev-source-card";
import { JevQualityFilters, JevQualityQueueTable } from "./jev-quality-queue";
import { filterQueue, isCritical, type QueueFilter } from "./jev-presentation";

/** `PilotButton` comes through the app's pilot module, whose font loader is build-time only. */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/**
 * FIXTURES ONLY HERE: invented products and values. Nothing in a production
 * module imports this file, so no fixture can reach a real render.
 */
const at = "2026-10-01T20:41:00.000Z";

function field(over: Partial<ProductFieldReview>): ProductFieldReview {
  return {
    fieldResultId: "fr-volume",
    field: "volume",
    tier: "C",
    status: "VERIFIED",
    currentValue: { kind: "quantity", amount: "500", unit: "ml" },
    value: { kind: "quantity", amount: "500", unit: "ml" },
    sourceType: "MANUFACTURER_DOCUMENT",
    sourceRef: "https://example.invalid/adatlap.pdf",
    retrievedAt: at,
    confidence: 1,
    evidence: [],
    ...over,
  };
}

const conflict = field({
  field: "flowRate",
  status: "CONFLICTING_SOURCES",
  currentValue: { kind: "quantity", amount: "2500", unit: "l/h" },
  value: null,
  sourceType: null,
  sourceRef: null,
  retrievedAt: null,
  confidence: null,
  evidence: [
    {
      sourceType: "MANUFACTURER_DOCUMENT",
      value: { kind: "quantity", amount: "3000", unit: "l/h" },
      sourceRef: null,
      retrievedAt: at,
    },
    {
      sourceType: "SUPPLIER_PAGE",
      value: { kind: "quantity", amount: "2800", unit: "l/h" },
      sourceRef: null,
      retrievedAt: at,
    },
  ],
});

describe("a mező-ellenőrző sor", () => {
  it("ELLENŐRZÖTT: az érték, a forrás és a kinyerési biztonság a rendszer számformátumával", () => {
    render(<JevFieldReviewRow review={field({})} />);
    const row = screen.getByRole("article", { name: "Térfogat / kiszerelés" });
    expect(within(row).getByText("ELLENŐRZÖTT")).toBeTruthy();
    expect(within(row).getAllByText("500 ml")).toHaveLength(2);
    expect(within(row).getByText("Forrás: Gyártói adatlap")).toBeTruthy();
    expect(within(row).getByText("Kinyerési biztonság: 1,00")).toBeTruthy();
  });

  it("JAVASLAT: egy Tier A/B javaslat értékkel és saját címkével jelenik meg", () => {
    render(
      <JevFieldReviewRow
        review={field({
          field: "category",
          tier: "B",
          status: "SUGGESTED",
          currentValue: { kind: "text", text: "Szivattyúk" },
          value: { kind: "text", text: "Keringető szivattyúk" },
          sourceType: "MANUFACTURER_PAGE",
          confidence: 0.96,
        })}
      />,
    );
    expect(screen.getByText("JAVASLAT")).toBeTruthy();
    expect(screen.getByText("Keringető szivattyúk")).toBeTruthy();
    expect(screen.getByText("Kinyerési biztonság: 0,96")).toBeTruthy();
  });

  it("ÜTKÖZÉS: nincs csendes győztes; a JEV oszlop nem mutat értéket, a források mind látszanak", () => {
    const { container } = render(
      <JevFieldReviewRow
        review={conflict}
        conflictHref="/products/p-1/adatellenorzes/flowRate"
      />,
    );
    expect(screen.getByText("ÜTKÖZÉS")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Források eltérnek" });
    expect(link.getAttribute("href")).toBe(
      "/products/p-1/adatellenorzes/flowRate",
    );
    expect(
      screen.getByText(
        "Forrás: Gyártói adatlap: 3000 l/h · Beszállítói oldal: 2800 l/h",
      ),
    ).toBeTruthy();
    // the JEV column holds no number: neither source is picked
    const jev = within(container).getByText("JEV").parentElement!;
    expect(jev.textContent).not.toMatch(/3000|2800/);
    expect(container.textContent).not.toMatch(/biztonság/i);
  });

  it("HIÁNYZIK: kötőjel, nincs kitalált érték és nincs üres biztonság-sor", () => {
    const { container } = render(
      <JevFieldReviewRow
        review={field({
          field: "ean",
          status: "MISSING",
          currentValue: null,
          value: null,
          sourceType: null,
          confidence: null,
        })}
      />,
    );
    expect(screen.getByText("HIÁNYZIK")).toBeTruthy();
    expect(screen.getByText("Forrás: Nem talált hiteles forrás")).toBeTruthy();
    expect(container.textContent).not.toMatch(/biztonság/i);
  });

  it("Tier C: egy alátámasztatlan érték soha nem jelenik meg tényként vagy javaslatként", () => {
    const { container } = render(
      <JevFieldReviewRow
        review={field({
          field: "power",
          tier: "C",
          status: "SUGGESTED",
          value: { kind: "quantity", amount: "45", unit: "W" },
          confidence: 0.99,
        })}
      />,
    );
    expect(screen.getByText("NEM ELLENŐRZÖTT")).toBeTruthy();
    expect(screen.queryByText("JAVASLAT")).toBeNull();
    expect(screen.queryByText("ELLENŐRZÖTT")).toBeNull();
    expect(container.textContent).not.toMatch(/45 W/);
    // and no confidence for a value that is not shown
    expect(container.textContent).not.toMatch(/biztonság/i);
  });

  it("GYANÚS ÉRTÉK: a vörös állapot szöveggel, a forrásokkal, érték nélkül", () => {
    render(
      <JevFieldReviewRow
        review={field({
          field: "ean",
          status: "POSSIBLE_WRONG_VALUE",
          value: null,
          confidence: null,
          evidence: [
            {
              sourceType: "SUPPLIER_PAGE",
              value: { kind: "text", text: "5990000000001" },
              sourceRef: null,
              retrievedAt: at,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("GYANÚS ÉRTÉK")).toBeTruthy();
    expect(
      screen.getByText("Forrás: Beszállítói oldal: 5990000000001"),
    ).toBeTruthy();
  });
});

describe("a forráskártya", () => {
  it("a belső adat mindig BELSŐ ADAT, és nem igazolja önmagát", () => {
    render(
      <JevSourceCard
        entry={{
          sourceType: "UNAS_CURRENT",
          value: { kind: "quantity", amount: "2500", unit: "l/h" },
          sourceRef: null,
          retrievedAt: at,
        }}
      />,
    );
    expect(screen.getByText("BELSŐ ADAT")).toBeTruthy();
    expect(screen.getByText("Jelenlegi belső adat")).toBeTruthy();
    expect(screen.queryByText("ELLENŐRZÖTT")).toBeNull();
  });

  it("a külső forrás nem dönt győztest; csak http(s) hivatkozás lesz link", () => {
    const { rerender } = render(
      <JevSourceCard
        entry={{
          sourceType: "MANUFACTURER_DOCUMENT",
          value: { kind: "quantity", amount: "3000", unit: "l/h" },
          sourceRef: "https://example.invalid/a.pdf",
          retrievedAt: at,
        }}
      />,
    );
    expect(screen.getByText("KÜLSŐ FORRÁS")).toBeTruthy();
    expect(screen.getByText("3000 l/h")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Forrás megnyitása" })
        .getAttribute("href"),
    ).toBe("https://example.invalid/a.pdf");
    rerender(
      <JevSourceCard
        entry={{
          sourceType: "MANUFACTURER_DOCUMENT",
          value: { kind: "text", text: "x" },
          sourceRef: "javascript:alert(1)",
          retrievedAt: null,
        }}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Lekérés ideje ismeretlen")).toBeTruthy();
  });
});

describe("az összegzés és az állapotok", () => {
  it("valódi számok, százalék nélkül; az emberi jóváhagyás csak akkor, ha van mit nézni", () => {
    const { container } = render(
      <>
        <JevHealthChips
          fields={[
            conflict,
            field({ field: "category", tier: "B", status: "SUGGESTED" }),
          ]}
        />
        <JevReviewSummary
          lastRun={{ at, sourceCount: 4, fieldCount: 12 }}
          fields={[conflict]}
        />
      </>,
    );
    expect(screen.getByText("1 JAVASLAT")).toBeTruthy();
    expect(screen.getByText("1 ÜTKÖZÉS")).toBeTruthy();
    expect(screen.getByText("EMBERI JÓVÁHAGYÁS SZÜKSÉGES")).toBeTruthy();
    expect(container.textContent).not.toMatch(/%|ADATMINŐSÉG/);
  });

  it("mind ellenőrzött: nincs jóváhagyás-címke", () => {
    render(
      <JevReviewSummary
        lastRun={{ at, sourceCount: 1, fieldCount: 1 }}
        fields={[field({})]}
      />,
    );
    expect(screen.queryByText("EMBERI JÓVÁHAGYÁS SZÜKSÉGES")).toBeNull();
  });

  it("a hiba nem nyugodt üres állapot: más mondat, más szerep", () => {
    const { rerender } = render(<JevReviewStateMessage state="error" />);
    expect(screen.getByRole("alert").textContent).toBe(JEV_STATE_MESSAGE.error);
    rerender(<JevReviewStateMessage state="no-issues" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      "Nem találtunk ellenőrzést igénylő termékadatot.",
    );
    rerender(<JevReviewStateMessage state="never-checked" />);
    expect(screen.getByRole("status").textContent).toBe(
      "Ehhez a termékhez még nem készült JEV adatellenőrzés.",
    );
    rerender(<JevReviewStateMessage state="unavailable" />);
    expect(screen.getByRole("status").textContent).toBe(
      "A termékadat-ellenőrzés jelenleg nem elérhető.",
    );
  });
});

describe("a döntés-vezérlők", () => {
  it("mindig letiltva, és a jogosultság szerint mondja meg, miért", () => {
    const { rerender } = render(
      <JevDisabledAction
        label="Kijelölt módosítások alkalmazása"
        canManage={false}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Kijelölt módosítások alkalmazása",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("A döntéshez termékkezelési jog kell."),
    ).toBeTruthy();
    rerender(
      <JevDisabledAction label="Kijelölt módosítások alkalmazása" canManage />,
    );
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      screen.getByText("A döntések rögzítése még nincs engedélyezve."),
    ).toBeTruthy();
  });
});

const rows: ProductQualityQueueRow[] = [
  {
    productId: "p1",
    productName: "Kitalált szivattyú",
    field: "flowRate",
    tier: "C",
    status: "CONFLICTING_SOURCES",
    lastCheckedAt: "2026-10-02T09:58:00.000Z",
  },
  {
    productId: "p2",
    productName: "Kitalált adalék",
    field: "ean",
    tier: "C",
    status: "MISSING",
    lastCheckedAt: "2026-10-02T09:55:00.000Z",
  },
  {
    productId: "p3",
    productName: "Kitalált lámpa",
    field: "category",
    tier: "B",
    status: "SUGGESTED",
    lastCheckedAt: "2026-10-02T09:49:00.000Z",
  },
  {
    productId: "p4",
    productName: "Kitalált gyanta",
    field: "packSize",
    tier: "C",
    status: "VERIFIED",
    lastCheckedAt: "2026-10-02T09:42:00.000Z",
  },
  {
    productId: "p5",
    productName: "Kitalált teszt",
    field: "ean",
    tier: "C",
    status: "POSSIBLE_WRONG_VALUE",
    lastCheckedAt: "2026-10-01T09:42:00.000Z",
  },
  {
    productId: "p6",
    productName: "Kitalált fölöző",
    field: "longDescription",
    tier: "A",
    status: "CONFLICTING_SOURCES",
    lastCheckedAt: "2026-10-02T09:00:00.000Z",
  },
];
const now = new Date("2026-10-02T10:00:00.000Z");

describe("a katalógus-sor szűrése", () => {
  it("minden szűrő a saját állapotait adja", () => {
    const ids = (filter: QueueFilter) =>
      filterQueue(rows, filter).map((r) => r.productId);
    expect(ids("all")).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(ids("conflict")).toEqual(["p1", "p6"]);
    expect(ids("missing")).toEqual(["p2"]);
    expect(ids("suggestion")).toEqual(["p3"]);
    expect(ids("verified")).toEqual(["p4"]);
    // critical: a probably wrong value, or a Tier C fact in conflict (not a description)
    expect(ids("critical")).toEqual(["p1", "p5"]);
    expect(isCritical({ tier: "A", status: "CONFLICTING_SOURCES" })).toBe(
      false,
    );
  });

  it("a táblázat a szűrő szerint mutat, sorról a termékre visz, és a koros időt magyarul írja", () => {
    function Harness() {
      const [filter, setFilter] = useState<QueueFilter>("all");
      return (
        <>
          <JevQualityFilters value={filter} onChange={setFilter} />
          <JevQualityQueueTable
            rows={rows}
            filter={filter}
            now={now}
            hrefFor={(r) => `/products/${r.productId}/adatellenorzes`}
          />
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByText("6 elem megjelenítve")).toBeTruthy();
    expect(screen.getByText("2 perce")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ütközés" }));
    expect(
      screen
        .getByRole("button", { name: "Ütközés" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("2 elem megjelenítve")).toBeTruthy();
    const link = screen.getAllByRole("link", { name: "Megnyitás" })[0]!;
    expect(link.getAttribute("href")).toBe("/products/p1/adatellenorzes");
    fireEvent.click(screen.getByRole("button", { name: "Javaslat" }));
    expect(screen.getByRole("link", { name: "Átnézés" })).toBeTruthy();
  });

  it("üres szűrésnél üres állapot, nem hiba és nem kitalált szám", () => {
    render(
      <JevQualityQueueTable
        rows={[]}
        filter="all"
        now={now}
        hrefFor={() => "/"}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Nem találtunk ellenőrzést igénylő termékadatot.",
    );
    expect(screen.getByText("0 elem megjelenítve")).toBeTruthy();
  });
});
