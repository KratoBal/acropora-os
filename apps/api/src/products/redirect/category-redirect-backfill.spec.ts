import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { categoryHandle } from "../../integrations/medusa/medusa-category-handle.js";
import {
  categoryHandles,
  describeCategoryRedirectBackfill,
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
        fallback: "no-rule",
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

/**
 * A `repoint` MÓD (kártya f6cb0a51, 2026-11-15): a kategória-átvétel (adopt) óta a teszt Medusa kategóriái a RÖVID handle-t
 * viszik, a korábban írt kategória-szabályok célja viszont a régi `név---szülő` alak, és a 301 egy 404-re visz (mérve:
 * 239 mintacímből 77). A betöltő `keep` módban ír, tehát az eltérő célú meglévő szabályt csak jelentette. MI PIROSIT:
 * a `repoint` nélkül ír a meglévő szabályra; a `repoint` mellett nem írja át a saját eredetű szabályt; kézi vagy
 * eredet nélküli (nem betöltött) szabályhoz nyúl; az átírás nem szerepel a jelentésben.
 */
describe("repoint: a meglévő UNAS_CATEGORY szabály célja a mai handle-re íródik", () => {
  const regi = (reason: "UNAS_CATEGORY" | "MANUAL" | undefined) => [
    {
      id: "r1",
      sourcePath: "/sct/111/Eledelek",
      destinationPath: "/hu/categories/eledelek-termekek",
      isActive: true,
      ...(reason ? { reason } : {}),
    },
  ];
  const futtat = (
    existing: Parameters<typeof planCategoryRedirectBackfill>[2],
    repoint?: boolean,
  ) =>
    planCategoryRedirectBackfill(["/sct/111/Eledelek"], fa, existing, {
      form: "current",
      repoint,
    });

  it("alapból (repoint nélkül) nem ír át: eltérő célú meglévő szabály, jelentés, nincs módosítás", async () => {
    const { store, report } = await futtat(regi("UNAS_CATEGORY"));
    assert.equal(report.conflicts.length, 1);
    assert.equal(report.rewritten.length, 0);
    assert.equal(store.updated().length, 0);
  });

  it("repoint mellett a saját eredetű szabály célja a mai handle, és a jelentésben áll", async () => {
    const { store, report } = await futtat(regi("UNAS_CATEGORY"), true);
    assert.equal(report.conflicts.length, 0);
    assert.deepEqual(report.rewritten, [
      {
        source: "/sct/111/Eledelek",
        from: "/hu/categories/eledelek-termekek",
        to: "/hu/categories/eledelek",
      },
    ]);
    const modositas = store.updated();
    assert.equal(modositas.length, 1);
    assert.equal(modositas[0]!.id, "r1");
    assert.equal(modositas[0]!.data.destinationPath, "/hu/categories/eledelek");
    assert.equal(store.created().length, 0);
  });

  it("kézi szabályhoz és eredet nélküli (nem betöltött) szabályhoz sem nyúl: konfliktus marad", async () => {
    for (const reason of ["MANUAL", undefined] as const) {
      const { store, report } = await futtat(regi(reason), true);
      assert.equal(report.conflicts.length, 1, String(reason));
      assert.equal(report.rewritten.length, 0, String(reason));
      assert.equal(store.updated().length, 0, String(reason));
    }
  });

  it("a már mai célú szabály változatlan, a jelentés szövege kiírja az átírást", async () => {
    const mar = [
      {
        ...regi("UNAS_CATEGORY")[0]!,
        destinationPath: "/hu/categories/eledelek",
      },
    ];
    const egyezik = await futtat(mar, true);
    assert.equal(egyezik.report.unchanged, 1);
    assert.equal(egyezik.report.rewritten.length, 0);

    const { report } = await futtat(regi("UNAS_CATEGORY"), true);
    const szoveg = describeCategoryRedirectBackfill(report, "current");
    assert.match(szoveg, /atirt cel \(repoint, sajat eredetu szabaly\): 1/);
    assert.match(
      szoveg,
      /atirva: \/sct\/111\/Eledelek: \/hu\/categories\/eledelek-termekek -> \/hu\/categories\/eledelek/,
    );
  });
});

/*
  A REGI KEZELO TARTALEKA (card f6cb0a51, a #2591 szarazfutasa utan). A tervezo a regi UNAS utat a kategoria NEVEBOL kepzett
  szluggal keresi. Ez a kirakat mintaban 18 kategoria-celu utat nem talalt meg (marka-alutak: /aramoltatok/aquamedic, atnevezett nev:
  aqualight kontra AquaLight) es 3 utat kettenek talalt (/ragasztok). MI PIROSIT: ha egy ilyen ut tovabbra is kimarad; ha a
  tartalek kitalal egy kategoriat (nem pontosan egyet jelolo regi kezelo, kezi vagy eredet nelkuli szabaly); ha a nev ELSOBBSEGE
  megszunik (egy nev szerint egyertelmu utat a szabaly celja ne irjon felul).
*/
describe("a meglévő szabály régi kezelője dönt, ha a név nem", () => {
  const fa2: CategoryForRedirect[] = [
    { id: "k-root", unasId: "1", name: "Termékek", parentId: null },
    { id: "k-aram", unasId: "2", name: "Áramoltatók", parentId: "k-root" },
    { id: "k-aql", unasId: "3", name: "AquaLight", parentId: "k-aram" },
    {
      id: "k-epit",
      unasId: "4",
      name: "Akvárium-építési eszközök",
      parentId: "k-root",
    },
    {
      id: "k-karb",
      unasId: "5",
      name: "Akvárium-karbantartás eszközök",
      parentId: "k-root",
    },
    { id: "k-rag1", unasId: "6", name: "Ragasztók", parentId: "k-epit" },
    { id: "k-rag2", unasId: "7", name: "Ragasztók", parentId: "k-karb" },
  ];
  const szabaly = (
    sourcePath: string,
    destinationPath: string,
    reason: "UNAS_CATEGORY" | "MANUAL" = "UNAS_CATEGORY",
  ) => ({
    id: `r-${sourcePath}`,
    sourcePath,
    destinationPath,
    isActive: true,
    reason,
  });
  const futtat = (
    paths: string[],
    existing: Parameters<typeof planCategoryRedirectBackfill>[2],
  ) =>
    planCategoryRedirectBackfill(paths, fa2, existing, {
      form: "current",
      repoint: true,
    });
  const handleOf = (id: string) => categoryHandles(fa2, "current").get(id);

  it("az átnevezett név (aqualight kontra AquaLight) a szabály régi kezelőjéből a kategóriára köt, és átíródik", async () => {
    const { report } = await futtat(
      ["/aramoltatok/aqualight"],
      [
        szabaly(
          "/aramoltatok/aqualight",
          "/hu/categories/aqua-light---áramoltatók",
        ),
      ],
    );
    assert.equal(report.skipped, 0);
    assert.deepEqual(report.rewritten, [
      {
        source: "/aramoltatok/aqualight",
        from: "/hu/categories/aqua-light---áramoltatók",
        to: `/hu/categories/${handleOf("k-aql")}`,
      },
    ]);
  });

  it("a kétértelmű nevet (két Ragasztók) a régi kezelő szűkíti egyre; régi kezelő nélkül kétértelmű marad", async () => {
    const dont = await futtat(
      ["/ragasztok"],
      [
        szabaly(
          "/ragasztok",
          "/hu/categories/ragasztók---akvárium-építési-eszközök",
        ),
      ],
    );
    assert.equal(dont.report.ambiguous.length, 0);
    assert.equal(
      dont.report.rewritten[0]?.to,
      `/hu/categories/${handleOf("k-rag1")}`,
    );

    const nincs = await futtat(["/ragasztok"], []);
    assert.equal(nincs.report.ambiguous.length, 1);
    assert.equal(nincs.report.rewritten.length, 0);
  });

  it("nem találgat: kézi szabály, ismeretlen régi kezelő és két kategóriát jelölő kezelő mellett az ut kimarad", async () => {
    const kezi = await futtat(
      ["/aramoltatok/aqualight"],
      [
        szabaly(
          "/aramoltatok/aqualight",
          "/hu/categories/aqua-light---áramoltatók",
          "MANUAL",
        ),
      ],
    );
    assert.equal(kezi.report.skipped, 1);
    assert.equal(kezi.report.rewritten.length, 0);

    const ismeretlen = await futtat(
      ["/aramoltatok/aqualight"],
      [szabaly("/aramoltatok/aqualight", "/hu/categories/nincs-ilyen---semmi")],
    );
    assert.equal(ismeretlen.report.skipped, 1);
    assert.equal(ismeretlen.report.rewritten.length, 0);
  });

  it("a név elsőbbséget élvez: egy név szerint egyértelmű utat a szabály célja nem írhat át másik kategóriára", async () => {
    // /aramoltatok név szerint egy kategória (Áramoltatók); a szabály célja a RAGASZTÓK régi kezelője: a név dönt
    const { report } = await futtat(
      ["/aramoltatok"],
      [
        szabaly(
          "/aramoltatok",
          "/hu/categories/ragasztók---akvárium-építési-eszközök",
        ),
      ],
    );
    assert.equal(
      report.rewritten[0]?.to,
      `/hu/categories/${handleOf("k-aram")}`,
    );
  });
});

/*
  A KIHAGYOTT UTAK SORONKENTI OKA (card f6cb0a51, a #2595 masodik szarazfutasa utan: a tartalek nem oldott fel semmit, es a riport csak
  egy szamot adott a 53 kihagyott utrol). MI PIROSIT: ha a riportbol hianyzik az ok (nev, spg/spd lap, statikus lap), a meglevo
  szabaly (cel, eredet, aktiv-e), vagy a tartalek itelete (nincs szabaly, inaktiv, mas eredet, nem kategoria-cel, nincs talalat);
  ha a kihagyott ut kulonbozo okai ugyanazt az itelet kapnak; ha a szoveges riport nem listazza a sorokat.
*/
describe("a kihagyott utak soronkénti oka", () => {
  const fa3: CategoryForRedirect[] = [
    { id: "k-root", unasId: "1", name: "Termékek", parentId: null },
    { id: "k-aram", unasId: "2", name: "Áramoltatók", parentId: "k-root" },
  ];
  const szabaly = (
    sourcePath: string,
    destinationPath: string,
    over: { reason?: "UNAS_CATEGORY" | "MANUAL"; isActive?: boolean } = {},
  ) => ({
    id: `r-${sourcePath}`,
    sourcePath,
    destinationPath,
    isActive: over.isActive ?? true,
    reason: over.reason ?? ("UNAS_CATEGORY" as const),
  });
  const futtat = (
    paths: string[],
    existing: Parameters<typeof planCategoryRedirectBackfill>[2],
  ) =>
    planCategoryRedirectBackfill(paths, fa3, existing, {
      form: "current",
      repoint: true,
    });
  const detail = async (
    source: string,
    existing: Parameters<typeof planCategoryRedirectBackfill>[2],
  ) => {
    const { report } = await futtat([source], existing);
    assert.equal(report.skipped, 1, source);
    assert.equal(report.skippedDetails.length, 1, source);
    return report.skippedDetails[0]!;
  };

  it("az ok: spg/spd lap, statikus lap, és a név, amely nem talált kategóriát", async () => {
    assert.equal((await detail("/spg/1/blog", [])).why, "spg-spd-page");
    assert.equal((await detail("/shop_help.php", [])).why, "static-page");
    assert.equal((await detail("/ismeretlen-marka", [])).why, "no-name-match");
  });

  it("a tartalékot csak a névvel nem talált út kérdezi: spg/spd és statikus lapnál nem megkérdezett", async () => {
    // a szabály létezik és érvényes, mégsem kérdezzük: az út a névtől függetlenül kimaradt
    const rule = szabaly("/spg/1/blog", "/hu/categories/valami---szulo");
    const spg = await detail("/spg/1/blog", [rule]);
    assert.equal(spg.fallback, "not-consulted");
    assert.equal(spg.rule?.destination, "/hu/categories/valami---szulo");
    const php = await detail("/shop_help.php", []);
    assert.equal(php.fallback, "not-consulted");
  });

  it("szabály nélkül: nincs szabály, és a tartalék ezt mondja", async () => {
    const d = await detail("/ismeretlen-marka", []);
    assert.equal(d.rule, undefined);
    assert.equal(d.fallback, "no-rule");
  });

  it("a tartalék ítélete: inaktív, más eredet, nem kategória-cél, nincs találat", async () => {
    const dest = "/hu/categories/nincs-ilyen---semmi";
    const cases: [string, ReturnType<typeof szabaly>, string][] = [
      ["/a", szabaly("/a", dest, { isActive: false }), "rule-inactive"],
      ["/b", szabaly("/b", dest, { reason: "MANUAL" }), "rule-reason-MANUAL"],
      [
        "/c",
        szabaly("/c", "/hu/kategoria/valami"),
        "destination-not-category-path",
      ],
      ["/d", szabaly("/d", dest), "legacy-no-match"],
    ];
    for (const [source, rule, verdict] of cases) {
      const d = await detail(source, [rule]);
      assert.equal(d.fallback, verdict, source);
      assert.deepEqual(d.rule, {
        destination: rule.destinationPath,
        reason: rule.reason,
        isActive: rule.isActive,
      });
    }
  });

  it("a kétértelmű úton is áll az ítélet, és a szöveges riport soronként listázza a kihagyottat", async () => {
    const fa4: CategoryForRedirect[] = [
      { id: "k-root", unasId: "1", name: "Termékek", parentId: null },
      { id: "k-a", unasId: "2", name: "A", parentId: "k-root" },
      { id: "k-b", unasId: "3", name: "B", parentId: "k-root" },
      { id: "k-r1", unasId: "4", name: "Ragasztók", parentId: "k-a" },
      { id: "k-r2", unasId: "5", name: "Ragasztók", parentId: "k-b" },
    ];
    const { report } = await planCategoryRedirectBackfill(
      ["/ragasztok", "/ismeretlen-marka"],
      fa4,
      [],
      { form: "current", repoint: true },
    );
    assert.equal(report.ambiguous.length, 1);
    assert.equal(report.ambiguous[0]!.fallback, "no-rule");
    const szoveg = describeCategoryRedirectBackfill(report, "current");
    assert.match(
      szoveg,
      /kihagyva: \/ismeretlen-marka \[no-name-match\] szabaly: nincs; tartalek: no-rule/,
    );
    assert.match(szoveg, /ketertelmu: \/ragasztok .*\(tartalek: no-rule\)/);
  });
});
