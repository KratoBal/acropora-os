import { describe, expect, it } from "vitest";

import { assetExportQuery, assetFilterSummary } from "./asset-list-export";
import { assetListQuery } from "./pilot/asset-list-query";

/*
  A NYOMTATÁS ÉS AZ EXCEL KÉRÉSE (kártya 323e9b38). MI PIROSÍT: az export más
  halmazt kér, mint a lista (nem a lista saját kérése, vagy marad benne a
  lapozás); a fejléc nyers kulcsot ír („IN_PLACE”) a fül felirata helyett, vagy
  egy beállított szűrőt elhallgat.
*/
describe("assetExportQuery", () => {
  it("is the list's own query without the paging, so the paper shows the whole filtered set", () => {
    const params = new URLSearchParams(
      "search=lámpa&kind=EQUIPMENT&categoryId=cat-1&departmentIds=u1,u2&page=3&pageSize=50&sort=name&direction=desc",
    );
    const list = assetListQuery(params);
    list.delete("page");
    list.delete("pageSize");
    const exported = assetExportQuery(params);
    expect(exported.toString()).toBe(list.toString());
    expect(exported.has("page")).toBe(false);
    expect(exported.has("pageSize")).toBe(false);
    expect(exported.get("status")).toBe("IN_PLACE");
  });
});

describe("assetFilterSummary", () => {
  it("names every set filter in words, with the tab's label, not its key", () => {
    const params = new URLSearchParams(
      "status=IN_PLACE&search=lámpa&kind=EQUIPMENT&categoryId=cat-1&ownerId=s1&ownerType=SUPPLIER&departmentIds=u1,u2&label=without",
    );
    expect(
      assetFilterSummary(params, {
        categoryName: (id) => (id === "cat-1" ? "Világítás" : undefined),
        ownerName: "Fővárosi Állatkert",
      }),
    ).toEqual([
      "Állapot: Beépített",
      "Keresés: „lámpa”",
      "Típus: Berendezés",
      "Kategória: Világítás",
      "Tulajdonos: Fővárosi Állatkert",
      "Helyszín: 2 kiválasztott egység",
      "Matrica: nincs matricája",
    ]);
  });

  it("unset filters stay out; 'all' and 'no category' are said as such", () => {
    expect(
      assetFilterSummary(new URLSearchParams("status=ALL&category=without")),
    ).toEqual(["Állapot: Összes", "Kategória: nincs kategória"]);
  });
});
