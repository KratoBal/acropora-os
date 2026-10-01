import type { BankStatementImportResult } from "@acropora/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MissingInvoicesImportResult } from "./missing-invoices-import-result";

const RESULT: BankStatementImportResult = {
  importId: "imp-1",
  fileName: "export-3.csv",
  rowCount: 43,
  createdCount: 43,
  skippedCount: 0,
  rejected: [],
  rejectedCount: 0,
  pending: [
    { line: 44, partner: "FŐVÁROSI VÍZMŰVEK", amount: "8450", currency: "HUF" },
    { line: 45, partner: "FIGMA", amount: "12990", currency: "HUF" },
  ],
  pendingCount: 2,
  accounts: [],
  months: [],
};

/*
  A FÜGGŐ KÁRTYÁS TÉTEL NEM HIBA (acrobot 25637: Balázs hibának hitte). MI
  PIROSÍT: ha a függő sorok az elutasítottak közt vagy hibás színnel állnának;
  ha nem neveznék meg a sort és a partnert.
*/
describe("MissingInvoicesImportResult, pending card lines", () => {
  it("lists them apart, and the upload still reads as done", () => {
    render(<MissingInvoicesImportResult result={RESULT} onClose={vi.fn()} />);
    const panel = screen.getByRole("region", {
      name: "A kivonat-feltöltés eredménye",
    });
    expect(panel).toHaveTextContent("A kivonat feltöltve");
    expect(panel).not.toHaveTextContent("Elutasított sorok");
    expect(screen.getByText("Függő kártyás tételek")).toBeInTheDocument();
    expect(panel).toHaveTextContent("a következő kivonatban jön");
    expect(panel).toHaveTextContent("45. sor: FIGMA");
  });
});
