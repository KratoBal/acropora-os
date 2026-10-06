import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assetListQuery,
  manualFilterOf,
  withManualFilter,
} from "./asset-list-query";

/*
  A KÉZIKÖNYV-SZŰRŐ A WEBES LISTÁN (kártya 1277394e). MI PIROSÍT: ha a szűrő
  nem a `document` + `documentType=MANUAL` párt írja; ha a „mind” egy fél párt
  hagy az URL-ben; ha nem az első lapra visz; ha a lista kérése nem viszi a
  szervernek; ha a lap nem ezt a két függvényt használja.
*/
const params = (text: string) => new URLSearchParams(text);

describe("the manual filter on the asset list", () => {
  it("writes the pair, keeps the other filters, and goes to page one", () => {
    const next = withManualFilter(
      params("search=Astral&kind=EQUIPMENT&page=3"),
      "without",
    );
    expect(next.get("document")).toBe("without");
    expect(next.get("documentType")).toBe("MANUAL");
    expect(next.get("search")).toBe("Astral");
    expect(next.get("kind")).toBe("EQUIPMENT");
    expect(next.get("page")).toBe("1");
  });

  it("'all' removes both halves", () => {
    const next = withManualFilter(
      params("document=with&documentType=MANUAL"),
      "",
    );
    expect(next.has("document")).toBe(false);
    expect(next.has("documentType")).toBe(false);
  });

  it("reads back from the URL, and a foreign type is not shown as the manual filter", () => {
    expect(manualFilterOf(params("document=with&documentType=MANUAL"))).toBe(
      "with",
    );
    expect(
      manualFilterOf(params("document=without&documentType=WARRANTY")),
    ).toBe("");
    expect(manualFilterOf(params("documentType=MANUAL"))).toBe("");
  });

  it("the list request carries it to the server", () => {
    const query = assetListQuery(withManualFilter(params(""), "without"));
    expect(query.get("document")).toBe("without");
    expect(query.get("documentType")).toBe("MANUAL");
  });

  it("the page uses these two, behind a 'Kézikönyv' select", () => {
    const source = readFileSync(
      "src/components/service-assets/pilot/pilot-asset-list-page.tsx",
      "utf8",
    );
    expect(source).toMatch(/withManualFilter\(params, value\)/);
    expect(source).toMatch(
      /const manualFilterValue = manualFilterOf\(params\);/,
    );
    expect(source).toMatch(
      /aria-label="Kézikönyv"\s+value=\{manualFilterValue\}/,
    );
  });
});
