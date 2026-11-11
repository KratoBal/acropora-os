import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseImportArgs,
  runManualImport,
  type ImportOptions,
} from "./customer-candidates-manual.import.js";
import type { ManualPlanCurrent } from "./customer-candidates-manual.rules.js";
import type {
  ManualListStore,
  ManualRowToStore,
  ResolvedSku,
} from "./customer-candidates-manual.repository.js";

/**
 * A KÉZI LISTA IMPORT-PARANCSA (V3.4 S2c), adatbázis nélkül. MI PIROSÍT: a próba ír; az `--apply` a lenyomat vagy a jóváhagyó neve nélkül, vagy
 * elutasított / fel nem oldott / kétértelmű sor mellett elindul; a jelentés nem teljes (elutasított sor, PENDING, SHOP_TEXT, inaktív termék);
 * a fájl hibája dob a sor hibája helyett; a tárolt sorok nem a fájlból vannak.
 */
const line = (over: Record<string, unknown> = {}) => ({
  sku: "sku-1",
  parameter: "KH",
  direction: "EMEL",
  referenceUrl: "https://shop.example/p1",
  basis: "SHOP_TEXT",
  sideEffects: [],
  sideEffectsStatus: "FILLED",
  ...over,
});

function fixture(
  file: unknown,
  catalogue: Record<string, ResolvedSku[]> = {
    "sku-1": [{ productId: "p1", productName: "Termék 1", active: true }],
  },
) {
  const stored: ManualRowToStore[][] = [];
  const held: ManualPlanCurrent[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const store: ManualListStore = {
    resolve: async (skus) =>
      new Map(
        skus.flatMap((sku) =>
          catalogue[sku] ? [[sku, catalogue[sku]!] as const] : [],
        ),
      ),
    current: async () => [...held],
    replace: async (rows, approvedBy) => {
      stored.push([...rows]);
      assert.ok(approvedBy.length > 0);
      return { stored: rows.length, removed: 0 };
    },
  };
  const run = (options: Partial<ImportOptions> = {}) =>
    runManualImport(
      {
        file: "f.json",
        apply: false,
        approvedBy: null,
        fingerprint: null,
        allowEmpty: false,
        ...options,
      },
      {
        store,
        readFile: async () =>
          typeof file === "string" ? file : JSON.stringify(file),
        now: () => new Date("2026-11-11T13:00:00.000Z"),
        target: "scratch:5432/os_scratch_test",
      },
      { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    );
  const fingerprint = () =>
    out.join("").match(/LENYOMAT: ([0-9a-f]{64})/)?.[1] ?? null;
  return { run, stored, held, out, err, fingerprint };
}

describe("parseImportArgs", () => {
  it("one file, the switches, nothing else", () => {
    assert.deepEqual(parseImportArgs(["f.json"]), {
      file: "f.json",
      apply: false,
      approvedBy: null,
      fingerprint: null,
      allowEmpty: false,
    });
    assert.deepEqual(
      parseImportArgs([
        "f.json",
        "--apply",
        "--approved-by",
        "Balázs",
        "--fingerprint",
        "ab",
      ]),
      {
        file: "f.json",
        apply: true,
        approvedBy: "Balázs",
        fingerprint: "ab",
        allowEmpty: false,
      },
    );
    assert.equal(
      parseImportArgs(["f.json", "--allow-empty"]) &&
        (parseImportArgs(["f.json", "--allow-empty"]) as ImportOptions)
          .allowEmpty,
      true,
    );
    assert.ok("error" in parseImportArgs([]));
    assert.ok("error" in parseImportArgs(["a", "b"]));
    assert.ok("error" in parseImportArgs(["a", "--force"]));
  });
});

describe("the dry run", () => {
  it("writes nothing, names the target first, counts the rows, and prints the fingerprint", async () => {
    const fx = fixture([line()]);
    assert.equal(await fx.run(), 0);
    assert.equal(fx.stored.length, 0);
    const text = fx.out.join("");
    assert.ok(text.startsWith("CÉL-ADATBÁZIS: scratch:5432/os_scratch_test"));
    assert.match(text, /1 érvényes; 0 elutasított; hozzáadott 1/);
    assert.match(text, /SHOP_TEXT alap \(csak a teszten megy ki\): 1/);
    assert.ok(fx.fingerprint());
    assert.match(text, /Próba: semmi nem íródott/);
  });

  it("reports PENDING rows, rejected rows with their reason, an unknown or ambiguous SKU, and an inactive product", async () => {
    const fx = fixture(
      [
        line({ sideEffectsStatus: "PENDING" }),
        line({ sku: "unknown" }),
        line({ sku: "twice" }),
        line({ sku: "off" }),
        line({ sku: "bad", parameter: "FOSZFAT" }),
      ],
      {
        "sku-1": [{ productId: "p1", productName: "Termék 1", active: true }],
        twice: [
          { productId: "p2", productName: "A", active: true },
          { productId: "p3", productName: "B", active: true },
        ],
        off: [{ productId: "p4", productName: "Régi", active: false }],
      },
    );
    assert.equal(await fx.run(), 1);
    const text = fx.out.join("");
    assert.match(text, /PENDING \(a vevő felé nem megy\): 1/);
    assert.match(text, /2 elutasított|3 elutasított/);
    assert.match(text, /nincs ilyen cikkszám a katalógusban/);
    assert.match(text, /a cikkszám több termékhez tartozik/);
    assert.match(text, /5\. sor \(bad\)/);
    assert.match(text, /FIGYELEM: off \(Régi\): a termék inaktív/);
    assert.equal(fx.stored.length, 0);
    assert.match(fx.err.join(""), /Van elutasított sor/);
  });

  it("a file that is not JSON or not an array is a clear error, and nothing is read from the database for it", async () => {
    for (const file of ["{not json", {}]) {
      const fx = fixture(file);
      assert.equal(await fx.run(), 1);
      assert.equal(fx.stored.length, 0);
      assert.ok(fx.err.join("").length > 0);
    }
  });
});

describe("--apply", () => {
  it("writes the file's rows, once, with the approver, when the fingerprint is the one the dry run showed", async () => {
    const fx = fixture([
      line(),
      line({ parameter: "KALCIUM", sideEffects: ["SZILIKAT:CSOKKENT"] }),
    ]);
    await fx.run();
    const fingerprint = fx.fingerprint()!;
    const code = await fx.run({
      apply: true,
      approvedBy: "Balázs 2026-11-11, Eldöntendő szál",
      fingerprint,
    });
    assert.equal(code, 0);
    assert.equal(fx.stored.length, 1);
    assert.deepEqual(
      fx.stored[0]!.map((row) => [
        row.productId,
        row.parameter,
        row.sideEffects,
      ]),
      [
        ["p1", "KH", []],
        ["p1", "KALCIUM", ["SZILIKAT:CSOKKENT"]],
      ],
    );
    assert.match(fx.out.join(""), /Kész: 2 sor tárolva/);
  });

  it("refuses without the approver's name, without the fingerprint, and with a wrong one; nothing is written", async () => {
    const fx = fixture([line()]);
    await fx.run();
    const fingerprint = fx.fingerprint()!;
    assert.equal(
      await fx.run({ apply: true, approvedBy: null, fingerprint }),
      2,
    );
    assert.equal(
      await fx.run({ apply: true, approvedBy: "  ", fingerprint }),
      2,
    );
    assert.equal(
      await fx.run({ apply: true, approvedBy: "Balázs", fingerprint: null }),
      1,
    );
    assert.equal(
      await fx.run({
        apply: true,
        approvedBy: "Balázs",
        fingerprint: "0".repeat(64),
      }),
      1,
    );
    assert.equal(fx.stored.length, 0);
  });

  it("the fingerprint follows the content: another reference or another status is another fingerprint, and the order of the file does not matter", async () => {
    const rows = [line(), line({ parameter: "NITRAT", direction: "CSOKKENT" })];
    const a = fixture(rows);
    await a.run();
    const reversed = fixture([...rows].reverse());
    await reversed.run();
    assert.equal(a.fingerprint(), reversed.fingerprint());
    for (const change of [
      { referenceUrl: "https://shop.example/other" },
      { sideEffectsStatus: "PENDING" },
      { basis: "MAKER" },
    ]) {
      const other = fixture([line(change), rows[1]]);
      await other.run();
      assert.notEqual(
        other.fingerprint(),
        a.fingerprint(),
        JSON.stringify(change),
      );
    }
  });

  it("does not start on a file with a rejected row, even with a matching fingerprint and an approver", async () => {
    const fx = fixture([line(), line({ sku: "bad", direction: "UP" })]);
    await fx.run();
    const code = await fx.run({
      apply: true,
      approvedBy: "Balázs",
      fingerprint: fx.fingerprint(),
    });
    assert.equal(code, 1);
    assert.equal(fx.stored.length, 0);
  });
});

describe("the table's current state is part of what was approved (barracuda, OS #2420)", () => {
  const stored = (
    over: Partial<ManualPlanCurrent> = {},
  ): ManualPlanCurrent => ({
    productId: "p9",
    parameter: "KH",
    direction: "EMEL",
    referenceUrl: "https://shop.example/held",
    basis: "SHOP_TEXT",
    sideEffects: [],
    sideEffectsStatus: "FILLED",
    note: null,
    ...over,
  });

  it("another import between the dry run and the --apply changes the fingerprint, so the apply refuses and nothing is written", async () => {
    const fx = fixture([line()]);
    await fx.run();
    const shown = fx.fingerprint()!;
    fx.held.push(stored());
    assert.equal(
      await fx.run({ apply: true, approvedBy: "Balázs", fingerprint: shown }),
      1,
    );
    assert.equal(fx.stored.length, 0);
    // the dry run on the new state shows the new fingerprint, and that one goes through
    fx.out.length = 0;
    await fx.run();
    const now = fx.fingerprint()!;
    assert.notEqual(now, shown);
    assert.equal(
      await fx.run({ apply: true, approvedBy: "Balázs", fingerprint: now }),
      0,
    );
  });

  it("a changed held row (same key, another content) changes the fingerprint too", async () => {
    const a = fixture([line()]);
    a.held.push(stored());
    await a.run();
    const b = fixture([line()]);
    b.held.push(stored({ note: "más" }));
    await b.run();
    assert.notEqual(a.fingerprint(), b.fingerprint());
  });
});

describe("an empty file is the whole list deleted, and it needs --allow-empty", () => {
  it("the dry run shows the deletions, the apply without the switch refuses, with it the list is emptied", async () => {
    const fx = fixture([]);
    fx.held.push({
      productId: "p9",
      parameter: "KH",
      direction: "EMEL",
      referenceUrl: "https://shop.example/held",
      basis: "SHOP_TEXT",
      sideEffects: [],
      sideEffectsStatus: "FILLED",
      note: null,
    });
    assert.equal(await fx.run(), 0);
    assert.match(fx.out.join(""), /törölt 1/);
    const fingerprint = fx.fingerprint()!;
    assert.equal(
      await fx.run({ apply: true, approvedBy: "Balázs", fingerprint }),
      2,
    );
    assert.equal(fx.stored.length, 0);
    assert.match(fx.err.join(""), /--allow-empty/);
    assert.equal(
      await fx.run({
        apply: true,
        approvedBy: "Balázs",
        fingerprint,
        allowEmpty: true,
      }),
      0,
    );
    assert.deepEqual(fx.stored, [[]]);
  });
});
