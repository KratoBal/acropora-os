import { render, screen } from "@testing-library/react";
import type { BillingDocumentType } from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import { BillingDocumentTypeSelector } from "./billing-document-type-selector";

/**
 * A VÉGSZÁMLA A TÍPUSVÁLASZTÓN (számlázási brief, 3. pont). MI PIROSÍT: üres
 * lapon a végszámla is választható (a szerver elutasítaná: nincs előlege);
 * egy végszámla-vázlaton más típusra lehet váltani (a szerver azt is
 * elutasítaná: a végszámla az előlegéhez kötött).
 */
const radios = (documentType: BillingDocumentType) => {
  render(
    <BillingDocumentTypeSelector
      documentType={documentType}
      format="ELECTRONIC"
      onTypeChange={vi.fn()}
      onFormatChange={vi.fn()}
      source={null}
      hiddenNote={null}
    />,
  );
  return screen
    .getAllByRole("radio")
    .map(
      (radio) =>
        radio.getAttribute("aria-label") ?? radio.closest("label")?.textContent,
    )
    .filter((name) => name && !["E-számla", "Papír alapú"].includes(name));
};

describe("the document type selector", () => {
  it("an empty page offers no final invoice", () => {
    expect(radios("INVOICE")).toEqual([
      "Számla",
      "Díjbekérő",
      "Előlegszámla",
      "Szállítólevél",
    ]);
  });

  it("a final invoice's draft offers nothing else", () => {
    expect(radios("FINAL_INVOICE")).toEqual(["Végszámla"]);
  });
});
