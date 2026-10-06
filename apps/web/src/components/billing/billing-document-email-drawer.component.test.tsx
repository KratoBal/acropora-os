import { fireEvent, render, screen, within } from "@testing-library/react";
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

/**
 * A FIÓK KÉT ÁGA (Balázs, 2026-10-06 09:21 UTC). MI PIROSÍT:
 * - a szerkesztőből nyitva (submit nélkül) tiltott, a Számlázz.hu bekötésére
 *   váró gomb vagy mondat maradna, holott a kiállítás és a kiküldés a
 *   szerkesztő fő gombja; a „Kész” nem zárná be a fiókot, vagy a levelet
 *   eldobná (onChange-et hívna);
 * - az új sor nem a fő gomb valódi feliratát nevezné meg;
 * - a részletek oldali ág (submit-tal) megváltozna.
 */
describe("BillingDocumentEmailDrawer: from the editor and from the details page", () => {
  const draft = {
    to: "szamlazas@partner.hu",
    cc: "",
    bcc: "",
    subject: "Tárgy",
    bodyHtml: "<p>Szia</p>",
  };
  const open = (
    extra: Record<string, unknown> = {},
    format: "ELECTRONIC" | "PAPER" = "ELECTRONIC",
  ) => {
    const onClose = vi.fn();
    const onChange = vi.fn();
    render(
      <BillingDocumentEmailDrawer
        open
        onClose={onClose}
        documentType="INVOICE"
        format={format}
        draft={draft}
        onChange={onChange}
        customerName="Vevő Kft."
        grossLabel="1 000 Ft"
        meta=""
        known={{}}
        {...extra}
      />,
    );
    return { dialog: screen.getByRole("dialog"), onClose, onChange };
  };

  it("from the editor: 'Kész' closes and keeps the letter, and names the button that sends it", () => {
    const { dialog, onClose, onChange } = open();
    expect(within(dialog).queryByText(/Számlázz.hu bekötésével/)).toBeNull();
    expect(
      within(dialog).queryByRole("button", {
        name: "E-számla kiállítása és elküldése",
      }),
    ).toBeNull();
    expect(
      within(dialog).getByText(
        "A levelet a „Kiállítás és kiküldés” gomb küldi el.",
      ),
    ).toBeInTheDocument();
    const done = within(dialog).getByRole("button", { name: "Kész" });
    expect(done).toBeEnabled();
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("from the editor, a paper invoice: the line names that button", () => {
    const { dialog } = open({}, "PAPER");
    expect(
      within(dialog).getByText(
        "A levelet a „Számla kiállítása” gomb küldi el.",
      ),
    ).toBeInTheDocument();
  });

  it("from the details page (with submit): unchanged, its own send button and no 'Kész'", () => {
    const onSubmit = vi.fn();
    const { dialog } = open({
      submit: {
        label: "Levél újraküldése",
        busy: false,
        error: null,
        onSubmit,
      },
    });
    expect(within(dialog).queryByRole("button", { name: "Kész" })).toBeNull();
    expect(within(dialog).queryByText(/gomb küldi el/)).toBeNull();
    expect(
      within(dialog).getByText(
        "A levél újraküldése nem állít ki új bizonylatot.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Levél újraküldése" }),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
