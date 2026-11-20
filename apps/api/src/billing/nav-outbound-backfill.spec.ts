import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NavInvoiceDigestItem } from "../integrations/nav/nav-online-invoice.client.js";
import { NavApiError } from "../integrations/nav/nav-xml.util.js";
import {
  NAV_PRIVATE_PERSON_NAME,
  NavOutboundBackfill,
  NavOutboundPageLimitError,
  type NavOutboundWriter,
  classifyNavOutbound,
  issueDateWindows,
  navOutboundRow,
  navOutboundSeries,
  parseNavOutboundArgs,
} from "./nav-outbound-backfill.js";

/*
  A KIMENŐ SZÁMLÁK A NAV-BÓL, SZÁRAZON (kártya 785dfea6). MI PIROSÍT: ha egy határnap két ablakba esik (kétszer számolt számla), vagy
  egy nap kimarad; ha a már meglévő számlát (külső sor vagy OS-saját) hiányzónak mondja, vagy a kis- és nagybetű, a szóköz más számlát
  csinál; ha nem a kiállítói oldalt (OUTBOUND) vagy nem a kelt szerint kérdez; ha a NAV második oldalát elhagyja; ha a NAV hibája
  (a 9-es, jogosultság) elnyelődik. ÍRÁS (PR 2): ha a száraz futás írna; ha a már meglévő számlát is felvenné; ha az ötvenedik oldal
  után csendben vágna; ha a sor nem a NAV-forrás jelét viseli (kulcs, fajta, fizetés nem ismert, PDF-ok), vagy összeg nélkül is
  felvenné.
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

describe("navOutboundRow", () => {
  it("a NAV-forrás sora: kulcs, fajta, kelt, összeg, vevő; fizetés nem ismert, PDF a NAV-tól nincs", () => {
    const row = navOutboundRow(
      item(" acrw-2026/00571 ", {
        invoiceIssueDate: "2026-05-04",
        invoiceDeliveryDate: "2026-05-03",
        paymentDate: "2026-05-12",
        insDate: "2026-05-05T09:30:00.000Z",
        currency: "huf",
        invoiceNetAmount: "100000",
        invoiceVatAmount: "27000",
        paymentMethod: "TRANSFER",
        invoiceAppearance: "ELECTRONIC",
        transactionId: "4T7XQ",
        index: 3,
      }),
    );
    assert.deepEqual(
      {
        ...row,
        feedReceivedAt: (row!.feedReceivedAt as Date).toISOString(),
        issueDate: (row!.issueDate as Date).toISOString().slice(0, 10),
        fulfillmentDate: (row!.fulfillmentDate as Date)
          .toISOString()
          .slice(0, 10),
        dueDate: (row!.dueDate as Date).toISOString().slice(0, 10),
      },
      {
        source: "NAV",
        externalId: "ACRW-2026/00571",
        feedMessageId: "NAV:4T7XQ:3",
        feedReceivedAt: "2026-05-05T09:30:00.000Z",
        kindCode: "SZ",
        documentNumber: "acrw-2026/00571",
        electronic: true,
        issueDate: "2026-05-04",
        fulfillmentDate: "2026-05-03",
        dueDate: "2026-05-12",
        paymentMethod: "átutalás",
        paymentMethodUnified: null,
        currency: "HUF",
        customerName: "Állatkert Kft.",
        customerTaxNumber: "15300001",
        netAmount: "100000.00",
        vatAmount: "27000.00",
        grossAmount: "127000.00",
        lines: [],
        paymentsKnown: null,
        pdfMissingReason: "NAV_NO_PDF",
      },
    );
  });

  it("sztornó és módosító fajtája; papír; magánszemély; ismeretlen fizetési mód; összeg nélkül nincs sor", () => {
    const base = { invoiceNetAmount: "-10", invoiceVatAmount: "-2.7" };
    const storno = navOutboundRow(
      item("2026/00059", {
        ...base,
        invoiceOperation: "STORNO",
        invoiceAppearance: "PAPER",
        customerName: undefined,
        customerTaxNumber: undefined,
        paymentMethod: "BARTER",
      }),
    )!;
    assert.deepEqual(
      [
        storno.kindCode,
        storno.electronic,
        storno.customerName,
        storno.customerTaxNumber,
        storno.paymentMethod,
        storno.grossAmount,
        storno.feedMessageId,
        storno.fulfillmentDate,
        storno.dueDate,
      ],
      [
        "SS",
        false,
        NAV_PRIVATE_PERSON_NAME,
        null,
        "BARTER",
        "-12.70",
        "NAV:-:0",
        null,
        null,
      ],
    );
    assert.equal(
      navOutboundRow(
        item("2026/00060", { ...base, invoiceOperation: "MODIFY" }),
      )!.kindCode,
      "HS",
    );
    assert.equal(
      navOutboundRow(item("2026/00061", { invoiceNetAmount: "1" })),
      null,
    );
    assert.equal(
      navOutboundRow(item("2026/00062", { invoiceVatAmount: "1" })),
      null,
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
    const results = await new NavOutboundBackfill(client, credentials, lookup, {
      write: async () => assert.fail("a száraz futás nem ír"),
    }).dryRun({ from: day("2026-01-01"), to: day("2026-01-10") });
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

describe("NavOutboundBackfill.run", () => {
  const credentials = {
    resolve: async () => ({
      technicalUser: { login: "u" },
      software: { softwareId: "s" },
    }),
  } as never;
  const none = {
    present: async () => ({
      external: new Set<string>(),
      own: new Set<string>(),
    }),
  };

  it("--apply: csak a hiányzók mennek az íróhoz, ablakonként egyszer, és az eredménye az ablak sorába kerül", async () => {
    const client = {
      queryInvoiceDigest: async (_page: number, _d: string, from: Date) => ({
        currentPage: 1,
        availablePage: 1,
        items:
          from.toISOString().slice(0, 10) === "2026-01-01"
            ? [item("2026/00001"), item("2026/00002"), item("E-CRPR-2026-7")]
            : [item("2026/00003")],
      }),
    } as never;
    const lookup = {
      present: async () => ({
        external: new Set(["2026/00002"]),
        own: new Set(["E-CRPR-2026-7"]),
      }),
    };
    const written: string[][] = [];
    const writer: NavOutboundWriter = {
      write: async (items) => {
        written.push(items.map((i) => i.invoiceNumber));
        return { created: items.length, cancelled: 0, skippedNoAmount: 0 };
      },
    };
    const results = await new NavOutboundBackfill(
      client,
      credentials,
      lookup,
      writer,
    ).run({ from: day("2026-01-01"), to: day("2026-02-05"), apply: true });
    assert.deepEqual(written, [["2026/00001"], ["2026/00003"]]);
    assert.deepEqual(
      results.map((r) => [
        r.seen,
        r.missing,
        r.created,
        r.cancelled,
        r.skippedNoAmount,
      ]),
      [
        [3, 1, 1, 0, 0],
        [1, 1, 1, 0, 0],
      ],
    );
  });

  it("az ötvenedik oldal után hiba, az ablak megnevezésével; írás nincs", async () => {
    let calls = 0;
    const client = {
      queryInvoiceDigest: async (page: number) => {
        calls += 1;
        return {
          currentPage: page,
          availablePage: 51,
          items: [item(`2026/${page}`)],
        };
      },
    } as never;
    await assert.rejects(
      new NavOutboundBackfill(client, credentials, none, {
        write: async () => assert.fail("csonka ablakot nem írunk"),
      }).run({ from: day("2026-03-02"), to: day("2026-03-05"), apply: true }),
      (error: unknown) =>
        error instanceof NavOutboundPageLimitError &&
        /2026-03-02 \.\. 2026-03-05/.test(error.message) &&
        /51 oldalt/.test(error.message),
    );
    assert.equal(calls, 50);
  });

  it("pontosan ötven oldal még nem hiba", async () => {
    const client = {
      queryInvoiceDigest: async (page: number) => ({
        currentPage: page,
        availablePage: 50,
        items: [item(`2026/${page}`)],
      }),
    } as never;
    const [result] = await new NavOutboundBackfill(
      client,
      credentials,
      none,
    ).dryRun({
      from: day("2026-03-02"),
      to: day("2026-03-05"),
    });
    assert.equal(result!.seen, 50);
  });
});

describe("parseNavOutboundArgs", () => {
  const now = new Date("2026-11-20T12:00:00.000Z");
  it("--from kötelező, --to alapból ma; alapból száraz, --apply-jal ír", () => {
    const parsed = parseNavOutboundArgs(["--from=2026-01-01"], now);
    assert.deepEqual(
      [parsed.from.toISOString(), parsed.to.toISOString(), parsed.apply],
      ["2026-01-01T00:00:00.000Z", "2026-11-20T00:00:00.000Z", false],
    );
    assert.equal(
      parseNavOutboundArgs(["--from=2026-01-01", "--apply"], now).apply,
      true,
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
  });
});
