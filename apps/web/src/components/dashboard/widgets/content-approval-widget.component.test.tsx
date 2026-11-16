import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { contentApprovalWidget } from "./content-approval-widget";

/*
  JÓVÁHAGYÁSRA VÁRÓ TARTALOM (T5.1 PR2). MI PIROSÍT: ha a fő szám nem a váró tételek száma; ha a nulla nem üres állapot; ha a
  kártya nem a Tartalom oldalra mutat.
*/
describe("a jóváhagyásra váró tartalom kártyája", () => {
  it("a fő szám a váró tételek száma", () => {
    const { Body } = contentApprovalWidget;
    render(<Body data={{ total: 4, overdue: 0 }} />);
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("jóváhagyásra váró tétel")).toBeTruthy();
  });

  it("nullánál üres állapot, és a kártya a Tartalom oldalra mutat", () => {
    expect(contentApprovalWidget.emptyMessage({ total: 0, overdue: 0 })).toBe(
      "Nincs jóváhagyásra váró tartalom.",
    );
    expect(
      contentApprovalWidget.emptyMessage({ total: 2, overdue: 0 }),
    ).toBeNull();
    expect(contentApprovalWidget.href).toBe("/tartalom");
  });

  it("az emlékeztető sor csak akkor áll ott, ha van 2 napja váró tétel", () => {
    const { Body } = contentApprovalWidget;
    const { rerender } = render(<Body data={{ total: 4, overdue: 0 }} />);
    expect(screen.queryByText(/már legalább 2 napja vár/)).toBeNull();
    rerender(<Body data={{ total: 4, overdue: 3 }} />);
    expect(screen.getByText(/Ebből 3 már legalább 2 napja vár/)).toBeTruthy();
  });
});
