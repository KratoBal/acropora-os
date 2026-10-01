import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

import { BillingDocumentEmailDrawer } from "./billing-document-email-drawer";

/**
 * KÉPTÁR NÉLKÜL (se számlaküldési, se beállítás-kezelési jog): a sablon képe
 * a levélben kimegy, de a drawer nem tudja megmutatni. MI PIROSÍT: ha ezt nem
 * mondaná ki (üres doboz magyarázat nélkül), vagy ha a kép gomb megjelenne.
 */
describe("BillingDocumentEmailDrawer without the image library", () => {
  const drawer = (bodyHtml: string) =>
    render(
      <BillingDocumentEmailDrawer
        open
        onClose={() => {}}
        documentType="INVOICE"
        format="ELECTRONIC"
        draft={{ to: "", cc: "", bcc: "", subject: "Tárgy", bodyHtml }}
        onChange={() => {}}
        customerName="Vevő Kft."
        grossLabel="1 000 Ft"
        meta=""
        known={{}}
      />,
    );

  it("names the image it cannot show, and offers no image button", () => {
    drawer('<p><img src="acropora-image:logo1" alt="Logó"></p>');
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/A levélben kép is van/),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Kép beszúrása" }),
    ).toBeNull();
  });

  it("says nothing when the letter has no image", () => {
    drawer("<p>Kedves vevő!</p>");
    expect(screen.queryByText(/A levélben kép is van/)).toBeNull();
  });
});
