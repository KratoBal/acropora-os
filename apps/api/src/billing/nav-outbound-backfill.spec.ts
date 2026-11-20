import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NavInvoiceDigestItem } from "../integrations/nav/nav-online-invoice.client.js";
import { NavApiError } from "../integrations/nav/nav-xml.util.js";
import {
  NavOutboundBackfill,
  classifyNavOutbound,
  issueDateWindows,
  navOutboundSeries,
  parseNavOutboundArgs,
} from "./nav-outbound-backfill.js";

/*
  A KIMENŐ SZÁMLÁK A NAV-BÓL, SZÁRAZON (kártya 785dfea6). MI PIROSÍT: ha egy határnap két ablakba esik (kétszer számolt számla), vagy
  egy nap kimarad; ha a már meglévő számlát (külső sor vagy OS-saját) hiányzónak mondja, vagy a kis- és nagybetű, a szóköz más számlát
  csinál; ha nem a kiállítói oldalt (OUTBOUND) vagy nem a kelt szerint kérdez; ha a NAV második oldalát elhagyja; ha a NAV hibája
  (a 9-es, jogosultság) elnyelődik; ha a parancs írni enged.
*/

const day = (text: string) => new Date(`${text}T00:00:00.000Z`);
const item = (
  invoiceNumber: string,
  over: Partial<NavInvoiceDigestItem> = {},
): NavInvoiceDigestItem => ({
  invoiceNumber,
  invoiceOperation: "CREATE",
  invoiceIssueDate: "2026-05-04",
  insDate: "2026-05-04T08:00:00.000Z",
  customerName: "Állatkert Kft.",
  customerTaxNumber: "15300001",
  ...over,
});

describe("navOutboundSeries", () => {
  it("a sorozat a záró számjegyek nélkül", () => {
    assert.deepEqual(
      ["2026/00090", "ACRW-2026/00571", "E-CRPR-2026-0042", "12345"].map(
        navOutboundSeries,
      ),
      ["2026/", "ACRW-2026/", "E-CRPR-2026-", "(csak szám)"],
    );
  });
});

describe("issueDateWindows", () => {
  it("30 napos ablakok, a határnap egyszer, és minden nap benne van", () => {
    const windows = issueDateWindows(day("2026-01-01"), day("2026-03-05"));
    assert.deepEqual(
      windows.map((w) => [
        w.start.toISOString().slice(0, 10),
        w.end.toISOString().slice(0, 10),
      ]),
      [
        ["2026-01-01", "2026-01-30"],
        ["2026-01-31", "2026-03-01"],
        ["2026-03-02", "2026-03-05"],
      ],
    );
    assert.deepEqual(
      issueDateWindows(day("2026-11-20"), day("2026-11-20")).length,
      1,
    );
  });
});

describe("classifyNavOutbound", () => {
  it("külső sor, OS-saját és hiányzó; a kulcs kis- és nagybetűre, szóközre nem érzékeny; sztornó, módosító, magánszemély", () => {
    const result = classifyNavOutbound(
      [
        item("2026/00058"),
        item("ACRW-2026/00571"),
        item("e-crpr-2026-0042"),
        item("2026/00059", {
          invoiceOperation: "STORNO",
          customerName: undefined,
          customerTaxNumber: undefined,
        }),
        item("2026/00060", { invoiceOperation: "MODIFY" }),
      ],
      {
        external: new Set(["ACRW-2026/00571"]),
        own: new Set(["E-CRPR-2026-0042"]),
      },
      { start: day("2026-05-01"), end: day("2026-05-30") },
    );
    assert.deepEqual(
      {
        seen: result.seen,
        presentExternal: result.presentExternal,
        presentOwn: result.presentOwn,
        missing: result.missing,
        storno: result.storno,
        modification: result.modification,
        privatePerson: result.privatePerson,
        bySeries: result.bySeries,
        missingNumbers: result.missingNumbers,
      },
      {
        seen: 5,
        presentExternal: 1,
        presentOwn: 1,
        missing: 3,
        storno: 1,
        modification: 1,
        privatePerson: 1,
        bySeries: {
          "2026/": { seen: 3, missing: 3 },
          "ACRW-2026/": { seen: 1, missing: 0 },
          "e-crpr-2026-": { seen: 1, missing: 0 },
        },
        missingNumbers: ["2026/00058", "2026/00059", "2026/00060"],
      },
    );
  });
});

describe("NavOutboundBackfill.dryRun", () => {
  const credentials = {
    resolve: async () => ({
      technicalUser: { login: "u" },
      software: { softwareId: "s" },
    }),
  } as never;

  it("kiállítói oldal, kelt szerint, minden oldal; a meglévők a nyilvántartásból", async () => {
    const calls: unknown[][] = [];
    const client = {
      queryInvoiceDigest: async (...args: unknown[]) => {
        calls.push(args);
        const page = args[0] as number;
        return {
          currentPage: page,
          availablePage: 2,
          items: [item(page === 1 ? "2026/00001" : "2026/00002")],
        };
      },
    } as never;
    const asked: string[][] = [];
    const lookup = {
      present: async (numbers: readonly string[]) => {
        asked.push([...numbers]);
        return { external: new Set(["2026/00002"]), own: new Set<string>() };
      },
    };
    const results = await new NavOutboundBackfill(
      client,
      credentials,
      lookup,
    ).dryRun({ from: day("2026-01-01"), to: day("2026-01-10") });
    assert.deepEqual(
      {
        calls: calls.map((c) => [
          c[0],
          c[1],
          (c[2] as Date).toISOString().slice(0, 10),
          (c[3] as Date).toISOString().slice(0, 10),
          c[6],
        ]),
        asked,
        missing: results.map((r) => r.missingNumbers),
      },
      {
        calls: [
          [1, "OUTBOUND", "2026-01-01", "2026-01-10", "invoiceIssueDate"],
          [2, "OUTBOUND", "2026-01-01", "2026-01-10", "invoiceIssueDate"],
        ],
        asked: [["2026/00001", "2026/00002"]],
        missing: [["2026/00001"]],
      },
    );
  });

  it("a NAV hibája (például a 9-es, jogosultság) a hívóhoz jut, nem nyelődik el", async () => {
    const client = {
      queryInvoiceDigest: async () => {
        throw new NavApiError(
          "API_REJECTED",
          "A technikai felhasználónak nincs jogosultsága a művelethez",
        );
      },
    } as never;
    await assert.rejects(
      new NavOutboundBackfill(client, credentials, {
        present: async () => ({ external: new Set(), own: new Set() }),
      }).dryRun({
        from: day("2026-01-01"),
        to: day("2026-01-02"),
      }),
      (error: unknown) =>
        error instanceof NavApiError && /jogosultsága/.test(error.message),
    );
  });
});

describe("parseNavOutboundArgs", () => {
  const now = new Date("2026-11-20T12:00:00.000Z");
  it("--from kötelező, --to alapból ma; írni nem enged", () => {
    const parsed = parseNavOutboundArgs(["--from=2026-01-01"], now);
    assert.deepEqual(
      [parsed.from.toISOString(), parsed.to.toISOString()],
      ["2026-01-01T00:00:00.000Z", "2026-11-20T00:00:00.000Z"],
    );
    assert.throws(() => parseNavOutboundArgs([], now), /Kötelező: --from/);
    assert.throws(
      () => parseNavOutboundArgs(["--from=2026-1-1"], now),
      /ÉÉÉÉ-HH-NN/,
    );
    assert.throws(
      () => parseNavOutboundArgs(["--from=2026-11-21", "--to=2026-11-20"], now),
      /a --to utáni nap/,
    );
    assert.throws(
      () => parseNavOutboundArgs(["--from=2026-01-01", "--apply"], now),
      /csak olvas/,
    );
  });
});
