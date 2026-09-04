import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
  type MedusaProductInput,
} from "./medusa-admin.client.js";
import type { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  MedusaProductProjectionService,
  type ProjectableProduct,
  type ProjectionOutcome,
} from "./medusa-product-projection.service.js";

/**
 * MI TÖRTÉNIK, AMIKOR EGY MEDUSA-HÍVÁS ELBUKIK.
 *
 * A vetítés ma EGYETLEN `try`-t sem tartalmaz: mind a négy Medusa-hívás
 * védtelen, a két ÍRÁS is. Ez a fájl nem azt rögzíti, hogy ez így maradjon -
 * a `#192` kör épp azt fogja eldönteni, hol nevezzük meg a HTTP-hibákat.
 *
 * Amit rögzít, az a KÉT ÁLLÍTÁS, aminek a megnevezés UTÁN is igaznak kell
 * lennie:
 *
 *   1. egy elbukott hívás soha nem eredményez SIKERT;
 *   2. egy elbukott ÍRÁS soha nem hagy maga után leképezést.
 *
 * Ezért ezek nem change-detectorok. Ma azért zöldek, mert a kivétel kiszáll,
 * és a megnevezés után azért maradnak zöldek, mert egy megnevezett megállás
 * sem sikert, sem leképezést nem ír. Pirosra AKKOR kell váltaniuk, ha valaki
 * elkapja a hibát és utána mégis továbbmegy: sikeresnek jelenti, vagy leköti a
 * terméket egy íráshoz, ami el sem jutott a cél oldalig.
 *
 * A `BODY` szándékosan felismerhető szöveg: a kontroll ezzel bizonyítja, hogy
 * a hívás tényleg elbukott, és nem egy korábbi ág állt meg helyette.
 */

const now = new Date("2026-08-27T20:00:00.000Z");
const SALES_CHANNEL = "sc_test_channel";
const BODY = '{"message":"MEDUSA_TEST_FAILURE_BODY"}';

const product: ProjectableProduct = {
  id: "prod-os-1",
  name: "Reef Pump",
  description: "Leírás",
  descriptionLong: null,
  primarySku: "PUMP-1",
  /** A fixtura NEM ad teljes kategoria-listat: a mezo igy nem kerul a torzsbe. */
  medusaCategoryIds: null,
  medusaCollectionId: null,
  slug: null,
  seoRobots: null,
  images: null,
  publication: {
    catalogAuthority: "ACROPORA",
    isActive: true,
    webshopSellable: true,
    activeVariantCount: 1,
  },
};

type FailurePoint =
  "findSalesChannel" | "findByExternalId" | "update" | "create";

function fakesFailingAt(
  failAt: FailurePoint,
  options: { link?: { productId: string; medusaProductId: string } | null },
) {
  const calls: string[] = [];
  const linked: { productId: string; medusaProductId: string }[] = [];

  const fail = (name: FailurePoint) => {
    if (name === failAt) throw new MedusaAdminHttpError(500, BODY);
  };

  const links = {
    findByProductId: async () => {
      calls.push("findLink");
      return options.link ? { ...options.link, lastSyncedAt: null } : null;
    },
    link: async (productId: string, medusaProductId: string) => {
      calls.push("link");
      linked.push({ productId, medusaProductId });
      return { productId, medusaProductId, lastSyncedAt: now };
    },
  } as unknown as MedusaProductLinkRepository;

  const medusa = {
    findSalesChannel: async (id: string) => {
      calls.push("findSalesChannel");
      fail("findSalesChannel");
      return { id, name: "Acropora Webshop" };
    },
    findByExternalId: async () => {
      calls.push("findByExternalId");
      fail("findByExternalId");
      return { rows: [], truncated: false };
    },
    update: async (_id: string, _input: Partial<MedusaProductInput>) => {
      calls.push("update");
      fail("update");
      return { id: "prod_x", deleted_at: null };
    },
    create: async (_input: MedusaProductInput) => {
      calls.push("create");
      fail("create");
      return { id: "prod_uj", deleted_at: null };
    },
  } as unknown as MedusaAdminClient;

  return {
    calls,
    linked,
    service: new MedusaProductProjectionService(links, medusa, SALES_CHANNEL),
  };
}

/**
 * A hívás KIMENETELE, akár kivétellel végződik, akár eredménnyel. A két eset
 * együtt kell, mert az állítás mindkettőre szól: ma kivétel, a megnevezés után
 * eredmény, és egyik sem lehet siker.
 */
async function settle(
  promise: Promise<ProjectionOutcome>,
): Promise<
  { threw: true; error: unknown } | { threw: false; outcome: ProjectionOutcome }
> {
  try {
    return { threw: false, outcome: await promise };
  } catch (error) {
    return { threw: true, error };
  }
}

const FAILURE_POINTS: FailurePoint[] = [
  "findSalesChannel",
  "findByExternalId",
  "update",
  "create",
];

/** Melyik ághoz melyik kiinduló leképezés-állapot kell. */
const LINK_FOR: Record<
  FailurePoint,
  { productId: string; medusaProductId: string } | null
> = {
  findSalesChannel: null,
  findByExternalId: null,
  update: { productId: "prod-os-1", medusaProductId: "prod_medusa_1" },
  create: null,
};

describe("a vetítés egy elbukott Medusa-hívás után", () => {
  /**
   * KONTROLL. Enélkül minden alábbi teszt üresen is zöld lenne: ha a vetítés
   * egy korábbi ágon állna meg, a hívás el sem indulna, és a "nem jelent
   * sikert" állítás igaz lenne anélkül, hogy bármit mértünk volna.
   *
   * MINEK KELL PIROSÍTANIA: ha egy hívás kikerül a vetítés útjából, vagy a
   * hamisítvány nem ott bukik el, ahol a teszt hiszi.
   */
  for (const point of FAILURE_POINTS) {
    it(`kontroll: a(z) ${point} hívás tényleg lefut és tényleg elbukik`, async () => {
      const { service, calls } = fakesFailingAt(point, {
        link: LINK_FOR[point],
      });

      const result = await settle(service.project(product, now));

      assert.ok(
        calls.includes(point),
        `a(z) ${point} hívás el sem indult: ${calls.join(", ")}`,
      );
      assert.ok(
        !result.threw || result.error instanceof MedusaAdminHttpError,
        "ha kivétel száll ki, annak a Medusa HTTP-hibájának kell lennie, nem másnak",
      );
    });
  }

  /**
   * ELSŐ ÁLLÍTÁS: egy elbukott hívás soha nem eredményez sikert.
   *
   * MINEK KELL PIROSÍTANIA: ha valaki elkapja a HTTP-hibát, és utána
   * `created`, `updated` vagy `relinked` kimenetet ad vissza. Egy megnevezett
   * MEGÁLLÁS nem pirosítja, mert az nem siker.
   */
  for (const point of FAILURE_POINTS) {
    it(`nem jelent sikert, ha a(z) ${point} elbukott`, async () => {
      const { service } = fakesFailingAt(point, { link: LINK_FOR[point] });

      const result = await settle(service.project(product, now));

      if (!result.threw)
        assert.equal(
          result.outcome.action,
          "stopped",
          `a(z) ${point} elbukott, a vetítés mégis ezt adta: ${result.outcome.action}`,
        );
    });
  }

  /**
   * HARMADIK ÁLLÍTÁS: a megállás szövege a STÁTUSZT viszi, a TÖRZSET nem.
   *
   * Ez a `#192` kör másik fele, és nem stílus kérdése. A
   * `MedusaAdminHttpError` üzenete a válasz törzsének első 500 karakterét is
   * viszi - hibakeresésnél az a hasznos -, a megállás-szöveg viszont a
   * jelentésbe és a parancssori kimenetre kerül, ahol nem tudjuk, ki olvassa.
   * Azt pedig NEM tudjuk, a Medusa melyik hibaválasza mit visszhangoz.
   *
   * MINEK KELL PIROSÍTANIA: ha valaki a hibaleírást megint az `error.message`
   * értékből veszi, vagy egy új elkapási helyen kihagyja a közös leírót.
   */
  for (const point of FAILURE_POINTS) {
    it(`a(z) ${point} megállás-szövege státuszt mond, törzset nem`, async () => {
      const { service } = fakesFailingAt(point, { link: LINK_FOR[point] });

      const result = await settle(service.project(product, now));

      assert.ok(
        !result.threw,
        "a megnevezés után nem kivétel jön, hanem megállás",
      );
      assert.ok(result.outcome.action === "stopped");
      assert.match(result.outcome.details, /HTTP 500/);
      assert.ok(
        !result.outcome.details.includes("MEDUSA_TEST_FAILURE_BODY"),
        `a válasz törzse bekerült a megállás-szövegbe: ${result.outcome.details}`,
      );
    });
  }

  /**
   * MÁSODIK ÁLLÍTÁS: egy elbukott ÍRÁS nem hagy maga után leképezést.
   *
   * Ez a súlyosabb a kettő közül. A leképezés azt állítja, hogy a mi
   * termékünk ODAÁT létezik ezen az azonosítón. Ha az írás el sem jutott a
   * cél oldalig, a leképezés HAZUDIK, és a következő futás már nem is
   * keresne rá: a `findByProductId` ág elhinné, hogy a termék kint van.
   *
   * MINEK KELL PIROSÍTANIA: ha valaki elkapja az írás hibáját, és a
   * `links.link` hívás mégis lefut utána.
   */
  for (const point of ["update", "create"] as const) {
    it(`nem ír leképezést, ha a(z) ${point} elbukott`, async () => {
      const { service, linked } = fakesFailingAt(point, {
        link: LINK_FOR[point],
      });

      await settle(service.project(product, now));

      assert.deepEqual(
        linked,
        [],
        `a(z) ${point} elbukott, mégis született leképezés: ${JSON.stringify(linked)}`,
      );
    });
  }
});
