import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
  type MedusaProductInput,
} from "./medusa-admin.client.js";
import type {
  MedusaOrphanMark,
  MedusaProductLinkRepository,
} from "./medusa-product-link.repository.js";
import {
  MedusaProductProjectionService,
  type ProjectableProduct,
} from "./medusa-product-projection.service.js";

/**
 * AZ ARVA LEKEPEZES: OLYAN BOLTI TERMEKRE MUTAT, AMI MAR NINCS.
 *
 * A meres, amibol ez a fajl lett: a teszt boltban 22 termek all, nalunk 23
 * MEDUSA lekepezes-sor. A tobblet egy olyan azonositora mutat, amire a bolt
 * 404-et ad.
 *
 * AMIT A KORABBI VISELKEDES ROSSZUL MONDOTT: a 404 ugyanabba a
 * `medusa-write-failed` okba esett, mint egy 500 vagy egy megszakadt
 * kapcsolat, azzal a szoveggel, hogy a cel oldali allapot BIZONYTALAN. Egy
 * 404-nel viszont NEM bizonytalan: nem volt mit modositani. A ket eset
 * teendoje ellentetes -- az egyiket az ismetles megoldja, a masikat SOHA --,
 * es a kozos nev pont az ismetles fele mutatott.
 *
 * A KALIBRACIO EZERT KETIRANYU: a 404-nek az uj okot kell adnia, az 500-nak
 * viszont VALTOZATLANUL a regit. Egy olyan valtozas, ami minden irasbukast
 * arvanak nevez, ugyanugy hasznalhatatlan, csak a masik iranyba.
 */

const now = new Date("2026-09-04T10:00:00.000Z");
const SALES_CHANNEL = "sc_test_channel";

const product: ProjectableProduct = {
  id: "prod-os-1",
  name: "Reef Pump",
  description: "Leírás",
  descriptionLong: null,
  primarySku: "PUMP-1",
  medusaCategoryIds: null,
  medusaCollectionId: null,
  barcode: null,
  unit: null,
  secondaryUnit: null,
  secondaryUnitFactor: null,
  minimumOrderQuantity: null,
  maximumOrderQuantity: null,
  orderQuantityStep: null,
  slug: null,
  seoRobots: null,
  seoTitle: null,
  seoDescription: null,
  seoKeywords: null,
  unasProductUrl: null,
  images: null,
  publication: {
    catalogAuthority: "ACROPORA",
    isActive: true,
    webshopSellable: true,
    activeVariantCount: 1,
  },
};

const LINKELT = { productId: "prod-os-1", medusaProductId: "prod_medusa_1" };

interface Fakes {
  /** Amit az `update` dob. `null` = sikerul. */
  updateHiba?: unknown;
  /** A megjelolest is elbukhatjuk: a diagnozisnak akkor is meg kell lennie. */
  markHiba?: unknown;
}

function fakes({ updateHiba, markHiba }: Fakes) {
  const calls: string[] = [];
  const marks: { productId: string; medusaProductId: string; at: Date }[] = [];

  const links = {
    // eslint-disable-next-line @typescript-eslint/require-await
    async findByProductId() {
      calls.push("findLink");
      return { ...LINKELT, lastSyncedAt: null };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async link(productId: string, medusaProductId: string) {
      calls.push("link");
      return { productId, medusaProductId, lastSyncedAt: now };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async markOrphaned(
      productId: string,
      medusaProductId: string,
      at: Date,
    ): Promise<MedusaOrphanMark | null> {
      calls.push("markOrphaned");
      if (markHiba) throw markHiba;
      marks.push({ productId, medusaProductId, at });
      return {
        firstObservedAt: at.toISOString(),
        lastObservedAt: at.toISOString(),
        medusaProductId,
      };
    },
  } as unknown as MedusaProductLinkRepository;

  const medusa = {
    // eslint-disable-next-line @typescript-eslint/require-await
    async findSalesChannel(id: string) {
      return { id, name: "Acropora Webshop" };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async findByExternalId() {
      calls.push("findByExternalId");
      return { rows: [], truncated: false };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async update(_id: string, _input: Partial<MedusaProductInput>) {
      calls.push("update");
      if (updateHiba) throw updateHiba;
      return { id: LINKELT.medusaProductId, deleted_at: null };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async create(_input: MedusaProductInput) {
      calls.push("create");
      return { id: "prod_uj", deleted_at: null };
    },
  } as unknown as MedusaAdminClient;

  return {
    calls,
    marks,
    service: new MedusaProductProjectionService(links, medusa, SALES_CHANNEL),
  };
}

describe("a vetítés egy árva leképezésen", () => {
  it("a bolti 404-et ÁRVA leképezésnek nevezi, nem írásbukásnak", async () => {
    const { service } = fakes({
      updateHiba: new MedusaAdminHttpError(404, ""),
    });

    const outcome = await service.project(product, now);

    assert.equal(outcome.action, "stopped");
    assert.equal(
      outcome.action === "stopped" ? outcome.reason : null,
      "orphaned-link",
    );
  });

  /**
   * A "NE CSENDBEN HIBAZZON" MERHETO ALAKJA: a jelentesnek meg kell neveznie
   * a bolti azonositot es a TEENDOT. Enelkul a megallas csak egy ujabb
   * sor a naploban, amit ujraprobalasnak neznek.
   */
  it("megnevezi a bolti azonosítót és a teendőt", async () => {
    const { service } = fakes({
      updateHiba: new MedusaAdminHttpError(404, ""),
    });

    const outcome = await service.project(product, now);
    const details = outcome.action === "stopped" ? outcome.details : "";

    assert.match(details, /prod_medusa_1/);
    assert.match(details, /404/);
    assert.match(details, /--forget-link/);
  });

  it("megjelöli a sort, a megtalált párossal", async () => {
    const { service, marks } = fakes({
      updateHiba: new MedusaAdminHttpError(404, ""),
    });

    await service.project(product, now);

    assert.deepEqual(marks, [
      {
        productId: "prod-os-1",
        medusaProductId: "prod_medusa_1",
        at: now,
      },
    ]);
  });

  /**
   * AMIT NEM CSINALUNK, ES EZ A LENYEG. Egy torles innen nem semleges: a
   * kovetkezo futas lekepezes nelkul a LETREHOZO agra menne, tehat a torles
   * csendben ujra letrehozas lenne. A teszt ezert arra all, hogy sem uj
   * lekepezes, sem uj bolti termek nem keletkezik.
   */
  it("nem hoz létre új terméket és nem ír leképezést", async () => {
    const { service, calls } = fakes({
      updateHiba: new MedusaAdminHttpError(404, ""),
    });

    await service.project(product, now);

    assert.equal(calls.includes("create"), false);
    assert.equal(calls.includes("link"), false);
  });

  /**
   * Ha maga a megjeloles hasal el, a BAJ akkor is fennall. Egy elnyelt
   * arvasag rosszabb, mint egy jel nelkuli.
   */
  it("a megjelölés bukása sem nyeli el a diagnózist", async () => {
    const { service } = fakes({
      updateHiba: new MedusaAdminHttpError(404, ""),
      markHiba: new Error("adatbázis nem elérhető"),
    });

    const outcome = await service.project(product, now);

    assert.equal(
      outcome.action === "stopped" ? outcome.reason : null,
      "orphaned-link",
    );
  });
});

describe("a másik irány: ami NEM árva", () => {
  /**
   * A KALIBRACIO ELLENPONTJA. Egy 500 utan a cel oldali allapotot tenyleg nem
   * tudjuk, tehat a regi ok a helyes. Ha ez a teszt zoldrol pirosra valt,
   * valaki minden irasbukast arvanak nevezett el.
   */
  it("egy 500 továbbra is írásbukás, nem árvaság", async () => {
    const { service, calls } = fakes({
      updateHiba: new MedusaAdminHttpError(500, '{"message":"boom"}'),
    });

    const outcome = await service.project(product, now);

    assert.equal(
      outcome.action === "stopped" ? outcome.reason : null,
      "medusa-write-failed",
    );
    /** Es ilyenkor NEM jelolunk: nem tudjuk, hogy a termek eltunt-e. */
    assert.equal(calls.includes("markOrphaned"), false);
  });

  it("egy hálózati hiba sem árvaság", async () => {
    const { service, calls } = fakes({
      updateHiba: new Error("ECONNRESET"),
    });

    const outcome = await service.project(product, now);

    assert.equal(
      outcome.action === "stopped" ? outcome.reason : null,
      "medusa-write-failed",
    );
    assert.equal(calls.includes("markOrphaned"), false);
  });

  /**
   * KONTROLL: a sikeres ut valtozatlan. Enelkul a fenti tesztek akkor is
   * zoldek lennenek, ha a vetites minden terméken megallna.
   */
  it("egy élő termék frissítése változatlanul sikerül", async () => {
    const { service, calls } = fakes({});

    const outcome = await service.project(product, now);

    assert.equal(outcome.action, "updated");
    assert.equal(calls.includes("markOrphaned"), false);
    assert.equal(calls.includes("link"), true);
  });
});
