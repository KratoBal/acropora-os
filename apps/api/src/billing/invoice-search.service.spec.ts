import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  InvoiceSearchService,
  mergeNewestFirst,
} from "./invoice-search.service.js";

/*
  MI PIROSÍT (T2.2, 1. szelet): ha a találat útvonala eltér a lista soráétól (a vázlat a szerkesztőre,
  a külső bizonylat a külső adatlapra, a bejövő a bejövő adatlapra nyílik); ha a legfrissebb nem áll
  elöl, vagy az összes találat több mint öt; ha a bejövő keresés nem néz számlaszámot, szállítót,
  adószámot és rendelésszámot; ha a bejövő összeg nincs formázva a pénznemmel; ha a vázlat
  számlaszám nélkül üres címet kapna.
*/
function service(options: {
  outgoing?: Array<Record<string, unknown>>;
  incoming?: Array<Record<string, unknown>>;
}) {
  const calls: { listQuery?: unknown; incomingArgs?: unknown } = {};
  const instance = new InvoiceSearchService({
    list: async (query: unknown) => {
      calls.listQuery = query;
      return { items: options.outgoing ?? [] };
    },
  } as never);
  Object.defineProperty(instance, "database", {
    value: {
      incomingBillingDocument: {
        findMany: async (args: unknown) => {
          calls.incomingArgs = args;
          return options.incoming ?? [];
        },
      },
    },
  });
  return { instance, calls };
}

const out = (over: Record<string, unknown>) => ({
  id: "o1",
  documentNumber: "KI-2026/1",
  customerName: "Vevő Kft.",
  grossAmount: "12700",
  currency: "HUF",
  issueDate: "2026-10-10",
  opens: "DETAIL",
  origin: "OWN",
  ...over,
});
const inc = (over: Record<string, unknown>) => ({
  id: "i1",
  documentNumber: "BE-77",
  supplierName: "Szállító Kft.",
  grossAmount: new Prisma.Decimal("5080"),
  currency: "HUF",
  issueDate: new Date("2026-10-12T00:00:00Z"),
  ...over,
});

describe("InvoiceSearchService", () => {
  it("opens each kind where the list opens it: editor, detail, external detail, incoming detail", async () => {
    const { instance } = service({
      outgoing: [
        out({ id: "d", opens: "EDITOR", issueDate: "2026-10-01" }),
        out({ id: "x", opens: "DETAIL", issueDate: "2026-10-02" }),
        out({
          id: "e",
          opens: "EXTERNAL_DETAIL",
          origin: "EXTERNAL",
          issueDate: "2026-10-03",
        }),
      ],
      incoming: [
        inc({ id: "i9", issueDate: new Date("2026-10-04T00:00:00Z") }),
      ],
    });
    const result = await instance.search("kft");
    assert.deepEqual(
      result.map((r) => [r.id, r.path]),
      [
        ["incoming:i9", "/penzugy/szamlazas/bejovo/i9"],
        ["document:e", "/penzugy/szamlazas/kulso/e"],
        ["document:x", "/penzugy/szamlazas/x"],
        ["document:d", "/penzugy/szamlazas/d/szerkesztes"],
      ],
    );
  });

  it("labels the kind and formats the amount with its currency; a draft without a number is a draft", async () => {
    const { instance } = service({
      outgoing: [
        out({ documentNumber: null, id: "draft", opens: "EDITOR" }),
        out({
          id: "ext",
          origin: "EXTERNAL",
          opens: "EXTERNAL_DETAIL",
          issueDate: "2026-09-01",
        }),
      ],
      incoming: [
        inc({
          currency: "EUR",
          grossAmount: new Prisma.Decimal("100.5"),
          issueDate: new Date("2026-08-01T00:00:00Z"),
        }),
      ],
    });
    const result = await instance.search("kft");
    const byId = Object.fromEntries(result.map((r) => [r.id, r]));
    assert.equal(byId["document:draft"]!.title, "Vázlat");
    assert.match(
      byId["document:draft"]!.subtitle,
      /^Kimenő számla · Vevő Kft\. · 12\s700\sFt$/,
    );
    assert.match(byId["document:ext"]!.subtitle, /^Külső számla/);
    assert.match(
      byId["incoming:i1"]!.subtitle,
      /^Bejövő számla · Szállító Kft\. · 100,50\sEUR$/,
    );
  });

  it("returns at most five, the newest first", async () => {
    const outgoing = Array.from({ length: 5 }, (_, n) =>
      out({ id: `o${n}`, issueDate: `2026-09-0${n + 1}` }),
    );
    const incoming = Array.from({ length: 5 }, (_, n) =>
      inc({ id: `i${n}`, issueDate: new Date(`2026-10-0${n + 1}T00:00:00Z`) }),
    );
    const { instance } = service({ outgoing, incoming });
    const result = await instance.search("kft");
    assert.equal(result.length, 5);
    assert.deepEqual(
      result.map((r) => r.id),
      [
        "incoming:i4",
        "incoming:i3",
        "incoming:i2",
        "incoming:i1",
        "incoming:i0",
      ],
    );
  });

  it("asks the outgoing list for the query on page 1, and the incoming table for number, supplier, tax number and order number", async () => {
    const { instance, calls } = service({});
    await instance.search("12345678");
    assert.deepEqual(calls.listQuery, { q: "12345678", page: 1, pageSize: 5 });
    const where = (
      calls.incomingArgs as { where: { OR: Array<Record<string, unknown>> } }
    ).where;
    assert.deepEqual(where.OR.map((c) => Object.keys(c)[0]).sort(), [
      "documentNumber",
      "orderNumber",
      "supplierName",
      "supplierTaxNumber",
    ]);
    assert.equal((calls.incomingArgs as { take: number }).take, 5);
  });

  it("keeps the arrival order for the same day (stable)", () => {
    const item = (id: string) => ({ id, title: id, subtitle: "", path: "/" });
    assert.deepEqual(
      mergeNewestFirst([
        { day: "2026-10-01", item: item("a") },
        { day: "2026-10-01", item: item("b") },
        { day: "2026-10-02", item: item("c") },
        { day: "", item: item("draft") },
      ]).map((i) => i.id),
      ["c", "a", "b", "draft"],
    );
  });
});
