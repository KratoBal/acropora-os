import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  MedusaAdminClient,
  MedusaCollectionInput,
  MedusaCollectionRow,
} from "./medusa-admin.client.js";
import type { MedusaBrandLinkRepository } from "./medusa-brand-link.repository.js";
import type { OurBrand } from "./medusa-brand-plan.js";
import {
  MedusaBrandImportService,
  MedusaBrandImportRefusedError,
} from "./medusa-brand-import.service.js";

const now = new Date("2026-09-04T03:00:00.000Z");

const brand = (overrides: Partial<OurBrand> = {}): OurBrand => ({
  id: "brand-1",
  name: "Tunze",
  slug: "tunze",
  isActive: true,
  archivedAt: null,
  ...overrides,
});

/**
 * A DUPLAK A HIVO SZEMSZOGEBOL KESZULNEK, nem a tesztéből: a szolgaltatas a
 * letrehozas VISSZATERESI ERTEKEBOL veszi a gyujtemeny azonositojat, tehat egy
 * ures objektum "mukodne" a tesztben es elhasalna a hivonal. Ezert ad a
 * `createProductCollection` valodi sort, es ezert a varrat (`links`) a valodi
 * szerzodes tipusat viseli.
 */
function fakes(input: {
  existing?: MedusaCollectionRow[];
  afterwards?: MedusaCollectionRow[];
  mappings?: { brandId: string; medusaCollectionId: string }[];
  truncated?: boolean;
}) {
  const created: MedusaCollectionInput[] = [];
  const linked: { brandId: string; medusaId: string }[] = [];
  const relinked: { brandId: string; medusaId: string }[] = [];
  let listCalls = 0;

  const client = {
    listProductCollections: async () => {
      listCalls += 1;
      const rows =
        listCalls === 1
          ? (input.existing ?? [])
          : (input.afterwards ?? input.existing ?? []);
      return { rows, truncated: input.truncated ?? false };
    },
    createProductCollection: async (payload: MedusaCollectionInput) => {
      created.push(payload);
      return {
        id: `pcol_${created.length}`,
        title: payload.title,
        handle: payload.handle,
        external_id: payload.external_id,
      };
    },
  } as unknown as MedusaAdminClient;

  const links = {
    all: async () =>
      (input.mappings ?? []).map((m) => ({ ...m, lastSyncedAt: null })),
    link: async (brandId: string, medusaId: string) => {
      linked.push({ brandId, medusaId });
      return { brandId, medusaCollectionId: medusaId, lastSyncedAt: now };
    },
    relink: async (brandId: string, medusaId: string) => {
      relinked.push({ brandId, medusaId });
      return { brandId, medusaCollectionId: medusaId, lastSyncedAt: now };
    },
  } as unknown as MedusaBrandLinkRepository;

  return {
    service: new MedusaBrandImportService(links),
    client,
    created,
    linked,
    relinked,
    listCalls: () => listCalls,
  };
}

describe("MedusaBrandImportService", () => {
  it("letrehozza a hianyzo gyujtemenyt, a mi handle es kulso azonosito ertekeinkkel", async () => {
    const f = fakes({});

    const report = await f.service.run(f.client, [brand()], now);

    assert.deepEqual(f.created, [
      { title: "Tunze", handle: "tunze", external_id: "brand-1" },
    ]);
    assert.equal(report.created, 1);
  });

  /**
   * EZ AZ AZ ESET, AMI NELKUL DUPLIKATUMOT SZULNENK: a gyujtemeny mar all a
   * Medusan a MI azonositonkkal, csak a lekepezes-sorunk veszett el.
   */
  it("csak osszekot, ha a gyujtemeny mar viseli a mi azonositonkat", async () => {
    const f = fakes({
      existing: [
        {
          id: "pcol_9",
          title: "Tunze",
          handle: "tunze",
          external_id: "brand-1",
        },
      ],
    });

    const report = await f.service.run(f.client, [brand()], now);

    assert.deepEqual(f.created, []);
    assert.deepEqual(f.linked, [{ brandId: "brand-1", medusaId: "pcol_9" }]);
    assert.equal(report.linkedOnly, 1);
  });

  /**
   * ELAVULT SORNAL `relink`, NEM `link`. A `link` szandekosan megtagadja a
   * felulirast; itt a terv MERTE, hogy a regi azonosito nincs a listaban.
   */
  it("elavult sornal atkot, nem uj sort ir", async () => {
    const f = fakes({
      mappings: [{ brandId: "brand-1", medusaCollectionId: "pcol_regi" }],
    });

    const report = await f.service.run(f.client, [brand()], now);

    assert.deepEqual(f.relinked, [{ brandId: "brand-1", medusaId: "pcol_1" }]);
    assert.deepEqual(f.linked, []);
    assert.equal(report.relinked, 1);
  });

  it("utkozesnel semmit nem ir, es megnevezi a markat", async () => {
    const f = fakes({
      existing: [
        {
          id: "pcol_uj",
          title: "Tunze",
          handle: "tunze",
          external_id: "brand-1",
        },
      ],
      mappings: [{ brandId: "brand-1", medusaCollectionId: "pcol_regi" }],
    });

    const report = await f.service.run(f.client, [brand()], now);

    assert.deepEqual(f.created, []);
    assert.deepEqual(f.linked, []);
    assert.deepEqual(f.relinked, []);
    assert.deepEqual(report.conflicts, ["brand-1"]);
  });

  it("az archivalt markat nem viszi ki, es a sajat listajaban jelenti", async () => {
    const f = fakes({});

    const report = await f.service.run(
      f.client,
      [brand({ archivedAt: new Date("2026-09-01T00:00:00.000Z") })],
      now,
    );

    assert.deepEqual(f.created, []);
    assert.deepEqual(report.skippedArchived, ["brand-1"]);
  });

  /**
   * A CSONKOLT LISTA MEGALLIT, ES EZ NEM OVATOSSAG: egy csonkolt lista ugyanugy
   * nez ki, mint egy teljes, es a terv a levagott vegen allo markakat akarna
   * LETREHOZNI -- vagyis masodpeldanyt szulne a Medusan.
   */
  it("megtagadja a betoltest, ha a gyujtemeny-lista csonkolt", async () => {
    const f = fakes({ truncated: true });

    await assert.rejects(
      f.service.run(f.client, [brand()], now),
      MedusaBrandImportRefusedError,
    );
    assert.deepEqual(f.created, []);
  });

  /**
   * A VISSZAOLVASAS UJABB LEKERDEZES, NEM SAJAT KONYVELES.
   *
   * Egy konyvelt szam (amit letrehoztunk, azt hozzaadjuk) ugyanezt adna, es
   * semmit nem MERNE: azt allitana, hogy megtortent az, amit mi magunk kertunk.
   * Ezert all itt allitas a MASODIK lekerdezesre, es ezert ad a dupla MAS
   * valaszt a masodik hivasra.
   */
  it("a futas vegen ujra lekerdez, es a visszaolvasott listat szamolja", async () => {
    const f = fakes({
      existing: [],
      afterwards: [
        {
          id: "pcol_1",
          title: "Tunze",
          handle: "tunze",
          external_id: "brand-1",
        },
      ],
    });

    const report = await f.service.run(f.client, [brand()], now);

    assert.equal(f.listCalls(), 2);
    assert.equal(report.verification.carryingOurId, 1);
    assert.equal(report.verification.expected, 1);
  });
});
