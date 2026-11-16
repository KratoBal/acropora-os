import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";

import { ProductRedirectBackfillService } from "./product-redirect-backfill.service.js";

/*
  A TERMÉK-ÁTIRÁNYÍTÁS VÉGPONTJA (kártya f6cb0a51: a 7 hiányzó termék; a flotta a parancs kimenetét nem olvashatja, a jelentés JSON-ban kell).
  MI PIROSIT: ha a szárazfutás ír; ha az apply lenyomat nélkül vagy más lenyomattal (közben változott az adat) mégis ír; ha az elutasítást
  tartalmazó terv íródik; ha az írás nem hagy AuditLogot, vagy nem a lock és a tranzakció alatt megy; ha az `inspect` nem mondja meg, miért
  nincs szabály egy címen (nincs termék, nincs webshop-slug, már áll rajta szabály); ha az `inspect` beleszól a lenyomatba (az írásnak nem
  kell megismételnie).
*/
interface FakeProduct {
  id: string;
  unasUrl: string | null;
  slug: string | null;
}

function fake(
  products: FakeProduct[],
  existing: {
    id: string;
    sourcePath: string;
    destinationPath: string;
    isActive: boolean;
    reason: string;
    createdAt: Date;
  }[] = [],
) {
  const writes: string[] = [];
  const created: unknown[] = [];
  const audit: unknown[] = [];
  const base = {
    product: {
      findMany: async () =>
        products.map((p) => ({
          id: p.id,
          channelListings: [
            ...(p.unasUrl
              ? [{ channel: "UNAS", productUrl: p.unasUrl, slug: null }]
              : []),
            ...(p.slug
              ? [{ channel: "WEBSHOP", productUrl: null, slug: p.slug }]
              : []),
          ],
        })),
    },
    urlRedirect: {
      findMany: async () => existing,
      createMany: async (a: { data: unknown[] }) => {
        writes.push("createMany");
        created.push(...a.data);
      },
      update: async () => {
        writes.push("update");
      },
    },
    auditLog: {
      create: async (a: { data: unknown }) => {
        writes.push("auditLog");
        audit.push(a.data);
        return { id: "audit-1" };
      },
    },
    $executeRaw: async () => {
      writes.push("lock");
      return 0;
    },
  };
  const db = {
    ...base,
    $transaction: async (fn: (t: typeof base) => Promise<unknown>) => fn(base),
  };
  return { db, writes, created, audit };
}

const service = (f: ReturnType<typeof fake>) =>
  new ProductRedirectBackfillService(f.db as never);
const PRODUCTS: FakeProduct[] = [
  { id: "p1", unasUrl: "/Regi-Termek-1", slug: "uj-termek-1" },
  { id: "p2", unasUrl: "/Regi-Termek-2", slug: null },
  { id: "p3", unasUrl: null, slug: "csak-uj" },
];

describe("ProductRedirectBackfillService", () => {
  it("szárazfutás: jelentés és lenyomat, semmi nem íródik", async () => {
    const f = fake(PRODUCTS);
    const r = await service(f).run({}, "u1");
    assert.equal(r.applied, false);
    assert.equal(r.report.created, 1);
    assert.equal(r.report.withoutOldUrl, 1);
    assert.deepEqual(r.report.withoutWebshopSlug, ["p2"]);
    assert.match(r.planHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(f.writes, []);
  });

  it("az inspect megmondja, miért van vagy nincs szabály: nincs termék, nincs slug, van szabály, érvénytelen cím; a lenyomatot nem érinti", async () => {
    const f = fake(PRODUCTS, [
      {
        id: "r9",
        sourcePath: "/Mar-Van",
        destinationPath: "/hu/termek/valami",
        isActive: true,
        reason: "MANUAL",
        createdAt: new Date("2026-10-30T09:37:00.000Z"),
      },
    ]);
    const plain = await service(f).run({}, "u1");
    const r = await service(f).run(
      {
        inspect: [
          "/regi-termek-1",
          "/Regi-Termek-2",
          "/nincs-ilyen",
          "/mar-van",
          "rossz cim",
        ],
      },
      "u1",
    );
    assert.equal(r.planHash, plain.planHash);
    const byAsked = new Map(r.inspections.map((i) => [i.asked, i]));
    // van termék webshop-slugjal, a szabály a terv szerint most készül (még nincs a címen)
    assert.deepEqual(byAsked.get("/regi-termek-1")!.products, [
      {
        id: "p1",
        hasWebshopSlug: true,
        plannedDestination: "/hu/termek/uj-termek-1",
      },
    ]);
    assert.equal(byAsked.get("/regi-termek-1")!.rule, null);
    // termék van, webshop-slug nincs: ezért nem készül szabály
    assert.equal(
      byAsked.get("/Regi-Termek-2")!.products[0]!.hasWebshopSlug,
      false,
    );
    // egyetlen termék UNAS-címe sem ez
    assert.deepEqual(byAsked.get("/nincs-ilyen")!.products, []);
    // már áll rajta szabály (eredettel, idővel)
    assert.deepEqual(byAsked.get("/mar-van")!.rule, {
      destination: "/hu/termek/valami",
      reason: "MANUAL",
      isActive: true,
      createdAt: "2026-10-30T09:37:00.000Z",
    });
    // érvénytelen cím: nincs mit keresni
    assert.equal(byAsked.get("rossz cim")!.normalized, null);
  });

  it("apply lenyomat nélkül 400; más lenyomattal 409, és nem ír (csak a zár)", async () => {
    const f = fake(PRODUCTS);
    await assert.rejects(
      service(f).run({ apply: true }, "u1"),
      BadRequestException,
    );
    await assert.rejects(
      service(f).run({ apply: true, planHash: "0".repeat(64) }, "u1"),
      ConflictException,
    );
    assert.deepEqual(f.writes, ["lock"]);
  });

  it("apply a szárazfutás lenyomatával: zár alatt ír, AuditLogot hagy, és a szabály a tervezett cél", async () => {
    const f = fake(PRODUCTS);
    const dry = await service(f).run({}, "u1");
    const r = await service(f).run(
      { apply: true, planHash: dry.planHash },
      "u1",
    );
    assert.equal(r.applied, true);
    assert.deepEqual(f.writes, ["lock", "createMany", "auditLog"]);
    assert.equal(f.created.length, 1);
    assert.equal(
      (f.created[0] as { destinationPath: string }).destinationPath,
      "/hu/termek/uj-termek-1",
    );
    const naplo = f.audit[0] as {
      action: string;
      metadata: { created: number };
    };
    assert.equal(naplo.action, "seo.redirects.product-backfill");
    assert.equal(naplo.metadata.created, 1);
    // a köteg azonosítója és a változás-nyilvántartás: a visszavonás ebből dolgozik
    assert.equal(r.batchId, "audit-1");
    const valtozasok = (
      naplo.metadata as unknown as {
        changes: {
          created: { source: string; destination: string }[];
          updated: unknown[];
        };
      }
    ).changes;
    assert.deepEqual(valtozasok.updated, []);
    assert.equal(valtozasok.created.length, 1);
    assert.equal(valtozasok.created[0]!.destination, "/hu/termek/uj-termek-1");
  });

  it("az elutasítást tartalmazó terv nem íródik (422)", async () => {
    // két termék ugyanarra a régi címre más-más kis/nagybetűvel: kisbetűs ütközés, a terv elutasítja
    const f = fake([
      { id: "p1", unasUrl: "/Ugyanaz", slug: "a-termek" },
      { id: "p2", unasUrl: "/ugyanaz", slug: "b-termek" },
    ]);
    const dry = await service(f).run({}, "u1");
    assert.equal(dry.report.refused.length, 1);
    assert.equal(dry.report.refused[0]!.kind, "case-collision");
    await assert.rejects(
      service(f).run({ apply: true, planHash: dry.planHash }, "u1"),
      UnprocessableEntityException,
    );
    assert.equal(f.writes.includes("createMany"), false);
  });
});
