import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { categoryHandle } from "../../integrations/medusa/medusa-category-handle.js";
import {
  categoryHandles,
  normalizeMedusaCategories,
  planCategoryRedirectBackfill,
  type CategoryForRedirect,
  type MedusaCategoryRef,
} from "./category-redirect-backfill.js";
import { main } from "./category-redirect-backfill.cli.js";

/**
 * A RÉGI UNAS-KATEGÓRIACÍMEK ÁTIRÁNYÍTÁSA (commerce audit P1). MI PIROSIT: a cél nem a
 * Medusába kerülő handle (hanem az OS `/hu/kategoria/<slug>`-ja, amit a kirakat nem
 * ismer); egy `/spl/` vagy `/sct/` út rossz kategóriára köt; egy kétértelmű névszlug
 * (`/aquaforest` sok szülő alatt) mégis ír; egy termék, blog- vagy statikus lap
 * kategóriaként kap szabályt; a szárazfutás ír; a második futás újra ír.
 *
 * A FA: Termékek > Eledelek > Koralltápok > Aquaforest; Termékek > Szűrők >
 * Aquaforest (a név kétszer); Termékek > Triton (egyedi név); egy Eledelek nevű
 * kategória nincs másik.
 */
const fa: CategoryForRedirect[] = [
  { id: "k-root", unasId: "742922", name: "Termékek", parentId: null },
  { id: "k-eled", unasId: "111", name: "Eledelek", parentId: "k-root" },
  { id: "k-kor", unasId: "222", name: "Koralltápok", parentId: "k-eled" },
  { id: "k-aqf1", unasId: "390588", name: "Aquaforest", parentId: "k-kor" },
  { id: "k-szur", unasId: "333", name: "Szűrők", parentId: "k-root" },
  { id: "k-aqf2", unasId: "444", name: "Aquaforest", parentId: "k-szur" },
  { id: "k-triton", unasId: "555", name: "Triton", parentId: "k-root" },
];

const plan = async (
  paths: string[],
  existing: Parameters<typeof planCategoryRedirectBackfill>[2] = [],
  form: "current" | "legacy" = "current",
) => planCategoryRedirectBackfill(paths, fa, existing, { form });

const sorok = (store: Awaited<ReturnType<typeof plan>>["store"]) =>
  store.created().map((r) => `${r.sourcePath} -> ${r.destinationPath}`);

describe("categoryHandles", () => {
  it("a döntött képlet: a szülő neve csak ütközésnél a címben; a régi: minden nem gyökéren", () => {
    const j = categoryHandles(fa, "current");
    assert.equal(j.get("k-eled"), "eledelek");
    assert.equal(j.get("k-triton"), "triton");
    assert.equal(j.get("k-aqf1"), "aquaforest-koralltapok"); // a név kétszer van: a szülővel
    assert.equal(j.get("k-aqf2"), "aquaforest-szurok");
    const r = categoryHandles(fa, "legacy");
    assert.equal(r.get("k-root"), "termekek");
    assert.equal(r.get("k-eled"), "eledelek-termekek");
    assert.equal(r.get("k-triton"), "triton-termekek");
  });

  it("ugyanaz a számítás, amivel a Medusába kerül (categoryHandle a címből)", () => {
    assert.equal(
      categoryHandles(fa, "current").get("k-aqf1"),
      categoryHandle("Aquaforest - Koralltápok"),
    );
  });
});

describe("planCategoryRedirectBackfill", () => {
  it("a /spl/ és /sct/ út a UNAS-azonosítóra köt; a cél /hu/categories/<handle>", async () => {
    const { store, report } = await plan([
      "/spl/390588/Aquaforest",
      "/sct/111/Eledelek",
      "/sct/742922/Termekek",
    ]);
    assert.deepEqual(sorok(store), [
      "/sct/111/Eledelek -> /hu/categories/eledelek",
      "/sct/742922/Termekek -> /hu/categories/termekek",
      "/spl/390588/Aquaforest -> /hu/categories/aquaforest-koralltapok",
    ]);
    assert.equal(store.created()[0]!.reason, "UNAS_CATEGORY");
    assert.equal(report.created, 3);
    assert.deepEqual(report.invariantViolations, []);
  });

  it("ismeretlen azonosító (/sct/0/) és törölt kategória: nincs szabály, a jelentés listázza", async () => {
    const { store, report } = await plan(["/sct/0/", "/spl/999999/Valami"]);
    assert.deepEqual(sorok(store), []);
    assert.deepEqual(report.unknownId, ["/sct/0", "/spl/999999/Valami"]);
  });

  it("névszlugos út: a szegmensek a szülőláncot adják; a gyökér elmaradhat", async () => {
    const { store } = await plan([
      "/eledelek",
      "/eledelek/koralltapok/aquaforest",
      "/Triton",
      "/szurok/aquaforest",
    ]);
    // a rögzített sorrend a nyers útra rendez (a nagybetű előbb áll)
    assert.deepEqual(sorok(store), [
      "/Triton -> /hu/categories/triton",
      "/eledelek -> /hu/categories/eledelek",
      "/eledelek/koralltapok/aquaforest -> /hu/categories/aquaforest-koralltapok",
      "/szurok/aquaforest -> /hu/categories/aquaforest-szurok",
    ]);
  });

  it("kétértelmű névszlug (/aquaforest sok szülő alatt): nem ír, a jelölteket listázza", async () => {
    const { store, report } = await plan(["/aquaforest"]);
    assert.deepEqual(sorok(store), []);
    assert.deepEqual(report.ambiguous, [
      {
        source: "/aquaforest",
        candidates: ["aquaforest-koralltapok", "aquaforest-szurok"],
      },
    ]);
  });

  it("nem kategória-szerű út (termék, blog, statikus lap, gyökér): kimarad, nem ír", async () => {
    const { store, report } = await plan([
      "/",
      "/shop_contact.php",
      "/spg/821031/Blog",
      "/spd/019962474538/valami",
      "/Valami-termek-neve",
      "/eledelek/nincs-ilyen",
    ]);
    assert.deepEqual(sorok(store), []);
    assert.equal(report.created, 0);
    assert.equal(report.skipped, 5); // a gyökér a listából kiesik, nem "kihagyott"
  });

  it("idempotens: a második futás nem ír újra; egy más célú meglévő szabály a jelentésbe kerül", async () => {
    const első = await plan(["/sct/111/Eledelek"]);
    const létrejött = első.store.created();
    const meglévő = létrejött.map((r, i) => ({
      id: `r${i}`,
      sourcePath: r.sourcePath,
      destinationPath: r.destinationPath,
      isActive: true,
    }));
    const második = await plan(["/sct/111/Eledelek"], meglévő);
    assert.equal(második.report.created, 0);
    assert.equal(második.report.unchanged, 1);
    const eltérő = await plan(
      ["/sct/111/Eledelek"],
      [
        {
          id: "x",
          sourcePath: "/sct/111/Eledelek",
          destinationPath: "/hu/termek/mas",
          isActive: true,
        },
      ],
    );
    assert.equal(eltérő.report.conflicts.length, 1);
    assert.equal(eltérő.store.created().length, 0);
  });

  it("két kategória ugyanazt a handle-t kapná: egyik sem íródik", async () => {
    const dupla: CategoryForRedirect[] = [
      ...fa,
      // az ékezet és a kötőjel után ugyanaz a handle ("triton"), két gyökér alatt, mégis egyedi név
      { id: "k-x", unasId: "666", name: "TRITON", parentId: "k-szur" },
    ];
    const { store, report } = await planCategoryRedirectBackfill(
      ["/sct/555/Triton", "/sct/666/TRITON"],
      dupla,
      [],
    );
    assert.deepEqual(sorok(store), []);
    assert.ok(
      report.handleCollisions.length >= 1 || report.refused.length >= 1,
    );
  });

  it("a legacy cím a mai teszt-Medusa alakja: /hu/categories/eledelek-termekek", async () => {
    const { store } = await plan(["/sct/111/Eledelek"], [], "legacy");
    assert.deepEqual(sorok(store), [
      "/sct/111/Eledelek -> /hu/categories/eledelek-termekek",
    ]);
  });
});

describe("a parancs", () => {
  const out = () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
      stdout: (v: string) => stdout.push(v),
      stderr: (v: string) => stderr.push(v),
      text: () => stdout.join(""),
      err: () => stderr.join(""),
    };
  };
  const db = (writes: string[]) =>
    ({
      category: {
        findMany: async () =>
          fa.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId })),
      },
      externalReference: {
        findMany: async () =>
          fa
            .filter((c) => c.unasId)
            .map((c) => ({ entityId: c.id, externalId: c.unasId! })),
      },
      urlRedirect: {
        findMany: async () => [],
        createMany: async () => writes.push("createMany"),
        update: async () => writes.push("update"),
      },
      $transaction: async (ops: unknown[]) => {
        await Promise.all(ops);
        writes.push("transaction");
      },
    }) as unknown as Parameters<typeof main>[2];

  it("szárazfutás alapból: kiírja a jelentést, és nem ír", async () => {
    const o = out();
    const writes: string[] = [];
    const code = await main(
      ["--paths", "x.txt"],
      o,
      db(writes),
      async () => "/sct/111/Eledelek\n# megjegyzes\n\n",
    );
    assert.equal(code, 0);
    assert.deepEqual(writes, []);
    assert.match(o.text(), /Uj szabaly: 1/);
    // minden új szabály soronként is kiírva (a szárazfutás után végigolvasható)
    assert.match(
      o.text(),
      /  uj: \/sct\/111\/Eledelek -> \/hu\/categories\/eledelek\n/,
    );
    assert.match(o.text(), /SZARAZFUTAS: semmi nem irodott/);
  });

  it("--apply egy tranzakcióban ír; útlista nélkül hibával áll meg", async () => {
    const o = out();
    const writes: string[] = [];
    assert.equal(
      await main(
        ["--paths", "x.txt", "--apply"],
        o,
        db(writes),
        async () => "/sct/111/Eledelek\n",
      ),
      0,
    );
    assert.deepEqual(
      writes.filter((w) => w === "transaction"),
      ["transaction"],
    );
    assert.match(o.text(), /ALKALMAZVA: 1 uj szabaly/);
    const o2 = out();
    assert.equal(await main([], o2, db([])), 1);
    assert.match(o2.err(), /--paths/);
    assert.equal(
      await main(
        ["--paths", "x", "--form", "rossz"],
        out(),
        db([]),
        async () => "",
      ),
      1,
    );
  });
});

/**
 * A `medusa` KÉPLET: a cél a kirakat TÉNYLEGES handle-je, név és szülő-útvonal szerint párosítva (acrobot
 * 2026-10-30: a szárazfutás 176 céljából 173 404 volt, mert a számolt handle ékezet nélküli és egy
 * kötőjeles, a teszt Medusa mai handle-jei viszont `eledelek---termékek` alakúak). MI PIROSIT: a cél a
 * számolt alak; egy kétszer előforduló név rossz szülő alá köt; egy " - "-t tartalmazó tiszta név
 * csonkul; a Medusában nem létező kategóriához szabály íródik.
 */
describe("the medusa form: the shop's real handle", () => {
  // a mai teszt Medusa: nyers kebabCase(cím), ékezettel és három kötőjellel
  const mai: MedusaCategoryRef[] = [
    { handle: "termékek", name: "Termékek", parent: null },
    {
      handle: "eledelek---termékek",
      name: "Eledelek - Termékek",
      parent: "termékek",
    },
    {
      handle: "koralltápok---eledelek",
      name: "Koralltápok - Eledelek",
      parent: "eledelek---termékek",
    },
    {
      handle: "aquaforest---koralltápok",
      name: "Aquaforest - Koralltápok",
      parent: "koralltápok---eledelek",
    },
    {
      handle: "szűrők---termékek",
      name: "Szűrők - Termékek",
      parent: "termékek",
    },
    {
      handle: "aquaforest---szűrők",
      name: "Aquaforest - Szűrők",
      parent: "szűrők---termékek",
    },
    {
      handle: "triton---termékek",
      name: "Triton - Termékek",
      parent: "termékek",
    },
  ];
  // az átvétel (adopt) után: tiszta nevek, a szülő csak ütközésnél a címben
  const utan: MedusaCategoryRef[] = [
    { handle: "termekek", name: "Termékek", parent: null },
    { handle: "eledelek", name: "Eledelek", parent: "termekek" },
    { handle: "koralltapok", name: "Koralltápok", parent: "eledelek" },
    {
      handle: "aquaforest-koralltapok",
      name: "Aquaforest - Koralltápok",
      parent: "koralltapok",
    },
    { handle: "szurok", name: "Szűrők", parent: "termekek" },
    {
      handle: "aquaforest-szurok",
      name: "Aquaforest - Szűrők",
      parent: "szurok",
    },
    { handle: "triton", name: "Triton", parent: "termekek" },
  ];
  const medusa = async (paths: string[], list: MedusaCategoryRef[]) =>
    planCategoryRedirectBackfill(paths, fa, [], {
      form: "medusa",
      medusa: list,
    });

  it("a mai (nyers, ékezetes, háromkötőjeles) handle a cél, nem a számolt", async () => {
    const { store, report } = await medusa(
      [
        "/sct/111/Eledelek",
        "/spl/390588/Aquaforest",
        "/spl/444/Aquaforest",
        "/Triton",
      ],
      mai,
    );
    assert.deepEqual(sorok(store), [
      "/Triton -> /hu/categories/triton---termékek",
      "/sct/111/Eledelek -> /hu/categories/eledelek---termékek",
      "/spl/390588/Aquaforest -> /hu/categories/aquaforest---koralltápok",
      "/spl/444/Aquaforest -> /hu/categories/aquaforest---szűrők",
    ]);
    assert.deepEqual(report.noMedusaCategory, []);
  });

  it("az átvétel utáni tiszta nevekkel is ugyanaz a párosítás: a kétszer előforduló név a saját szülőjéhez köt", async () => {
    const { store } = await medusa(
      ["/sct/111/Eledelek", "/spl/390588/Aquaforest", "/spl/444/Aquaforest"],
      utan,
    );
    assert.deepEqual(sorok(store), [
      "/sct/111/Eledelek -> /hu/categories/eledelek",
      "/spl/390588/Aquaforest -> /hu/categories/aquaforest-koralltapok",
      "/spl/444/Aquaforest -> /hu/categories/aquaforest-szurok",
    ]);
  });

  it("egy kötőjeles tiszta név ép marad (nem a szülő nevével végződik)", () => {
    const rks: CategoryForRedirect[] = [
      { id: "r", unasId: "1", name: "Termékek", parentId: null },
      {
        id: "c",
        unasId: "2",
        name: "RKS - Fogyáshoz igazított nyomelem rendszer",
        parentId: "r",
      },
    ];
    const h = categoryHandles(rks, "medusa", [
      { handle: "termekek", name: "Termékek", parent: null },
      {
        handle: "rks-fogyashoz",
        name: "RKS - Fogyáshoz igazított nyomelem rendszer",
        parent: "termekek",
      },
    ]);
    assert.equal(h.get("c"), "rks-fogyashoz");
  });

  it("a Medusában nem létező kategóriához NEM íródik szabály, a jelentés listázza", async () => {
    const { store, report } = await medusa(
      ["/sct/111/Eledelek", "/sct/555/Triton"],
      mai.filter((m) => m.handle !== "triton---termékek"),
    );
    assert.deepEqual(sorok(store), [
      "/sct/111/Eledelek -> /hu/categories/eledelek---termékek",
    ]);
    assert.deepEqual(report.noMedusaCategory, ["/sct/555/Triton"]);
  });

  it("a Medusa nyers válasza (id, parent_category_id) és a tömör lista ugyanazt adja", () => {
    const nyers = {
      product_categories: [
        {
          id: "pcat_1",
          handle: "termékek",
          name: "Termékek",
          parent_category_id: null,
        },
        {
          id: "pcat_2",
          handle: "eledelek---termékek",
          name: "Eledelek - Termékek",
          parent_category_id: "pcat_1",
        },
      ],
    };
    assert.deepEqual(normalizeMedusaCategories(nyers), [
      { handle: "termékek", name: "Termékek", parent: null },
      {
        handle: "eledelek---termékek",
        name: "Eledelek - Termékek",
        parent: "termékek",
      },
    ]);
    assert.deepEqual(normalizeMedusaCategories(mai), mai);
    assert.throws(() => normalizeMedusaCategories({ nincs: 1 }));
  });
});
