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
  /** a handle-ok, amelyekre a letrehozas elbukik (a Medusa elutasitja) */
  createFails?: string[];
  /** a markak, amelyeknel a lekepezes irasa elbukik */
  linkFails?: string[];
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
      if (input.createFails?.includes(payload.handle))
        throw new Error(
          `HTTP 400 Collection with handle ${payload.handle} already exists`,
        );
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
      if (input.linkFails?.includes(brandId))
        throw new Error("a lekepezes irasa elbukott");
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

  /*
    A HIBA MARKANKENT KULON (kartya ec82b629, merve a teszt kirakaton: a `fauna-marin` handle mar letezett, a letrehozas elbukott,
    a ciklus kivetelkent kiszallt, es a tobbi marka sem kapott gyujtemenyt -- a lepes eredmenye egyetlen hibasor volt). MI PIROSIT:
    ha egy marka hibaja leallitja a tobbit; ha a hiba nem jelenik meg a jelentesben markankent, fazissal; ha egy elbukott
    letrehozas lekepezest ir; ha egy elbukott lekepezes mellett a gyujtemeny letrehozottkent szamolodik.
  */
  const harom = [
    brand({ id: "b1", name: "Egy", slug: "egy" }),
    brand({ id: "b2", name: "Fauna Marin", slug: "fauna-marin" }),
    brand({ id: "b3", name: "Harom", slug: "harom" }),
  ];

  it("egy marka letrehozasi hibaja nem allitja le a tobbit, es markankent latszik", async () => {
    const f = fakes({ createFails: ["fauna-marin"] });

    const report = await f.service.run(f.client, harom, now);

    assert.deepEqual(
      f.created.map((c) => c.handle),
      ["egy", "harom"],
    );
    assert.deepEqual(
      f.linked.map((l) => l.brandId),
      ["b1", "b3"],
    );
    assert.equal(report.created, 2);
    assert.deepEqual(report.failures, [
      {
        ourId: "b2",
        phase: "create",
        message: "HTTP 400 Collection with handle fauna-marin already exists",
      },
    ]);
  });

  it("az elbukott letrehozas nem ir lekepezest", async () => {
    const f = fakes({ createFails: ["fauna-marin"] });
    await f.service.run(f.client, [harom[1]!], now);
    assert.deepEqual(f.linked, []);
    assert.deepEqual(f.relinked, []);
  });

  it("ha a gyujtemeny letrejott, de a lekepezes bukott, nem szamolodik letrehozottnak, a tobbi igen", async () => {
    const f = fakes({ linkFails: ["b2"] });

    const report = await f.service.run(f.client, harom, now);

    assert.equal(f.created.length, 3);
    assert.equal(report.created, 2);
    assert.deepEqual(
      report.failures.map((x) => [x.ourId, x.phase]),
      [["b2", "link"]],
    );
  });

  it("a csak-osszekoto lekepezes hibaja sem allitja le a letrehozasokat", async () => {
    const f = fakes({
      existing: [
        { id: "pcol_a", title: "Egy", handle: "egy", external_id: "b1" },
      ],
      linkFails: ["b1"],
    });

    const report = await f.service.run(f.client, harom, now);

    assert.deepEqual(
      f.created.map((c) => c.handle),
      ["fauna-marin", "harom"],
    );
    assert.deepEqual(
      report.failures.map((x) => [x.ourId, x.phase]),
      [["b1", "link"]],
    );
  });

  it("a hiba szovege egy sorba esik es hatarolt", async () => {
    const f = fakes({ createFails: ["fauna-marin"] });
    f.client.createProductCollection = async () => {
      throw new Error("HTTP 400\n  sok sor " + "x".repeat(400));
    };
    const report = await f.service.run(f.client, [harom[1]!], now);
    const message = report.failures[0]!.message;
    assert.ok(!message.includes("\n"));
    assert.ok(message.length <= 160);
  });

  /*
    A MERT ESET: a handle a Medusan mar letezik (nem a mi azonositonkkal). Ez eddig a lepest dobta; most a gyujtemenyhez kotunk, es
    NEM hozunk letre masodikat. MI PIROSIT: ha a letrehozas meg megprobalodik (a Medusa elutasitja); ha a lekepezes nem a
    meglevo gyujtemenyre mutat.
  */
  it("a mar letezo handle-hoz osszekot, nem probal letrehozni (a fauna-marin eset)", async () => {
    const f = fakes({
      existing: [
        {
          id: "pcol_fm",
          title: "Fauna Marin",
          handle: "fauna-marin",
          external_id: null,
        },
      ],
    });

    // a gyujtemenyben csak ennek a markanak a termekei allnak (57247): osszekotheto
    const kerdezett: { collectionId: string; brandId: string }[][] = [];
    const report = await f.service.run(
      f.client,
      harom,
      now,
      async (jeloltek) => {
        kerdezett.push([...jeloltek]);
        return new Map([
          [
            "pcol_fm",
            { total: 110, sameBrand: 110, otherBrand: 0, unknown: 0 },
          ],
        ]);
      },
    );

    assert.deepEqual(
      f.created.map((c) => c.handle),
      ["egy", "harom"],
    );
    assert.deepEqual(
      f.linked.filter((l) => l.brandId === "b2"),
      [{ brandId: "b2", medusaId: "pcol_fm" }],
    );
    assert.equal(report.linkedOnly, 1);
    assert.deepEqual(report.failures, []);
    // a tartalmat CSAK a jeloltre kerdezi, es egyszer
    assert.deepEqual(kerdezett, [[{ collectionId: "pcol_fm", brandId: "b2" }]]);
  });

  /*
    A TARTALMI FELTETEL A SZOLGALTATASBAN (57247). MI PIROSIT: ha a vegyes tartalmu gyujtemeny osszekotodik; ha tartalom-olvaso
    nelkul (a kezi parancs) osszekotodik; ha barmelyik esetben a tobbi marka nem jon letre.
  */
  it("a vegyes tartalmu, azonos handle-u gyujtemenyt nem koti ossze: foglalt handle, a tobbi letrejon", async () => {
    const f = fakes({
      existing: [
        {
          id: "pcol_fm",
          title: "Fauna Marin",
          handle: "fauna-marin",
          external_id: null,
        },
      ],
    });

    const report = await f.service.run(
      f.client,
      harom,
      now,
      async () =>
        new Map([
          ["pcol_fm", { total: 12, sameBrand: 10, otherBrand: 2, unknown: 0 }],
        ]),
    );

    assert.deepEqual(report.handleTaken, ["b2"]);
    assert.deepEqual(
      f.linked.filter((l) => l.brandId === "b2"),
      [],
    );
    assert.deepEqual(
      f.created.map((c) => c.handle),
      ["egy", "harom"],
    );
  });

  it("tartalom-olvaso nelkul (a kezi parancs) nem kot ossze: a marka nem ellenorzott, a tobbi letrejon", async () => {
    const f = fakes({
      existing: [
        {
          id: "pcol_fm",
          title: "Fauna Marin",
          handle: "fauna-marin",
          external_id: null,
        },
      ],
    });

    const report = await f.service.run(f.client, harom, now);

    assert.deepEqual(report.handleTaken, ["b2"]);
    assert.deepEqual(
      f.linked.filter((l) => l.brandId === "b2"),
      [],
    );
    assert.deepEqual(
      f.created.map((c) => c.handle),
      ["egy", "harom"],
    );
  });

  it("a masik marka azonositojat viselo handle-t nem veszi at, es nem is bukik: foglalt handle a jelentesben", async () => {
    const f = fakes({
      existing: [
        {
          id: "pcol_fm",
          title: "Fauna Marin",
          handle: "fauna-marin",
          external_id: "valaki-mas",
        },
      ],
    });

    const report = await f.service.run(f.client, harom, now);

    assert.deepEqual(report.handleTaken, ["b2"]);
    assert.deepEqual(
      f.created.map((c) => c.handle),
      ["egy", "harom"],
    );
    assert.deepEqual(report.failures, []);
    assert.equal(f.linked.filter((l) => l.brandId === "b2").length, 0);
  });
});
