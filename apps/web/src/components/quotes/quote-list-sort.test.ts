import { describe, expect, it } from "vitest";

import { nextSortParams, sortOf } from "./quote-list-sort";

/**
 * A RENDEZÉS AZ URL-BEN. Mi pirosít: ha egy ismeretlen mező vagy irány rendezést állít; ha a kattintás sorrendje nem
 * "növekvő, csökkenő, alap"; ha egy másik oszlop nem növekvőben indul; ha az oszlop azonosítója és az API mezője összekeveredik.
 */
const params = (query: string) => new URLSearchParams(query);

describe("sortOf", () => {
  it("reads a known column from the API field and the direction", () => {
    expect(sortOf(params("sort=createdAt&direction=desc"))).toEqual({
      id: "created",
      direction: "desc",
    });
    expect(sortOf(params("sort=quoteNumber&direction=asc"))).toEqual({
      id: "quote",
      direction: "asc",
    });
  });

  it("is null without a sort, with an unknown field or with a bad direction", () => {
    expect(sortOf(params(""))).toBeNull();
    expect(sortOf(params("sort=title&direction=asc"))).toBeNull();
    expect(sortOf(params("sort=createdAt&direction=sideways"))).toBeNull();
    expect(sortOf(params("sort=createdAt"))).toBeNull();
  });
});

describe("nextSortParams", () => {
  it("goes ascending, descending, then back to the default", () => {
    const first = nextSortParams(null, "created");
    expect(first).toEqual({ sort: "createdAt", direction: "asc" });
    const second = nextSortParams(
      { id: "created", direction: "asc" },
      "created",
    );
    expect(second).toEqual({ sort: "createdAt", direction: "desc" });
    const third = nextSortParams(
      { id: "created", direction: "desc" },
      "created",
    );
    expect(third).toEqual({ sort: null, direction: null });
  });

  it("starts another column ascending", () => {
    expect(
      nextSortParams({ id: "created", direction: "desc" }, "status"),
    ).toEqual({ sort: "status", direction: "asc" });
  });

  it("clears the sort for a column that is not sortable", () => {
    expect(nextSortParams(null, "partner")).toEqual({
      sort: null,
      direction: null,
    });
  });
});
