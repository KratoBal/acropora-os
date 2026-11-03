import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { messagesWidget } from "./messages-widget";

/*
  OLVASATLAN ÜZENETEK (T2.1). MI PIROSÍT: ha a fő szám nem az olvasatlan üzenetek száma; ha a
  beszélgetések száma hiányzik; ha a nulla nem üres állapot.
*/
describe("az olvasatlan üzenetek kártyája", () => {
  it("a fő szám az olvasatlan üzenet, alatta a beszélgetések száma", () => {
    const { Body } = messagesWidget;
    render(<Body data={{ total: 5, conversations: 2 }} />);
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("olvasatlan üzenet")).toBeTruthy();
    const row = screen.getByText("Beszélgetés olvasatlannal").closest("li")!;
    expect(row.textContent).toContain("2");
  });

  it("nullánál üres állapot", () => {
    expect(messagesWidget.emptyMessage({ total: 0, conversations: 0 })).toBe(
      "Nincs olvasatlan üzenet.",
    );
    expect(
      messagesWidget.emptyMessage({ total: 1, conversations: 1 }),
    ).toBeNull();
  });
});
