import { describe, expect, it } from "vitest";

import { assetListQuery, ASSET_SORT_COLUMNS } from "./asset-list-query";

/*
  AZ ESZKÖZLISTA RENDEZÉSE A KÉRÉSBEN (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha egy ismert mező (név, állapot, elhelyezés) nem
  jut a kérésbe, akár irány nélkül (a régi lista is így írta, a szerver növekvőnek veszi); ha egy ismeretlen mező vagy irány (régi vagy
  kézzel írt link) igen (az API 400-at adna, és az egész lista eltörne); ha egy irány mező nélkül átmegy.
*/
describe("assetListQuery rendezés", () => {
  const sortOf = (search: string) => {
    const query = assetListQuery(new URLSearchParams(search));
    return { sort: query.get("sort"), direction: query.get("direction") };
  };

  it("az ismert mezőt és az érvényes irányt átadja", () => {
    for (const field of ["name", "status", "placement"])
      for (const direction of ["asc", "desc"])
        expect(sortOf(`sort=${field}&direction=${direction}`)).toEqual({
          sort: field,
          direction,
        });
  });

  it("az ismert mezőt irány nélkül is átadja, irány nélkül", () => {
    expect(sortOf("sort=status")).toEqual({ sort: "status", direction: null });
  });

  it("az ismeretlen mezőt és az érvénytelen irányt eldobja, a többi paramétert érintetlenül hagyja", () => {
    expect(sortOf("sort=category&direction=asc")).toEqual({
      sort: null,
      direction: null,
    });
    expect(sortOf("sort=name&direction=up")).toEqual({
      sort: "name",
      direction: null,
    });
    expect(sortOf("direction=desc")).toEqual({ sort: null, direction: null });
    const query = assetListQuery(
      new URLSearchParams("sort=junk&search=lámpa&departmentIds=u1"),
    );
    expect(Object.fromEntries(query)).toEqual({
      search: "lámpa",
      departmentIds: "u1",
      page: "1",
      pageSize: "25",
      status: "IN_PLACE",
    });
  });

  it("az oszlop-térkép a szerver fehér listáját fedi: név, elhelyezés, állapot", () => {
    expect(Object.values(ASSET_SORT_COLUMNS).sort()).toEqual([
      "name",
      "placement",
      "status",
    ]);
  });
});
