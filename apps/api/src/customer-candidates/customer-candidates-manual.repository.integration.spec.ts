import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  analyzeManualList,
  applyManualList,
} from "./customer-candidates-manual.import.js";
import { PrismaManualListStore } from "./customer-candidates-manual.repository.js";
import type { ManualRowToStore } from "./customer-candidates-manual.repository.js";

/**
 * A KÉZI TERMÉKLISTA A VALÓDI ADATBÁZISON (V3.4 S2c). MI PIROSÍT: a csere nem egy tranzakció (egy hibás sor után a lista fele cserélve marad);
 * a listán nem szereplő sor marad; a cikkszám nem a termékhez oldódik fel; az adatbázis CHECK-jei nem tartanak (nem https hivatkozás,
 * nem jóváhagyott paraméter, üres jóváhagyó); ugyanaz a termék és mozgás kétszer fér be; a termék törlése nem viszi a sorait.
 * Kitalált adatok, a takarítás cikkszám-előtag szerint.
 */
const gate = integrationDatabaseGate(process.env);

describe("a kézi termékjelölt-lista", { skip: gate.mode === "skip" }, () => {
  const suffix = randomUUID().slice(0, 8);
  const PREFIX = `MANUAL-INT-${suffix}`;
  const store = new PrismaManualListStore();
  const ids: Record<string, string> = {};
  const sku = (name: string) => `${PREFIX}-${name}`;
  const row = (
    name: string,
    over: Partial<ManualRowToStore> = {},
  ): ManualRowToStore => ({
    productId: ids[name]!,
    sku: sku(name),
    parameter: "KH",
    direction: "EMEL",
    referenceUrl: "https://shop.example.invalid/x",
    basis: "SHOP_TEXT",
    sideEffects: [],
    sideEffectsStatus: "FILLED",
    note: null,
    ...over,
  });
  const mine = () =>
    prisma.customerCandidateManualEntry.findMany({
      where: { sku: { startsWith: PREFIX } },
      orderBy: [{ sku: "asc" }, { parameterCode: "asc" }],
    });
  const approvedAt = new Date("2026-11-11T13:00:00.000Z");

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    for (const [name, active] of [
      ["a", true],
      ["b", true],
      ["off", false],
    ] as const) {
      const product = await prisma.product.create({
        data: {
          name: `${PREFIX} ${name}`,
          isActive: active,
          variants: { create: [{ sku: sku(name) }] },
        },
        select: { id: true },
      });
      ids[name] = product.id;
    }
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await prisma.customerCandidateManualEntry.deleteMany({
      where: { sku: { startsWith: PREFIX } },
    });
    await prisma.productVariant.deleteMany({
      where: { sku: { startsWith: PREFIX } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: Object.values(ids) } },
    });
  });

  it("resolves a SKU to its product, reports the active flag, and leaves an unknown SKU out", async () => {
    const found = await store.resolve([sku("a"), sku("off"), sku("nincs")]);
    assert.deepEqual(found.get(sku("a")), [
      { productId: ids.a, productName: `${PREFIX} a`, active: true },
    ]);
    assert.equal(found.get(sku("off"))![0]!.active, false);
    assert.equal(found.has(sku("nincs")), false);
  });

  it("stores the list with the approver and the time, and reads it back in the shape the plan compares", async () => {
    const result = await store.replace(
      [
        row("a", { sideEffects: ["FOSZFAT:CSOKKENT"], note: "jegyzet" }),
        row("b", {
          parameter: "NITRAT",
          direction: "CSOKKENT",
          basis: "MAKER",
        }),
      ],
      "Balázs 2026-11-11",
      approvedAt,
    );
    assert.deepEqual(result, { stored: 2, removed: 0 });
    const stored = await mine();
    assert.equal(stored.length, 2);
    assert.ok(
      stored.every((entry) => entry.approvedBy === "Balázs 2026-11-11"),
    );
    assert.equal(stored[0]!.approvedAt.getTime(), approvedAt.getTime());
    const current = (await store.current()).filter((entry) =>
      [ids.a, ids.b].includes(entry.productId),
    );
    assert.deepEqual(
      current.find((entry) => entry.productId === ids.a),
      {
        productId: ids.a,
        sku: sku("a"),
        parameter: "KH",
        direction: "EMEL",
        referenceUrl: "https://shop.example.invalid/x",
        basis: "SHOP_TEXT",
        sideEffects: ["FOSZFAT:CSOKKENT"],
        sideEffectsStatus: "FILLED",
        note: "jegyzet",
      },
    );
  });

  it("a second run is the whole list again: a changed row is updated in place (same id), a row that is not in the file is removed", async () => {
    const before = await mine();
    const idOfA = before.find((entry) => entry.productId === ids.a)!.id;
    const result = await store.replace(
      [row("a", { basis: "MAKER", sideEffectsStatus: "PENDING" })],
      "Balázs",
      approvedAt,
    );
    assert.deepEqual(result, { stored: 1, removed: 1 });
    const after = await mine();
    assert.equal(after.length, 1);
    assert.equal(after[0]!.id, idOfA);
    assert.equal(after[0]!.basis, "MAKER");
    assert.equal(after[0]!.sideEffectsStatus, "PENDING");
    assert.deepEqual(after[0]!.sideEffects, []);
  });

  it("an unchanged row keeps its ORIGINAL approver and time; a changed row gets the new run's", async () => {
    const first = new Date("2026-11-10T09:00:00.000Z");
    await store.replace(
      [row("a"), row("b", { parameter: "KALCIUM" })],
      "Első jóváhagyó",
      first,
    );
    await store.replace(
      [row("a"), row("b", { parameter: "KALCIUM", note: "módosult" })],
      "Második jóváhagyó",
      approvedAt,
    );
    const stored = await mine();
    const a = stored.find((entry) => entry.productId === ids.a)!;
    const b = stored.find((entry) => entry.productId === ids.b)!;
    assert.equal(a.approvedBy, "Első jóváhagyó");
    assert.equal(a.approvedAt.getTime(), first.getTime());
    assert.equal(b.approvedBy, "Második jóváhagyó");
    assert.equal(b.approvedAt.getTime(), approvedAt.getTime());
  });

  it("the audit row is written in the SAME transaction as the replacement: with the write, and not at all when the write fails", async () => {
    const marker = `audit-${suffix}`;
    const auditRows = () =>
      prisma.auditLog.findMany({
        where: {
          action: "customer-candidates.manual-list.applied",
          metadata: { path: ["approvedBy"], equals: marker },
        },
      });
    try {
      await store.replace([row("a")], marker, approvedAt, {
        userId: null,
        metadata: { source: "cli", approvedBy: marker },
      });
      const written = await auditRows();
      assert.equal(written.length, 1);
      assert.equal(written[0]!.entityType, "CustomerCandidateManualEntry");
      assert.equal((written[0]!.metadata as Record<string, unknown>).stored, 1);
      // a write that fails leaves no audit row behind
      await assert.rejects(
        store.replace(
          [row("a", { referenceUrl: "http://nem-https.example.invalid" })],
          marker,
          approvedAt,
          { userId: null, metadata: { source: "cli", approvedBy: marker } },
        ),
      );
      assert.equal((await auditRows()).length, 1);
    } finally {
      await prisma.auditLog.deleteMany({
        where: {
          action: "customer-candidates.manual-list.applied",
          metadata: { path: ["approvedBy"], equals: marker },
        },
      });
    }
  });

  it("an audit row that cannot be written takes the replacement with it: no write without its audit row", async () => {
    await store.replace([row("a")], "Balázs", approvedAt);
    const snapshot = JSON.stringify(await mine());
    await assert.rejects(
      store.replace(
        [row("a", { note: "audit nélkül nem íródhat" })],
        "Balázs",
        approvedAt,
        {
          // a user id that does not exist: the audit row's foreign key refuses it
          userId: `nincs-ilyen-${suffix}`,
          metadata: { source: "http", approvedBy: "Balázs" },
        },
      ),
    );
    assert.equal(JSON.stringify(await mine()), snapshot);
  });

  it("the replacement is ONE transaction: a bad row in the middle leaves the stored list exactly as it was", async () => {
    await store.replace([row("a"), row("b")], "Balázs", approvedAt);
    const snapshot = JSON.stringify(await mine());
    await assert.rejects(
      store.replace(
        [
          row("a", { referenceUrl: "https://shop.example.invalid/changed" }),
          row("b", { referenceUrl: "http://nem-https.example.invalid" }),
        ],
        "Balázs",
        approvedAt,
      ),
    );
    assert.equal(JSON.stringify(await mine()), snapshot);
  });

  it("the database refuses what the file parser refuses: a non-https reference, an unapproved parameter, an empty approver", async () => {
    const bad = [
      { referenceUrl: "http://x.example.invalid" },
      { referenceUrl: "https://a b" },
      { parameter: "FOSZFAT" },
      { parameter: "PH" },
    ];
    for (const over of bad) {
      let refused = false;
      try {
        await store.replace([row("a", over)], "Balázs", approvedAt);
      } catch {
        refused = true;
      }
      assert.ok(refused, JSON.stringify(over));
    }
    // a row that CHANGES, so it is written (an unchanged row is not written and carries no new approver)
    await assert.rejects(
      store.replace([row("a", { note: "új jegyzet" })], "   ", approvedAt),
    );
  });

  it("one move of one product is one row: the same product and move twice in one run is one stored row", async () => {
    const result = await store.replace(
      [row("a"), row("a", { note: "újra" })],
      "Balázs",
      approvedAt,
    );
    assert.equal(result.stored, 2);
    const stored = (await mine()).filter((entry) => entry.productId === ids.a);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.note, "újra");
  });

  it("deleting a product takes its rows with it", async () => {
    await store.replace([row("b")], "Balázs", approvedAt);
    assert.equal((await mine()).length, 1);
    await prisma.productVariant.deleteMany({ where: { productId: ids.b } });
    await prisma.product.delete({ where: { id: ids.b } });
    assert.equal((await mine()).length, 0);
    ids.b = (
      await prisma.product.create({
        data: {
          name: `${PREFIX} b2`,
          variants: { create: [{ sku: sku("b") }] },
        },
        select: { id: true },
      })
    ).id;
  });

  /*
    TWO APPLIES FROM THE SAME DRY RUN (murena's open point on #2428). The probe holds the first apply inside its transaction, after the
    lock and the check, and the second apply starts there. WHAT TURNS THIS RED: both passing (each checked the fingerprint before the
    other wrote, and the later commit silently replaced the earlier list), which is what the old shape did.
  */
  it("two applies from the same dry run: the second waits for the first, reads what it stored, and is refused", async () => {
    const marker = `verseny-${suffix}`;
    const fileLine = (name: string) => ({
      sku: sku(name),
      parameter: "KH",
      direction: "EMEL",
      referenceUrl: `https://shop.example.invalid/${name}`,
      basis: "SHOP_TEXT",
      sideEffects: [],
      sideEffectsStatus: "FILLED",
    });
    const input = (fingerprint: string) => ({
      approvedBy: marker,
      fingerprint,
      allowEmpty: false,
      auditUserId: null,
      source: "http" as const,
    });
    try {
      await store.replace([row("a")], "kiindulas", approvedAt);
      // both dry runs against the same table
      const first = await analyzeManualList([fileLine("a")], store);
      const second = await analyzeManualList([fileLine("b")], store);
      // a box, not a `let`: a closure assignment narrows a `let` to never (TS2339 in CI, #2445)
      const box: { secondApply?: ReturnType<typeof applyManualList> } = {};
      store.afterCheckProbe = async () => {
        store.afterCheckProbe = async () => {};
        box.secondApply = applyManualList(
          second,
          input(second.fingerprint),
          store,
          approvedAt,
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
      };
      const firstResult = await applyManualList(
        first,
        input(first.fingerprint),
        store,
        approvedAt,
      );
      assert.ok(box.secondApply, "the probe ran");
      const secondResult = await box.secondApply!;
      assert.equal(firstResult.ok, true);
      assert.deepEqual(secondResult, {
        ok: false,
        refusal: "FINGERPRINT_MISMATCH",
      });
      assert.deepEqual(
        (await mine()).map((entry) => entry.referenceUrl),
        ["https://shop.example.invalid/a"],
      );
    } finally {
      store.afterCheckProbe = async () => {};
      await prisma.auditLog.deleteMany({
        where: {
          action: "customer-candidates.manual-list.applied",
          metadata: { path: ["approvedBy"], equals: marker },
        },
      });
    }
  });
});
