import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The editor's imports reach the Inter font loader, which only runs inside Next.
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font-inter", variable: "--font-inter" }),
}));

import { BillingDocumentLineEditor } from "./billing-document-line-editor";
import { emptyLine } from "./billing-editor-state";

/*
  A TETELSOROK TELEFONON KARTYAKENT (UI-attekintes, stage-foto 2026-11-03, 390 px: a 760 px-es
  tabla a kartyaban levagva jelent meg). A DOM-ban nincs layout, ezert az osztalyokat meri a
  teszt: a fo sor `md` alatt ketoszlopos racs, a tablatest es a sorok `block`, a fejlec csak
  kepernyo-olvasonak marad, es minden mezonek van `data-label` cimkeje (a telefon-cimke ebbol
  jon, a DOM-ban nincs duplikalt szoveg).
*/
function renderEditor() {
  return render(
    <BillingDocumentLineEditor
      token="t"
      lines={[emptyLine({ description: "Teszt tétel", unitNet: "1000" })]}
      amounts={null}
      currency="HUF"
      onChange={() => {}}
      onLineUpdate={() => {}}
    />,
  );
}

describe("a számla tételsorai telefonon", () => {
  it("a tábla md alatt blokk, a fejléc csak képernyő-olvasónak marad", () => {
    const { container } = renderEditor();
    expect(container.querySelector("table")?.className).toContain(
      "max-md:block",
    );
    expect(container.querySelector("thead")?.className).toContain(
      "max-md:sr-only",
    );
    expect(container.querySelector("tbody")?.className).toContain(
      "max-md:block",
    );
  });

  it("a fő sor md alatt kétoszlopos rács, a megnevezés teljes szélességű", () => {
    const { container } = renderEditor();
    const row = container.querySelector("tbody tr");
    expect(row?.className).toContain("max-md:grid");
    expect(row?.className).toContain("max-md:grid-cols-2");
    expect(row?.querySelector("td")?.className).toContain("max-md:col-span-2");
  });

  it("minden szám- és egység-mezőnek van telefon-cimkéje", () => {
    const { container } = renderEditor();
    const labels = [...container.querySelectorAll("tbody tr td[data-label]")]
      .map((td) => td.getAttribute("data-label"))
      .sort();
    expect(labels).toEqual(
      [
        "Mennyiség",
        "Egység",
        "Nettó egységár",
        "ÁFA",
        "Kedvezmény (%)",
        "Bruttó",
      ].sort(),
    );
    for (const td of container.querySelectorAll("tbody tr td[data-label]"))
      expect(td.className).toContain(
        "max-md:before:content-[attr(data-label)]",
      );
  });

  it("a bemenetek címkéi (aria-label) változatlanok", () => {
    const { getByLabelText } = renderEditor();
    for (const noun of [
      "mennyisége",
      "egysége",
      "nettó egységára",
      "ÁFA-kulcsa",
      "kedvezménye (%)",
      "bruttó összege",
    ])
      expect(getByLabelText(`Teszt tétel ${noun}`)).toBeTruthy();
  });
});
