import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NavCredentialsService } from "../../integrations/nav/nav-credentials.service.js";
import type {
  NavInvoiceDigestItem,
  NavOnlineInvoiceClient,
} from "../../integrations/nav/nav-online-invoice.client.js";
import { parseArgs } from "./nav-incoming-invoice-backfill.cli.js";
import type { NavIncomingInvoiceRepository } from "./nav-incoming-invoice.repository.js";
import {
  backfillWindows,
  NavIncomingInvoiceService,
} from "./nav-incoming-invoice.service.js";

const DAY = 24 * 60 * 60_000;
const day = (text: string) => new Date(`${text}T00:00:00.000Z`);

function item(invoiceNumber: string): NavInvoiceDigestItem {
  return {
    invoiceNumber,
    invoiceOperation: "CREATE",
    supplierTaxNumber: "12345678",
    supplierName: "Szállító Kft.",
    invoiceIssueDate: "2026-01-10",
    insDate: "2026-01-10T10:00:00Z",
  } as NavInvoiceDigestItem;
}

function setup(
  options: { failApply?: boolean; items?: NavInvoiceDigestItem[] } = {},
) {
  const calls = {
    windows: [] as [string, string][],
    runs: 0,
    applied: [] as { moveCursor: boolean | undefined }[],
    failed: [] as string[],
  };
  const client = {
    queryInvoiceDigest: async (
      _page: number,
      _direction: string,
      start: Date,
      end: Date,
    ) => {
      calls.windows.push([
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
      ]);
      return {
        items: options.items ?? [
          item(`A-${calls.windows.length}`),
          item("KNOWN"),
        ],
        availablePage: 1,
      };
    },
  } as unknown as NavOnlineInvoiceClient;
  const credentials = {
    resolve: async () => ({ technicalUser: {}, software: {} }),
  } as unknown as NavCredentialsService;
  const repository = {
    countKnown: async () => 1,
    createRun: async () => {
      calls.runs++;
      return `run-${calls.runs}`;
    },
    applyDigest: async (
      runId: string,
      items: NavInvoiceDigestItem[],
      windowStart: Date,
      windowEnd: Date,
      applyOptions: { moveCursor?: boolean } = {},
    ) => {
      if (options.failApply) throw new Error("adatbázis nem elérhető");
      calls.applied.push({ moveCursor: applyOptions.moveCursor });
      return {
        runId,
        status: "APPLIED",
        invoicesSeen: items.length,
        createdCount: 1,
        skippedCount: 1,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
      };
    },
    markFailed: async (runId: string) => void calls.failed.push(runId),
  } as unknown as NavIncomingInvoiceRepository;
  return {
    service: new NavIncomingInvoiceService(client, credentials, repository),
    calls,
  };
}

describe("backfillWindows", () => {
  it("cuts the span into consecutive windows of at most 30 days, the last one shorter", () => {
    const windows = backfillWindows(day("2026-01-01"), day("2026-03-15"));
    assert.deepEqual(
      windows.map((w) => [
        w.start.toISOString().slice(0, 10),
        w.end.toISOString().slice(0, 10),
      ]),
      [
        ["2026-01-01", "2026-01-31"],
        ["2026-01-31", "2026-03-02"],
        ["2026-03-02", "2026-03-15"],
      ],
    );
    for (const w of windows)
      assert.ok(w.end.getTime() - w.start.getTime() <= 30 * DAY);
  });

  it("gives nothing when the start is not before the end", () => {
    assert.deepEqual(backfillWindows(day("2026-03-01"), day("2026-03-01")), []);
  });
});

describe("NavIncomingInvoiceService.backfill", () => {
  it("dry: a modification or storno document (credit note) counts as to be created; one without a tax number does not", async () => {
    const { service } = setup({
      items: [
        item("KNOWN"),
        { ...item("4934/26"), invoiceOperation: "MODIFY" },
        { ...item("FELOK00481/2026"), invoiceOperation: "STORNO" },
        { ...item("ADOSZAM-NELKUL"), supplierTaxNumber: undefined },
      ],
    });
    const [window] = await service.backfill({
      from: day("2026-01-01"),
      to: day("2026-01-20"),
      dryRun: true,
    });
    // a fake szerint egy ismert van: 3 tárolható, 1 ismert -> 2 jönne létre
    assert.deepEqual(
      [window!.invoicesSeen, window!.createdCount, window!.skippedCount],
      [4, 2, 2],
    );
  });

  it("dry: queries every window, counts what would be created, and writes nothing", async () => {
    const { service, calls } = setup();
    const results = await service.backfill({
      from: day("2026-01-01"),
      to: day("2026-02-15"),
      dryRun: true,
    });
    assert.deepEqual(calls.windows, [
      ["2026-01-01", "2026-01-31"],
      ["2026-01-31", "2026-02-15"],
    ]);
    assert.deepEqual([calls.runs, calls.applied.length], [0, 0]);
    assert.deepEqual(
      results.map((r) => [
        r.invoicesSeen,
        r.createdCount,
        r.skippedCount,
        r.dryRun,
      ]),
      [
        [2, 1, 1, true],
        [2, 1, 1, true],
      ],
    );
  });

  it("apply: writes each window through a run, and never moves the daily sync's cursor", async () => {
    const { service, calls } = setup();
    await service.backfill({
      from: day("2026-01-01"),
      to: day("2026-02-15"),
      dryRun: false,
    });
    assert.equal(calls.runs, 2);
    assert.deepEqual(calls.applied, [
      { moveCursor: false },
      { moveCursor: false },
    ]);
  });

  it("apply: marks the run failed and stops when a window cannot be written", async () => {
    const { service, calls } = setup({ failApply: true });
    await assert.rejects(
      service.backfill({
        from: day("2026-01-01"),
        to: day("2026-02-15"),
        dryRun: false,
      }),
    );
    assert.deepEqual(calls.failed, ["run-1"]);
    assert.equal(calls.windows.length, 1);
  });
});

describe("parseArgs", () => {
  it("is dry unless --apply is given, and needs a --from day", () => {
    assert.deepEqual(parseArgs(["--from=2026-01-01"]), {
      from: day("2026-01-01"),
      to: undefined,
      apply: false,
    });
    assert.equal(parseArgs(["--from=2026-01-01", "--apply"]).apply, true);
    assert.throws(() => parseArgs([]));
    assert.throws(() => parseArgs(["--from=2026.01.01"]));
  });
});
