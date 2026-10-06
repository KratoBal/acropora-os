import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPECTED_ARRIVAL_LIST_PAGE_SIZE,
  type ExpectedArrivalListItem,
  type ExpectedArrivalListResponse,
} from "@acropora/types";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { ExpectedArrivalListQueryDto } from "./expected-arrival-list-query.dto.js";
import { pageArrivalList } from "./expected-arrival.service.js";

/*
  KÁRTYA dd0aef31 (barracuda 2026-10-06: a Sutyerák egyetlen valódi csonkulása):
  a lista a `limit`-et figyelmen kívül hagyta, és mindig a teljes, 59 536 bájtos
  választ adta. MI PIROSÍT: ha lapozó mező nélkül változik a válasz (a webes
  oldal így kéri); ha a `limit` hatástalan marad; ha a lapozás a szűrés ELŐTT
  vág; ha a lapozott válasz nem mondja meg a teljes méretet.
*/
const item = (
  id: string,
  source: "MAIL" | "NAV",
  supplierName: string,
  invoiceNumber: string | null = null,
): ExpectedArrivalListItem => ({
  source,
  id,
  supplierName,
  supplierId: null,
  orderReference: null,
  invoiceNumber,
  stage: "INVOICE",
  arrivedAt: `2026-10-0${id.length}T00:00:00.000Z`,
  invoiceDate: null,
  currency: "HUF",
  netTotal: null,
  lineCount: null,
  suggestedLineCount: null,
  editorPath: null,
});
const FULL: ExpectedArrivalListResponse = {
  items: [
    item("a", "MAIL", "Hertlein Aquaristik", "261582"),
    item("b", "NAV", "Fluidra Magyarország Kft.", "KS26/05898"),
    item("c", "MAIL", "Marine Aquatics", "32600585"),
    item("d", "NAV", "UNAS Online Kft.", "UO-418953/2026"),
    item("e", "NAV", "Hertlein Aquaristik", "261685"),
  ],
  dismissed: [item("x", "MAIL", "Kivett Kft.")],
};

describe("pageArrivalList", () => {
  it("without a paging field returns the full list, without pagination", () => {
    assert.deepEqual(pageArrivalList(FULL, {}), FULL);
  });

  it("limit is pageSize's other name, and the answer says the full size", () => {
    const page = pageArrivalList(FULL, { limit: 2 });
    assert.deepEqual(
      page.items.map((i) => i.id),
      ["a", "b"],
    );
    assert.deepEqual(page.pagination, {
      page: 1,
      pageSize: 2,
      totalItems: 5,
      totalPages: 3,
    });
    assert.deepEqual(page.dismissed, FULL.dismissed);
  });

  it("pages after filtering, by source and by a name or number part", () => {
    assert.deepEqual(
      pageArrivalList(FULL, { source: "NAV", page: 2, pageSize: 1 }).items.map(
        (i) => i.id,
      ),
      ["d"],
    );
    const hertlein = pageArrivalList(FULL, { q: "hertlein", pageSize: 10 });
    assert.deepEqual(
      hertlein.items.map((i) => i.id),
      ["a", "e"],
    );
    assert.equal(hertlein.pagination?.totalItems, 2);
    assert.deepEqual(
      pageArrivalList(FULL, { q: "ks26/05" }).items.map((i) => i.id),
      ["b"],
    );
  });

  it("a page alone uses the default size", () => {
    assert.equal(
      pageArrivalList(FULL, { page: 1 }).pagination?.pageSize,
      EXPECTED_ARRIVAL_LIST_PAGE_SIZE.default,
    );
  });
});

describe("the expected-arrivals list query", () => {
  const errors = (raw: Record<string, string>) =>
    validateSync(plainToInstance(ExpectedArrivalListQueryDto, raw)).map(
      (e) => e.property,
    );

  it("accepts page, pageSize, limit, source and q, and nothing is required", () => {
    assert.deepEqual(errors({}), []);
    assert.deepEqual(
      errors({
        page: "2",
        pageSize: "20",
        limit: "20",
        source: "NAV",
        q: "UNAS",
      }),
      [],
    );
  });

  it("refuses a size over the maximum and an unknown source", () => {
    assert.deepEqual(
      errors({ limit: String(EXPECTED_ARRIVAL_LIST_PAGE_SIZE.max + 1) }),
      ["limit"],
    );
    assert.deepEqual(errors({ source: "EMAIL" }), ["source"]);
  });
});
