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
  /**
   * Alapból ÉRTÉKESÍTHETŐ állapot, hogy a meglévő tesztek arról szóljanak,
   * amiről eddig: az azonossági láncról. A publikációs viselkedést külön
   * tesztek mérik, saját bemenettel.
   */
  publication: {
    catalogAuthority: "ACROPORA",
    isActive: true,
    webshopSellable: true,
    activeVariantCount: 1,
  },
};

/** A stage csatornája; a tesztekben csak annyi számít, hogy VAN érték. */
const SALES_CHANNEL = "sc_test_channel";

function fakes(options: {
  link?: { productId: string; medusaProductId: string } | null;
  found?: MedusaProductRow[];
  truncated?: boolean;
  channelMissing?: boolean;
}) {
  const calls: string[] = [];
  const linked: { productId: string; medusaProductId: string }[] = [];
  /**
   * A create BEMENETE, nem csak az, hogy meghívtuk. A hívás-sorrend eddig is
   * mérve volt, a küldött alak viszont nem, és pont az bukott el élesben: a
   * Medusa a változat ár-tömbjét megköveteli, mi meg nem küldtük.
   */
  const createdWith: MedusaProductInput[] = [];
  /**
   * Az update BEMENETE, ugyanabból az okból, amiért a create-é: a publikációs
   * kör állítása az, hogy MIT küldünk, nem az, hogy hívunk-e.
   */
  const updatedWith: Partial<MedusaProductInput>[] = [];

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
    findSalesChannel: async (id: string) => {
      calls.push("findSalesChannel");
      return options.channelMissing ? null : { id, name: "Acropora Webshop" };
    },
    update: async (_id: string, input: Partial<MedusaProductInput>) => {
      calls.push("update");
      updatedWith.push(input);
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
    updatedWith,
    links,
    medusa,
    service: new MedusaProductProjectionService(links, medusa, SALES_CHANNEL),
  };
}

describe("MedusaProductProjectionService", () => {
  it("creates the product when nothing points at it yet", async () => {
    const { service, calls, linked } = fakes({ link: null, found: [] });

    const outcome = await service.project(product, now);

    assert.deepEqual(outcome, {
      action: "created",
      medusaProductId: "prod_uj",
      publication: {
        status: "published",
        salesChannel: "attach",
        reason: "értékesíthető a webshopban",
        salesChannelName: "Acropora Webshop",
      },
    });
    assert.deepEqual(calls, [
      "findSalesChannel",
      "findLink",
      "search",
      "create",
      "link",
    ]);
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
      /**
       * A publikációs mezők a LÉTREHOZÁSNÁL is mennek, és ez nem díszítés: a
       * telepített 2.19.0 validátora szerint a `status` alapértelmezése
       * `draft`, tehát a mező elhagyása nem semleges, hanem draftot jelent.
       */
      status: "published",
      sales_channels: [{ id: SALES_CHANNEL }],
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
      publication: {
        status: "published",
        salesChannel: "attach",
        reason: "értékesíthető a webshopban",
        salesChannelName: "Acropora Webshop",
      },
    });
    assert.deepEqual(calls, ["findSalesChannel", "findLink", "update", "link"]);
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
      publication: {
        status: "published",
        salesChannel: "attach",
        reason: "értékesíthető a webshopban",
        salesChannelName: "Acropora Webshop",
      },
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
      publication: {
        status: "published",
        salesChannel: "attach",
        reason: "értékesíthető a webshopban",
        salesChannelName: "Acropora Webshop",
      },
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
      {
        ...product,
        primarySku: null,
        /**
         * A VALÓSÁGOS eset: cikkszám akkor hiányzik, ha nincs aktív változat.
         * A `sku` oszlop nem nullázható, tehát a másik kombináció (aktív
         * változat, cikkszám nélkül) csak hívó-hibából állhat elő - annak
         * saját tesztje van.
         */
        publication: { ...product.publication, activeVariantCount: 0 },
      },
      now,
    );

    assert.equal(outcome.action, "stopped");
    assert.ok(outcome.action === "stopped");
    assert.equal(outcome.reason, "no-sku");
    assert.deepEqual(calls, [], "cikkszám nélkül semmit nem kérdezünk odaát");

    /**
     * AZ ÜZENET NEM ÁLLÍTHAT TÖBBET, MINT AMIT A SZOLGÁLTATÁS TUD.
     *
     * Régen azt írta, hogy „a terméknek nincs cikkszáma". Ezt innen nem lehet
     * tudni: a `sku` oszlop nem nullázható, tehát a terméknek LEHET cikkszáma,
     * csak nem olyan változaton, amit a hívó átvinne. A pontos okot az tudja,
     * aki a lekérdezést futtatta - lásd `describeNoProjectableSku`.
     */
    assert.ok(
      !/nincs cikkszáma$/.test(outcome.details),
      "ilyen állapot az adatmodell szerint elő sem állhat: a sku oszlop nem nullázható",
    );
    assert.match(outcome.details, /nincs AKTÍV változata/);
    assert.match(outcome.details, /változat aktiválása/);
  });
});

describe("a hiányzó cikkszám MELYIK esete", () => {
  /**
   * A KÉT ESET KÜLÖN, mert a teendő is más.
   *
   * A cikkszám oszlop nem nullázható, tehát a hiányzó elsődleges cikkszám nem
   * jelenthet cikkszám-hiányt. Vagy nincs aktív változat (a termék állapota),
   * vagy a hívó ellentmondó bemenetet adott (a hívó hibája). A régi, egyetlen
   * mondat mindkettőt „a terméknek nincs cikkszáma" néven fedte, és egyik
   * esetben sem mutatott a teendőre.
   */
  it("nincs aktív változat: a termék állapotát nevezi meg", async () => {
    const { service } = fakes({});
    const outcome = await service.project(
      {
        ...product,
        primarySku: null,
        publication: { ...product.publication, activeVariantCount: 0 },
      },
      now,
    );

    assert.ok(outcome.action === "stopped");
    assert.match(outcome.details, /nincs AKTÍV változata/);
    assert.match(outcome.details, /NEM cikkszám-hiány/);
  });

  it("van aktív változat, de nincs cikkszám: a HÍVÓT nevezi meg", async () => {
    const { service } = fakes({});
    const outcome = await service.project(
      {
        ...product,
        primarySku: null,
        publication: { ...product.publication, activeVariantCount: 2 },
      },
      now,
    );

    assert.ok(outcome.action === "stopped");
    assert.match(outcome.details, /ellentmondó bemenet/);
    assert.match(outcome.details, /2 aktív/);
    assert.ok(
      !outcome.details.includes("nincs AKTÍV változata"),
      "ez nem a termék állapota, és a mondat sem állíthatja annak",
    );
  });
});

describe("a publikáció és a csatorna a vetítésben", () => {
  const sellableProduct = (
    overrides: Partial<ProjectableProduct["publication"]> = {},
  ): ProjectableProduct => ({
    ...product,
    publication: { ...product.publication, ...overrides },
  });

  it("értékesíthető terméket published állapotban és a csatornához kötve hoz létre", async () => {
    const { service, createdWith } = fakes({ link: null, found: [] });

    const outcome = await service.project(sellableProduct(), now);

    assert.equal(outcome.action, "created");
    assert.equal(createdWith.at(-1)?.status, "published");
    assert.deepEqual(createdWith.at(-1)?.sales_channels, [
      { id: SALES_CHANNEL },
    ]);
  });

  it("nem értékesíthető terméknél draft ÉS üres csatorna-lista megy egy kérésben", async () => {
    /**
     * Az üres lista a LEKÖTÉS: a telepített 2.19.0 frissítő folyamata a
     * mezőt cseréként kezeli, tehát a meglévő linkeket törli és a kapott
     * (üres) listát hozza létre.
     */
    const { service, updatedWith } = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });

    await service.project(sellableProduct({ webshopSellable: false }), now);

    assert.equal(updatedWith.at(-1)?.status, "draft");
    assert.deepEqual(updatedWith.at(-1)?.sales_channels, []);
  });

  it("a második futás ugyanazt küldi, mint az első", async () => {
    // A brief 5. tesztje: nincs duplikált csatorna-kapcsolat. A cél oldali
    // csere-szemantika miatt ez abból következik, hogy ugyanazt küldjük.
    const first = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });
    await first.service.project(sellableProduct(), now);
    await first.service.project(sellableProduct(), now);

    assert.equal(first.updatedWith.length, 2);
    assert.deepEqual(first.updatedWith[0], first.updatedWith[1]);
  });

  it("a jelentés megmondja, mit állított be és miért", async () => {
    // A brief 11. tesztje. Egy "kész" sor önmagában nem mondja meg, mi lett
    // a termékkel.
    const { service } = fakes({ link: null, found: [] });

    const outcome = await service.project(
      sellableProduct({ isActive: false }),
      now,
    );

    assert.equal(outcome.action, "created");
    if (outcome.action !== "created") return;
    assert.equal(outcome.publication.status, "draft");
    assert.equal(outcome.publication.salesChannel, "detach");
    assert.equal(outcome.publication.reason, "a termék inaktív");
  });

  it("HANGOSAN megáll, ha a csatorna azonosítója nincs beállítva", async () => {
    /**
     * A legfontosabb teszt ebben a csoportban, és nem a leglátványosabb.
     *
     * A csendes alternatívák mindegyike rosszabb: a mező elhagyása félkész
     * állapotot hagyna (a status átáll, a link marad), az üres lista pedig
     * lekötésnek látszana, amit utólag senki nem tud megkülönböztetni egy
     * szándékos döntéstől. Ezért NEM küldünk semmit.
     */
    const { links, medusa, calls } = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });
    const service = new MedusaProductProjectionService(links, medusa, null);

    const outcome = await service.project(sellableProduct(), now);

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "sales-channel-not-configured");
    assert.equal(calls.length, 0, "egyetlen hívás sem mehetett ki");
  });
  it("HANGOSAN megáll, ha a beállított csatorna NEM LÉTEZIK a cél oldalon", async () => {
    /**
     * Ez az az eset, amit egy környezetből a másikba átörökölt beállítás
     * okoz: a stage azonosítója az élesen nem létezik. Az ELSŐ használatkor
     * derül ki, egyszer - és ez a legkorábbi pillanat, amikor egyáltalán
     * kiderülhet. Egy termék, ami nem jelenik meg a boltban, sokkal később és
     * sokkal drágábban mondaná el ugyanezt.
     */
    const { service, calls } = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
      channelMissing: true,
    });

    const outcome = await service.project(product, now);

    assert.equal(outcome.action, "stopped");
    if (outcome.action !== "stopped") return;
    assert.equal(outcome.reason, "sales-channel-not-found");
    assert.deepEqual(
      calls,
      ["findSalesChannel"],
      "a lekérdezésen kívül semmi nem mehetett ki",
    );
  });

  it("a csatornát EGYSZER kérdezi le, akárhány terméknél", async () => {
    // Az azonosító nem változik futás közben. Egy hívás terméknként olyan
    // költség lenne, amiért cserébe semmit nem tudnánk meg.
    const { service, calls } = fakes({
      link: { productId: product.id, medusaProductId: "prod_medusa_1" },
      found: [],
    });

    await service.project(product, now);
    await service.project(product, now);

    assert.equal(calls.filter((call) => call === "findSalesChannel").length, 1);
  });
});
