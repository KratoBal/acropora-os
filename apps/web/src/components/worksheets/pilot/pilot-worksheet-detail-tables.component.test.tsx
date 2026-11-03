import { render, screen } from "@testing-library/react";
import { PilotDataTable } from "@acropora/ui";
import type { WorksheetDetail } from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import {
  WORKSHEET_LINE_COLUMNS,
  WORKSHEET_LINE_TABLE_MIN_WIDTH,
  WORKSHEET_VERSION_COLUMNS,
  WORKSHEET_VERSION_TABLE_MIN_WIDTH,
} from "./pilot-worksheet-detail-page";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/*
  A MUNKALAP TÁBLÁI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). MI PIROSÍT: ha egy oszlop
  elveszti a feliratát (telefonon a cella felirat nélkül maradna), ha a tétel megnevezése nem a
  kártya címe, ha a nem munka jellegű tétel is "fő"-t és munkaórát mutat, ha az eszköz- és
  partnerkód eltűnik, vagy ha a rugalmas oszlopnak nem marad hely a minimumon.
*/
type LineRow = WorksheetDetail["currentVersion"]["lines"][number];
type VersionRow = WorksheetDetail["versions"][number];

const line = {
  id: "line-1",
  position: 1,
  description: "Tömítéscsere",
  detail: "Fő keringetés",
  assetId: "asset-1",
  assetNumber: "ESZ-0001",
  partnerInternalCode: "P-17",
  quantity: "1.5",
  unit: "óra",
  kind: "LABOR",
  workerCount: 2,
  laborHours: "3",
} as unknown as LineRow;

const version = {
  id: "version-1",
  version: 2,
  label: null,
  status: "DRAFT",
  changeReason: "Javítás",
  createdByName: "Teszt Szerelő",
  createdAt: "2026-10-04T08:00:00.000Z",
  closedAt: null,
  closedByName: null,
  signature: null,
} as unknown as VersionRow;

function renderLines(rows: LineRow[]) {
  return render(
    <PilotDataTable
      columns={WORKSHEET_LINE_COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      rowTestId="line-row"
      minWidth={WORKSHEET_LINE_TABLE_MIN_WIDTH}
    />,
  );
}

function renderVersions(rows: VersionRow[]) {
  return render(
    <PilotDataTable
      columns={WORKSHEET_VERSION_COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      rowTestId="version-row"
      minWidth={WORKSHEET_VERSION_TABLE_MIN_WIDTH}
    />,
  );
}

const fixedSum = (columns: readonly { width?: string }[]) =>
  columns
    .map((column) => Number.parseInt(column.width ?? "0", 10))
    .reduce((a, b) => a + b, 0);

describe("WORKSHEET_LINE_COLUMNS", () => {
  it("labels every cell with its column for the phone card view", () => {
    renderLines([line]);
    const row = screen.getAllByTestId("line-row")[0]!;
    expect(
      [...row.querySelectorAll("td")].map((td) =>
        td.getAttribute("data-label"),
      ),
    ).toEqual(["#", "Megnevezés", "Mennyiség", "Hányan", "Munkaóra"]);
  });

  it("makes the description the card title and hides the position on the phone", () => {
    renderLines([line]);
    const cells = [
      ...screen.getAllByTestId("line-row")[0]!.querySelectorAll("td"),
    ];
    expect(cells[0]!.className).toContain("max-md:hidden");
    expect(cells[1]!.className).toContain("max-md:before:hidden");
  });

  it("shows the people and hours of a labor line, and dashes for another kind", () => {
    const labor = renderLines([line]);
    expect(screen.getByText("2 fő")).toBeTruthy();
    expect(screen.getByText("3 munkaóra")).toBeTruthy();
    labor.unmount();
    renderLines([{ ...line, kind: "MATERIAL" } as unknown as LineRow]);
    expect(screen.queryByText("2 fő")).toBeNull();
    expect(screen.getAllByText("–").length).toBe(2);
  });

  it("keeps the asset number and the partner's own code under the description", () => {
    renderLines([line]);
    expect(screen.getByText("ESZ-0001")).toBeTruthy();
    expect(screen.getByText("P-17")).toBeTruthy();
  });

  it("leaves the flexible description column at least 200 px at the table minimum", () => {
    expect(fixedSum(WORKSHEET_LINE_COLUMNS) + 200).toBeLessThanOrEqual(
      WORKSHEET_LINE_TABLE_MIN_WIDTH,
    );
  });
});

describe("WORKSHEET_VERSION_COLUMNS", () => {
  it("labels every cell with its column for the phone card view", () => {
    renderVersions([version]);
    const row = screen.getAllByTestId("version-row")[0]!;
    expect(
      [...row.querySelectorAll("td")].map((td) =>
        td.getAttribute("data-label"),
      ),
    ).toEqual([
      "Verzió",
      "Állapot",
      "Készítette",
      "Lezárta",
      "Indoklás",
      "Aláírás",
    ]);
  });

  it("names a version without a label by its number", () => {
    renderVersions([version]);
    expect(screen.getByText("2. verzió")).toBeTruthy();
  });

  it("shows the signer and the decision", () => {
    renderVersions([
      {
        ...version,
        signature: {
          signerName: "Kitalált Partner",
          decision: "ACCEPTED",
          signerNotice: "Rendben",
        },
      } as unknown as VersionRow,
    ]);
    expect(screen.getByText(/Kitalált Partner \(elfogadta\)/)).toBeTruthy();
    expect(screen.getByText("Rendben")).toBeTruthy();
  });

  it("leaves the flexible reason column at least 150 px at the table minimum", () => {
    expect(fixedSum(WORKSHEET_VERSION_COLUMNS) + 150).toBeLessThanOrEqual(
      WORKSHEET_VERSION_TABLE_MIN_WIDTH,
    );
  });
});
