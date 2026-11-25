import { describe, expect, it } from "vitest";

import { nextSortParams, sortFromParams } from "./use-url-sort";

/**
 * A RENDEZÉS AZ URL-BEN (Balázs kérése, kártya 2f6369a4). Mi pirosít: ha egy ismeretlen mező vagy irány rendezést állít; ha a
 * kattintás sorrendje nem "növekvő, csökkenő, alap"; ha egy másik oszlop nem növekvőben indul; ha az oszlop azonosítója és a szerver
 * mezője összekeveredik; ha egy nem rendezhető oszlop (a térképben nincs) rendezést indít.
 */
const COLUMNS = { quote: "quoteNumber", created: "createdAt" } as const;
const params = (query: string) => new URLSearchParams(query);

describe("sortFromParams", () => {
  it("reads a known column from the server field and the direction", () => {
    expect(
      sortFromParams(params("sort=createdAt&direction=desc"), COLUMNS),
    ).toEqual({
      id: "created",
      direction: "desc",
    });
    expect(
      sortFromParams(params("sort=quoteNumber&direction=asc"), COLUMNS),
    ).toEqual({
      id: "quote",
      direction: "asc",
    });
  });

  it("is null without a sort, with an unknown field, a bad direction or no direction", () => {
    expect(sortFromParams(params(""), COLUMNS)).toBeNull();
    expect(
      sortFromParams(params("sort=title&direction=asc"), COLUMNS),
    ).toBeNull();
    expect(
      sortFromParams(params("sort=createdAt&direction=sideways"), COLUMNS),
    ).toBeNull();
    expect(sortFromParams(params("sort=createdAt"), COLUMNS)).toBeNull();
  });
});

describe("nextSortParams", () => {
  it("goes ascending, descending, then back to the default", () => {
    expect(nextSortParams(null, "created", COLUMNS)).toEqual({
      sort: "createdAt",
      direction: "asc",
    });
    expect(
      nextSortParams({ id: "created", direction: "asc" }, "created", COLUMNS),
    ).toEqual({ sort: "createdAt", direction: "desc" });
    expect(
      nextSortParams({ id: "created", direction: "desc" }, "created", COLUMNS),
    ).toEqual({ sort: null, direction: null });
  });

  it("starts another column ascending", () => {
    expect(
      nextSortParams({ id: "created", direction: "desc" }, "quote", COLUMNS),
    ).toEqual({ sort: "quoteNumber", direction: "asc" });
  });

  it("clears the sort for a column that is not sortable", () => {
    expect(nextSortParams(null, "partner", COLUMNS)).toEqual({
      sort: null,
      direction: null,
    });
  });
});
