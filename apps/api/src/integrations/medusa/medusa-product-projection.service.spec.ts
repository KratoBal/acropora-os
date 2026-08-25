import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  MedusaAdminClient,
  MedusaProductInput,
  MedusaProductRow,
} from "./medusa-admin.client.js";
import type { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  MedusaProductProjectionService,
  type ProjectableProduct,
} from "./medusa-product-projection.service.js";

/**
 * A vetítés DÖNTÉSE mérve, hívás nélkül.
 *
 * Amit itt bizonyítani kell, az nem az, hogy a HTTP-hívás jól van megírva,
 * hanem hogy a döntés helyes akkor is, amikor a világ nem a legegyszerűbb
 * állapotában van: elveszett leképezés, törölt sor, két élő találat.
 */

const now = new Date("2026-08-24T23:00:00.000Z");

const product: ProjectableProduct = {
  id: "prod-os-1",
  name: "Reef Pump",
  description: "Leírás",
  primarySku: "PUMP-1",
};

function fakes(options: {
  link?: { productId: string; medusaProductId: string } | null;
  found?: MedusaProductRow[];
  truncated?: boolean;
}) {
  const calls: string[] = [];
  const linked: { productId: string; medusaProductId: string }[] = [];
  /**
   * A create BEMENETE, nem csak az, hogy meghívtuk. A hívás-sorrend eddig is
   * mérve volt, a küldött alak viszont nem, és pont az bukott el élesben: a
   * Medusa a változat ár-tömbjét megköveteli, mi meg nem küldtük.
   */
  const createdWith: MedusaProductInput[] = [];

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
    findByExternalId: async () => {
      calls.push("search");
      return {
        rows: options.found ?? [],
        truncated: options.truncated ?? false,
      };
    },
    create: async (input: MedusaProductInput) => {
      calls.push("create");
      createdWith.push(input);
      return { id: "prod_uj", deleted_at: null };
    },
    update: async () => {
      calls.push("update");
      return {
        id: options.link?.medusaProductId ?? "prod_x",
        deleted_at: null,
      };
    },
  } as unknown as MedusaAdminClient;

  return {
    calls,
    linked,
    createdWith,
    service: new MedusaProductProjectionService(links, medusa),
  };
}

describe("MedusaProductProjectionService", () => {
  it("creates the product when nothing points at it yet", async () => {
    const { service, calls, linked } = fakes({ link: null, found: [] });

    const outcome = await service.project(product, now);

    assert.deepEqual(outcome, {
      action: "created",
      medusaProductId: "prod_uj",
    });
    assert.deepEqual(calls, ["findLink", "search", "create", "link"]);
    assert.deepEqual(linked, [
      { productId: "prod-os-1", medusaProductId: "prod_uj" },
    ]);
  });

  /**
   * A KÜLDÖTT ALAK, karakterre.
   *
   * Ez az állítás egy éles bukásból született: a Medusa 400-zal utasította el
   * a létrehozást, mert a változat `prices` mezője kötelező, és mi nem
   * küldtük. A hiba hangos volt, de a mező HIÁNYÁT semmi nem tartotta: a
   * hívás-sorrend zöld maradt, a kliens tesztje pedig a keresést méri.
   *
   * Az `prices: []` itt nem formaság, hanem a kör állítása: a mező azért van
   * ott, mert a cél oldal megköveteli, és azért ÜRES, mert nem viszünk át
   * árat. Ha valaki egyszer beleír egy összeget, ennek a sornak kell pirosra
   * váltania, nem egy éles futásnak.
   */
  it("sends the shape the create endpoint requires, with no price in it", async () => {
    const { service, createdWith } = fakes({ link: null, found: [] });

    await service.project(product, now);

    assert.equal(createdWith.length, 1);
    assert.deepEqual(createdWith[0], {
      title: "Reef Pump",
      description: "Leírás",
      external_id: "prod-os-1",
      options: [{ title: "Kivitel", values: ["Alap"] }],
      variants: [
        {
          title: "Reef Pump",
          sku: "PUMP-1",
          options: { Kivitel: "Alap" },
          prices: [],
        },
      ],
    });
  });

  /**
   * A második futás NEM hoz létre semmit. Ez a kör első bizonyítása, és a
   * hívás-sorrend a bizonyíték: `create` nem szerepel benne.
   */
  it("updates instead of creating when the mapping is already there", async () => {
    const { service, calls } = fakes({
      link: { productId: "prod-os-1", medusaProductId: "prod_megvan" },
    });

    const outcome = await service.project(product, now);

    assert.deepEqual(outcome, {
      action: "updated",
      medusaProductId: "prod_megvan",
    });
    assert.deepEqual(calls, ["findLink", "update", "link"]);
    assert.ok(
      !calls.includes("create"),
      "meglévő leképezésnél nem hozunk létre",
    );
    assert.ok(!calls.includes("search"), "leképezéssel nem is kell keresni");
  });

  /**
   * A második bizonyítás: elveszett leképezés mellett a külső azonosító
   * megtalálja az ÉLŐ terméket, és abból áll helyre a leképezés. Egy
   * megvalósítás, ami itt létrehoz, minden elveszett leképezésnél új terméket
   * szülne - és pontosan ezt kellett kizárni.
   */
  it("recovers the mapping from a live match instead of creating a second product", async () => {
    const { service, calls, linked } = fakes({
      link: null,
      found: [{ id: "prod_elo", deleted_at: null }],
    });

    const outcome = await service.project(product, now);

    assert.deepEqual(outcome, {
      action: "relinked",
      medusaProductId: "prod_elo",
    });
    assert.ok(!calls.includes("create"));
    assert.deepEqual(linked, [
      { productId: "prod-os-1", medusaProductId: "prod_elo" },
    ]);
  });

  /**
   * Egy TÖRÖLT és egy ÉLŐ sor ugyanazzal az azonosítóval hétköznapi állapot,
   * NEM hiba: pont az áll elő, ha valamit törölnek és az azonosító újra
   * bekerül. Az élő számít; a törölt történelem. Ez az az eset, amit nyers
   * sorokat számolva tévesen hibának néznénk.
   */
  it("treats a deleted row beside a live one as history, not as ambiguity", async () => {
    const { service } = fakes({
      link: null,
      found: [
        { id: "prod_regi", deleted_at: "2026-08-01T00:00:00.000Z" },
        { id: "prod_elo", deleted_at: null },
      ],
    });

    assert.deepEqual(await service.project(product, now), {
      action: "relinked",
      medusaProductId: "prod_elo",
    });
  });

  /**
   * Két ÉLŐ találat: nem választunk közülük. A Medusa nem garantálja a külső
   * azonosító egyediségét (nincs rajta index), tehát ez előfordulhat, és a
   * helyes válasz a megállás - mindkettőt néven nevezve, mert egy szám nem
   * mondja meg, melyikről van szó.
   */
  it("stops on two live matches, and names both", async () => {
    const { service, calls } = fakes({
      link: null,
      found: [
        { id: "prod_egy", deleted_at: null },
        { id: "prod_ketto", deleted_at: null },
      ],
    });

    const outcome = await service.project(product, now);

    assert.equal(outcome.action, "stopped");
    assert.equal(
      outcome.action === "stopped" ? outcome.reason : null,
      "ambiguous",
    );
    assert.match(
      outcome.action === "stopped" ? outcome.details : "",
      /prod_egy.*prod_ketto/,
    );
    assert.ok(!calls.includes("create"));
    assert.ok(!calls.includes("link"), "ütközésnél leképezést sem írunk");
  });

  /**
   * Csak törölt találat: MEGSZAKADT AZONOSSÁGI LÁNC, Balázs döntése szerint
   * megállás és jelentés.
   *
   * A jelentés tartalmát is állítjuk, nem csak a tényt: egy „identity
   * conflict" önmagában nem mondja meg, MELYIK terméket kell megnézni. Benne
   * kell lennie az OS-termék azonosítójának és a törölt Medusa-sornak.
   *
   * A mai stage-adaton ez az ág NEM érhető el (nulla puhán törölt termék),
   * tehát ez a teszt szándékosan konstruált állapotot vizsgál.
   */
  it("stops when the external id only sits on deleted products", async () => {
    const { service, calls } = fakes({
      link: null,
      found: [{ id: "prod_torolt", deleted_at: "2026-08-01T00:00:00.000Z" }],
    });

    const outcome = await service.project(product, now);

    assert.equal(outcome.action, "stopped");
    assert.equal(
      outcome.action === "stopped" ? outcome.reason : null,
      "broken-identity-chain",
    );
    const details = outcome.action === "stopped" ? outcome.details : "";
    assert.match(
      details,
      /prod-os-1/,
      "az OS-termék azonosítója szerepeljen benne",
    );
    assert.match(
      details,
      /prod_torolt/,
      "a törölt Medusa-sor is szerepeljen benne",
    );
    assert.match(details, /TÖRÖLT/, "mondja ki, hogy a találat törölt");
    assert.ok(
      !calls.includes("create"),
      "törölt találat mellé nem hozunk létre",
    );
    assert.ok(
      !calls.includes("link"),
      "megszakadt láncnál leképezést sem írunk",
    );
  });

  /**
   * Csonkolt válaszon nem döntünk. A lista nem rendez, tehát egy kimerített
   * limit tetszőleges részhalmazt ad, és abból az élők száma bármi lehet: két
   * élő és egy törölt találatból visszajöhetne egy élő meg egy törölt, amiből
   * a szolgáltatás azt olvasná ki, hogy pontosan egy élő van, és rákötné a
   * leképezést a rossz termékre.
   */
  it("refuses to decide on a truncated lookup", async () => {
    const { service, calls } = fakes({
      link: null,
      found: [{ id: "prod_elo", deleted_at: null }],
      truncated: true,
    });

    const outcome = await service.project(product, now);

    assert.equal(outcome.action, "stopped");
    assert.equal(
      outcome.action === "stopped" ? outcome.reason : null,
      "lookup-truncated",
    );
    assert.ok(!calls.includes("create"));
    assert.ok(
      !calls.includes("link"),
      "csonkolt halmaznál leképezést sem írunk",
    );
  });

  it("stops on a product with no sku instead of inventing one", async () => {
    const { service, calls } = fakes({ link: null, found: [] });

    const outcome = await service.project(
      { ...product, primarySku: null },
      now,
    );

    assert.equal(outcome.action, "stopped");
    assert.equal(
      outcome.action === "stopped" ? outcome.reason : null,
      "no-sku",
    );
    assert.deepEqual(calls, [], "cikkszám nélkül semmit nem kérdezünk odaát");
  });
});
