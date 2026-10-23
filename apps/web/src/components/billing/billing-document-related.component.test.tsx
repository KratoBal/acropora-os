import { render, screen, within } from "@testing-library/react";
import type { BillingRelatedDocument } from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import { BillingDocumentRelated } from "./billing-document-related";

// the list helpers share a module with pages that sit under `PilotThemeRoot` (Inter)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/**
 * A KIMENŐ BIZONYLATOK LÁNCA a számla oldalán (task kimeno-kapcsolodo-bizonylatok).
 * Kitalált számok. MI PIROSÍT: ha az aktuális bizonylat is hivatkozás (önmagára
 * mutat); ha egy másik tag nem hivatkozás a saját oldalára; ha a sztornó nem
 * nevezi meg, mit sztornóz; ha a kiállítatlan tag számnak látszik; ha a lánc
 * nélküli bizonylaton üres szakasz jelenik meg.
 */
const doc = (
  overrides: Partial<BillingRelatedDocument> &
    Pick<BillingRelatedDocument, "id" | "documentType">,
): BillingRelatedDocument => ({
  number: null,
  status: "ISSUED",
  issueDate: "2026-10-01",
  grossAmount: "127000.0000",
  currency: "HUF",
  current: false,
  openable: true,
  cancelsId: null,
  ...overrides,
});

const CHAIN: BillingRelatedDocument[] = [
  doc({ id: "p1", documentType: "PROFORMA", number: "D-1" }),
  doc({ id: "a1", documentType: "ADVANCE_INVOICE", number: "E-1" }),
  doc({
    id: "f1",
    documentType: "FINAL_INVOICE",
    number: "V-1",
    current: true,
  }),
  doc({
    id: "s1",
    documentType: "STORNO",
    number: "S-1",
    cancelsId: "f1",
    grossAmount: "-127000.0000",
    // the storno row has no details page
    openable: false,
  }),
  doc({
    id: "d1",
    documentType: "INVOICE",
    status: "DRAFT",
    issueDate: null,
    grossAmount: null,
  }),
];

describe("a kapcsolódó kimenő bizonylatok", () => {
  it("lists the chain in order with type, number, status, day and gross amount", () => {
    render(<BillingDocumentRelated documents={CHAIN} />);
    const items = within(
      screen.getByRole("list", { name: "Kapcsolódó bizonylatok" }),
    ).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Díjbekérő · D-1"),
      expect.stringContaining("Előlegszámla · E-1"),
      expect.stringContaining("Végszámla · V-1"),
      expect.stringContaining("Sztornó · S-1"),
      expect.stringContaining("Számla · még nincs száma"),
    ]);
    expect(items[0]!.textContent).toMatch(/bruttó 127\s000 Ft/);
    expect(items[0]!.textContent).toContain("Kiállítva");
  });

  it("links every member but the current one, which is marked instead", () => {
    render(<BillingDocumentRelated documents={CHAIN} />);
    expect(
      screen.getByRole("link", { name: "Díjbekérő · D-1" }),
    ).toHaveAttribute("href", "/penzugy/szamlazas/p1");
    expect(screen.queryByRole("link", { name: /Végszámla · V-1/ })).toBeNull();
    expect(screen.getByText("Ez a bizonylat")).toBeInTheDocument();
  });

  it("does not link a member without a details page: the storno stays plain text", () => {
    render(<BillingDocumentRelated documents={CHAIN} />);
    expect(screen.getByText(/Sztornó · S-1/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Sztornó/ })).toBeNull();
  });

  it("says when the chain is longer than the list shows", () => {
    const { rerender } = render(
      <BillingDocumentRelated documents={CHAIN} truncated />,
    );
    expect(
      screen.getByText("A lánc hosszabb, mint amit itt mutatunk."),
    ).toBeInTheDocument();
    rerender(<BillingDocumentRelated documents={CHAIN} />);
    expect(screen.queryByText(/hosszabb, mint amit/)).toBeNull();
  });

  it("names what the storno cancels", () => {
    render(<BillingDocumentRelated documents={CHAIN} />);
    expect(screen.getByText(/sztornózza: V-1/)).toBeInTheDocument();
  });

  it("shows an unissued member as a draft without a number or a day", () => {
    render(<BillingDocumentRelated documents={CHAIN} />);
    const draft = screen.getByText(/Számla · még nincs száma/).closest("li")!;
    expect(draft.textContent).toContain("nincs kiállítva");
    expect(draft.textContent).toContain("Piszkozat");
  });

  it("renders nothing for a document without a chain", () => {
    const { container } = render(<BillingDocumentRelated documents={[]} />);
    expect(container.textContent).toBe("");
  });
});
