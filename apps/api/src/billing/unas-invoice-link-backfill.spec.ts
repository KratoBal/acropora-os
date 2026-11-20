import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import type { UnasApiOrder } from "@acropora/types";

import {
  MAX_PAGES,
  PAGE_GAP_MS,
  PAGE_SIZE,
  main,
} from "./unas-invoice-link-backfill.cli.js";
import {
  UNAS_INVOICE_LINK_USAGE,
  type InvoiceLinkStore,
} from "./unas-invoice-link-backfill.js";

/*
  THE WEBSHOP INVOICE LINK BACKFILL (785dfea6, acrobot 58605, 58609), without UNAS or a database. WHAT TURNS IT RED: a write in a
  dry run; a link written over an existing one; a row created for a number that already has one; an order without an invoice
  number or link written; a number outside the prefix touched; the link printed (it may carry a token); a page boundary missed
  (a full page not followed by the next, or the window not passed on); no pause between UNAS requests; a bad call reaching UNAS.
*/

const order = (key: string, over: Partial<UnasApiOrder> = {}): UnasApiOrder =>
  ({
    key,
    id: `id-${key}`,
    buyerInvoiceName: `Vevő ${key}`,
    buyerTaxNumber: null,
    customerName: null,
    currency: "HUF",
    invoiceNumber: `ACRW-2026/${key}`,
    invoiceUrl: `https://www.cmfx.hu/szamla?token=SECRET-${key}`,
    ...over,
  }) as UnasApiOrder;

function fakeStore(
  rows: Record<string, { hasUrl: boolean }>,
  localOrders: Record<string, string> = {},
  raced = new Set<string>(),
) {
  const writes: unknown[] = [];
  const store: InvoiceLinkStore = {
    existing: async (number) => rows[number] ?? null,
    localOrderId: async (o) => localOrders[o.id ?? o.key] ?? null,
    setUrlIfEmpty: async (number, url) => {
      writes.push(["url", number, url]);
      return !raced.has(number);
    },
    create: async (input) => {
      writes.push(["create", input]);
      return !raced.has(input.number);
    },
  };
  return { store, writes };
}

async function run(
  argv: string[],
  pages: UnasApiOrder[][],
  store: InvoiceLinkStore,
) {
  let out = "";
  let err = "";
  const requests: unknown[] = [];
  const sleeps: number[] = [];
  const code = await main(
    argv,
    { out: (t) => (out += t), err: (t) => (err += t) },
    {
      page: async (request) => {
        requests.push(request);
        return pages[requests.length - 1] ?? [];
      },
      store,
      sleep: async (ms) => void sleeps.push(ms),
    },
  );
  return { code, out, err, requests, sleeps };
}

const ORDERS = [
  order("00001"), // no row: with a local order
  order("00002"), // no row: no local order
  order("00003"), // row with a link: nothing
  order("00004"), // row without a link
  order("00005", { invoiceNumber: null }), // not invoiced
  order("00006", { invoiceUrl: "  " }), // no link
  order("00007", { invoiceNumber: "2026/00007" }), // another series
];
const ROWS = {
  "ACRW-2026/00003": { hasUrl: true },
  "ACRW-2026/00004": { hasUrl: false },
};

describe("unas-invoice-link-backfill", () => {
  it("dry: names each would-be write, writes nothing, prints no link, and exits 1", async () => {
    const { store, writes } = fakeStore(ROWS, { "id-00001": "so-1" });
    const { code, out } = await run(
      ["--tol", "2026-01-01", "--elotag", "ACRW-2026/"],
      [ORDERS],
      store,
    );
    assert.equal(code, 1);
    assert.deepEqual(writes, []);
    assert.deepEqual(
      out.split("\n").filter((line) => /^[A-Z_]+ +\S/.test(line)),
      [
        "SOR_LENNE       ACRW-2026/00001 rendeles",
        "SOR_LENNE       ACRW-2026/00002 rendeles nelkul",
        "LINK_POTOLNA    ACRW-2026/00004",
      ],
    );
    assert.doesNotMatch(out, /SECRET|cmfx\.hu/);
    assert.match(
      out,
      /Osszesen: 7 rendeles; szamla nelkul 2, mar megvolt 1, link potolna 1, uj sor lenne 2/,
    );
  });

  it("applied: writes the link only where empty and the new rows, with or without the local order", async () => {
    const { store, writes } = fakeStore(ROWS, { "id-00001": "so-1" });
    const { code } = await run(
      ["--tol", "2026-01-01", "--elotag", "ACRW-2026/", "--apply"],
      [ORDERS],
      store,
    );
    assert.equal(code, 0);
    assert.deepEqual(writes, [
      [
        "create",
        {
          number: "ACRW-2026/00001",
          url: "https://www.cmfx.hu/szamla?token=SECRET-00001",
          salesOrderId: "so-1",
          partnerName: "Vevő 00001",
          partnerTaxNumber: null,
          currency: "HUF",
        },
      ],
      [
        "create",
        {
          number: "ACRW-2026/00002",
          url: "https://www.cmfx.hu/szamla?token=SECRET-00002",
          salesOrderId: null,
          partnerName: "Vevő 00002",
          partnerTaxNumber: null,
          currency: "HUF",
        },
      ],
      [
        "url",
        "ACRW-2026/00004",
        "https://www.cmfx.hu/szamla?token=SECRET-00004",
      ],
    ]);
  });

  it("without a prefix every invoiced order is taken; a write that lost a race is named, not counted as written", async () => {
    const { store } = fakeStore({}, {}, new Set(["2026/00007"]));
    const { out } = await run(
      ["--tol", "2026-01-01", "--apply"],
      [[order("00001"), order("00007", { invoiceNumber: "2026/00007" })]],
      store,
    );
    assert.match(out, /^SOR_IRVA +ACRW-2026\/00001 rendeles nelkul$/m);
    assert.match(out, /^KOZBEN_MEGVOLT +2026\/00007 rendeles nelkul$/m);
    assert.match(out, /uj sor 1, kozben megvolt 1/);
  });

  it("pages through the window: a full page asks for the next, with a pause, and a short page ends it", async () => {
    const { store } = fakeStore({});
    const full = Array.from({ length: PAGE_SIZE }, (_, i) =>
      order(String(i).padStart(5, "0"), { invoiceNumber: null }),
    );
    const { requests, sleeps } = await run(
      ["--tol", "2026-01-01", "--ig", "2026-07-01"],
      [full, full, [order("99999", { invoiceNumber: null })]],
      store,
    );
    const from = Date.parse("2026-01-01T00:00:00Z") / 1000;
    const until = Date.parse("2026-07-01T00:00:00Z") / 1000;
    assert.deepEqual(requests, [
      { timeModStart: from, timeModEnd: until, limitStart: 0, limitNum: 500 },
      { timeModStart: from, timeModEnd: until, limitStart: 500, limitNum: 500 },
      {
        timeModStart: from,
        timeModEnd: until,
        limitStart: 1000,
        limitNum: 500,
      },
    ]);
    assert.deepEqual(sleeps, [PAGE_GAP_MS, PAGE_GAP_MS]);
  });

  it("stops with an error instead of reading on without end", async () => {
    const { store } = fakeStore({});
    const full = Array.from({ length: PAGE_SIZE }, (_, i) =>
      order(String(i), { invoiceNumber: null }),
    );
    const { code, err, requests } = await run(
      ["--tol", "2026-01-01"],
      Array.from({ length: MAX_PAGES + 5 }, () => full),
      store,
    );
    assert.equal(code, 2);
    assert.equal(requests.length, MAX_PAGES);
    assert.match(err, /Tobb mint 200 lap/);
  });

  it("a bad call never reaches UNAS", async () => {
    for (const argv of [
      [],
      ["--tol", "2026-13-01"],
      ["--tol", "2026-02-31"],
      ["--tol", "2026-07-01", "--ig", "2026-01-01"],
      ["--tol", "2026-01-01", "--ig"],
      ["--tol", "2026-01-01", "--mind"],
    ]) {
      const { store } = fakeStore({});
      const { code, requests } = await run(argv, [], store);
      assert.deepEqual([code, requests.length], [2, 0], argv.join(" "));
    }
  });

  // the command itself, from the compiled test output (the way the other CLI start specs do, card afb4d0f2)
  it("starts in a separate process: --help prints the usage", () => {
    const output = execFileSync(
      "node",
      ["test-dist/billing/unas-invoice-link-backfill.cli.js", "--help"],
      { encoding: "utf8" },
    );
    assert.equal(output, UNAS_INVOICE_LINK_USAGE);
  });
});
