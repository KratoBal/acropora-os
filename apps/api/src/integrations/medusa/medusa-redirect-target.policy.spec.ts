import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OsBrandForShop } from "./medusa-brand-module.policy.js";
import {
  discontinuedRedirect,
  productRedirectTarget,
  shopRedirects,
  type DiscontinuedRedirect,
  type DiscontinuedRedirectInput,
  type RedirectProductState,
  type StoredRedirectRule,
} from "./medusa-redirect-target.policy.js";

/**
 * HOVA MEGY EGY RÉGI TERMÉKCÍM (d707cf5f, A9). MI PIROSIT: egy lap nélküli
 * termékre a termékoldal marad a cél (a mért 129 404); a kifutott termék
 * ("nem kapható" lap) elveszti a szabályát; vetítés nélküli termék lapot kap; a
 * kikapcsolt márka lapja cél lesz; a kézi vagy nem termék-szabály átíródik; a 410-es
 * sor célja nem a forrás.
 */
const marka = (o: Partial<OsBrandForShop> = {}): OsBrandForShop => ({
  id: "b1",
  name: "Jebao",
  slug: "jebao",
  description: null,
  intro: null,
  seoTitle: null,
  metaDescription: null,
  logoUrl: null,
  websiteUrl: null,
  isActive: true,
  archivedAt: null,
  ...o,
});

const termek = (
  o: Partial<RedirectProductState> = {},
  pub: Partial<RedirectProductState["publication"]> = {},
): RedirectProductState => ({
  linked: true,
  publication: {
    catalogAuthority: "UNAS",
    isActive: true,
    webshopSellable: true,
    activeVariantCount: 1,
    ...pub,
  },
  unasProductUrl: "https://www.acropora.hu/Jebao-SLW-30",
  brand: marka(),
  ...o,
});

describe("productRedirectTarget", () => {
  it("értékesíthető, vetített termék: a saját lapja", () => {
    assert.equal(productRedirectTarget(termek()), "page");
  });

  it("kifutott termék (volt UNAS-lapja): a nem kapható lap, a szabály marad", () => {
    assert.equal(
      productRedirectTarget(termek({}, { webshopSellable: false })),
      "page",
    );
    assert.equal(
      productRedirectTarget(termek({}, { isActive: false })),
      "page",
    );
  });

  it("nem értékesíthető, UNAS-lap nélkül: nincs lapja, a márkalap", () => {
    assert.equal(
      productRedirectTarget(
        termek({ unasProductUrl: null }, { webshopSellable: false }),
      ),
      "brand",
    );
  });

  it("nincs aktív változata: nincs lapja (nem kifutás)", () => {
    assert.equal(
      productRedirectTarget(termek({}, { activeVariantCount: 0 })),
      "brand",
    );
  });

  it("nincs Medusa-kötése: nincs lapja, akkor sem, ha értékesíthető", () => {
    assert.equal(productRedirectTarget(termek({ linked: false })), "brand");
  });

  it("lap nélkül, kikapcsolt, archivált vagy hiányzó márkával: 410", () => {
    const nincsLap = { linked: false };
    assert.equal(
      productRedirectTarget(
        termek({ ...nincsLap, brand: marka({ isActive: false }) }),
      ),
      "gone",
    );
    assert.equal(
      productRedirectTarget(
        termek({ ...nincsLap, brand: marka({ archivedAt: new Date() }) }),
      ),
      "gone",
    );
    assert.equal(
      productRedirectTarget(termek({ ...nincsLap, brand: null })),
      "gone",
    );
  });

  it("törölt termék (nincs állapota): 410", () => {
    assert.equal(productRedirectTarget(undefined), "gone");
  });
});

describe("shopRedirects", () => {
  const szabaly = (
    o: Partial<StoredRedirectRule> = {},
  ): StoredRedirectRule => ({
    sourcePath: "/Jebao-SLW-30",
    destinationPath: "/hu/termek/jebao-slw-30",
    httpStatus: 301,
    reason: "UNAS_PRODUCT",
    entityType: "PRODUCT",
    entityId: "p1",
    ...o,
  });

  it("a döntés szerinti sor és cél", () => {
    const termekek = new Map([
      ["p1", termek()],
      ["p2", termek({ linked: false })],
      ["p3", termek({ linked: false, brand: null })],
    ]);
    assert.deepEqual(
      shopRedirects(
        [
          szabaly(),
          szabaly({ sourcePath: "/SLW-20", entityId: "p2" }),
          szabaly({ sourcePath: "/SLW-10", entityId: "p3" }),
        ],
        termekek,
      ),
      [
        {
          sourcePath: "/Jebao-SLW-30",
          destinationPath: "/hu/termek/jebao-slw-30",
          httpStatus: 301,
          target: "page",
        },
        {
          sourcePath: "/SLW-20",
          destinationPath: "/hu/marka/jebao",
          httpStatus: 301,
          target: "brand",
        },
        {
          sourcePath: "/SLW-10",
          destinationPath: "/SLW-10",
          httpStatus: 410,
          target: "gone",
        },
      ],
    );
  });

  it("a slug-csere termék-szabálya ugyanígy", () => {
    const [sor] = shopRedirects(
      [szabaly({ sourcePath: "/hu/termek/regi", reason: "SLUG_CHANGE" })],
      new Map(),
    );
    assert.equal(sor?.httpStatus, 410);
  });

  it("kézi, nem termék és nem termékoldalra mutató szabály: változatlan, döntés nélkül", () => {
    const ures = new Map<string, RedirectProductState>();
    for (const s of [
      szabaly({ reason: "MANUAL" }),
      szabaly({ entityType: "BRAND", destinationPath: "/hu/marka/x" }),
      szabaly({ entityType: null, entityId: null }),
      szabaly({ destinationPath: "/hu/kategoria/pumpak" }),
    ])
      assert.deepEqual(shopRedirects([s], ures), [
        {
          sourcePath: s.sourcePath,
          destinationPath: s.destinationPath,
          httpStatus: 301,
        },
      ]);
  });
});

/**
 * A VÉGLEGESEN MEGSZŰNTNEK JELÖLT TERMÉK (V4.2, kártya 9d0523fa). MI PIROSIT: a jelölt, ma nem kapható termék
 * régi címe és saját lapja nem 301-et kap a helyettesítőre vagy a kategóriára; egy megvehető termék lapját a jelölő
 * elviszi; egy nem megvehető, megszűnt-jelölt vagy kötés nélküli helyettesítő a célja marad (zsákutca, lánc); a
 * kategória helyett a helyettesítő nem előz; cél nélkül a jelölő változtat valamit; egy régi cím vagy kézi sor a
 * termék lapjára mutat marad (lánc, a bolt az egész listát elutasítja).
 */
describe("a véglegesen megszűnt termék átirányítása", () => {
  const REPL = "/hu/termek/uj-szivattyu";
  const KAT = "/hu/categories/szivattyuk";
  const OWN = "/hu/termek/jebao-slw-30";

  const jelolt = (
    o: Partial<DiscontinuedRedirectInput> = {},
  ): DiscontinuedRedirect =>
    discontinuedRedirect({
      pagePath: OWN,
      replacement: {
        pagePath: REPL,
        linked: true,
        publication: termek().publication,
        marked: false,
      },
      categoryPath: KAT,
      ...o,
    });

  describe("discontinuedRedirect: a cél", () => {
    it("a megvehető helyettesítő lapja előz a kategóriával szemben", () => {
      assert.deepEqual(jelolt(), { pagePath: OWN, destination: REPL });
    });

    it("nincs helyettesítő: a kategória", () => {
      assert.equal(jelolt({ replacement: null }).destination, KAT);
    });

    it("a helyettesítő ma nem megvehető (inaktív, nem webshopos, kötés nélküli, jelölt, slug nélküli): a kategória", () => {
      const alap = {
        pagePath: REPL,
        linked: true,
        publication: termek().publication,
        marked: false,
      };
      for (const replacement of [
        {
          ...alap,
          publication: { ...alap.publication, isActive: false },
        },
        {
          ...alap,
          publication: { ...alap.publication, webshopSellable: false },
        },
        { ...alap, linked: false },
        { ...alap, marked: true },
        { ...alap, pagePath: null },
      ])
        assert.equal(jelolt({ replacement }).destination, KAT);
    });

    it("sem helyettesítő, sem kategória: nincs cél", () => {
      assert.equal(
        jelolt({ replacement: null, categoryPath: null }).destination,
        null,
      );
    });
  });

  describe("productRedirectTarget", () => {
    const moved = (o: Partial<DiscontinuedRedirect> = {}) => ({
      pagePath: OWN,
      destination: REPL,
      ...o,
    });

    it("jelölt, ma nem kapható, van cél: moved (kifutott termék is, kötés nélküli is)", () => {
      for (const product of [
        termek({ discontinued: moved() }, { webshopSellable: false }),
        termek(
          { discontinued: moved(), linked: false },
          { webshopSellable: false },
        ),
        termek(
          { discontinued: moved(), unasProductUrl: null },
          { isActive: false },
        ),
      ])
        assert.equal(productRedirectTarget(product), "moved");
    });

    it("jelölt, de MÉG értékesíthető: a saját lapja marad", () => {
      assert.equal(
        productRedirectTarget(termek({ discontinued: moved() })),
        "page",
      );
    });

    it("jelölt, de cél nélkül: a jelölő semmit nem változtat", () => {
      const nemKapható = { webshopSellable: false };
      assert.equal(
        productRedirectTarget(
          termek({ discontinued: moved({ destination: null }) }, nemKapható),
        ),
        productRedirectTarget(termek({}, nemKapható)),
      );
    });
  });

  describe("shopRedirects: a sorok és a lánc", () => {
    const szabaly = (
      o: Partial<StoredRedirectRule> = {},
    ): StoredRedirectRule => ({
      sourcePath: "/Jebao-SLW-30",
      destinationPath: OWN,
      httpStatus: 301,
      reason: "UNAS_PRODUCT",
      entityType: "PRODUCT",
      entityId: "p1",
      ...o,
    });
    const jeloltTermek = (o: Partial<RedirectProductState> = {}) =>
      termek(
        { discontinued: { pagePath: OWN, destination: REPL }, ...o },
        { webshopSellable: false },
      );

    it("a régi cím egyenesen a célra megy, és a termék saját lapja is 301-et kap", () => {
      assert.deepEqual(
        shopRedirects([szabaly()], new Map([["p1", jeloltTermek()]])),
        [
          {
            sourcePath: "/Jebao-SLW-30",
            destinationPath: REPL,
            httpStatus: 301,
            target: "moved",
          },
          {
            sourcePath: OWN,
            destinationPath: REPL,
            httpStatus: 301,
            target: "moved",
          },
        ],
      );
    });

    it("a termék saját lapja akkor is kap sort, ha nincs régi címe (nincs szabálya)", () => {
      assert.deepEqual(shopRedirects([], new Map([["p1", jeloltTermek()]])), [
        {
          sourcePath: OWN,
          destinationPath: REPL,
          httpStatus: 301,
          target: "moved",
        },
      ]);
    });

    it("kötés nélküli jelölt termék: a régi cím megy a célra, saját lap-sor nincs (nincs lapja)", () => {
      const rows = shopRedirects(
        [szabaly()],
        new Map([
          [
            "p1",
            jeloltTermek({
              linked: false,
              discontinued: { pagePath: null, destination: KAT },
            }),
          ],
        ]),
      );
      assert.deepEqual(rows, [
        {
          sourcePath: "/Jebao-SLW-30",
          destinationPath: KAT,
          httpStatus: 301,
          target: "moved",
        },
      ]);
    });

    it("a kézi és a másik termék szabálya, ami a jelölt lapjára mutat, egyenesen a célra megy (nincs lánc)", () => {
      const rows = shopRedirects(
        [
          szabaly(),
          szabaly({
            sourcePath: "/kezi-regi-cim",
            reason: "MANUAL",
            entityId: null,
            entityType: null,
          }),
          szabaly({
            sourcePath: "/masik-regi",
            entityId: "p2",
            destinationPath: OWN,
          }),
          szabaly({
            sourcePath: "/mas-lap",
            entityId: null,
            entityType: null,
            reason: "MANUAL",
            destinationPath: "/hu/termek/mas",
          }),
        ],
        new Map([
          ["p1", jeloltTermek()],
          ["p2", termek()],
        ]),
      );
      const forrasok = new Set(rows.map((r) => r.sourcePath.toLowerCase()));
      for (const row of rows)
        assert.equal(
          forrasok.has(row.destinationPath.toLowerCase()) &&
            row.httpStatus !== 410,
          false,
          `lánc: ${row.sourcePath} -> ${row.destinationPath}`,
        );
      assert.equal(
        rows.find((r) => r.sourcePath === "/kezi-regi-cim")?.destinationPath,
        REPL,
      );
      assert.equal(
        rows.find((r) => r.sourcePath === "/masik-regi")?.destinationPath,
        REPL,
      );
      assert.equal(
        rows.find((r) => r.sourcePath === "/mas-lap")?.destinationPath,
        "/hu/termek/mas",
      );
    });

    it("ha a lap címe már forrás egy meglévő sorban, az a sor átíródik az újra (egy forrás, egyszer)", () => {
      const rows = shopRedirects(
        [szabaly({ sourcePath: OWN.toUpperCase(), destinationPath: "/hu/x" })],
        new Map([["p1", jeloltTermek()]]),
      );
      assert.equal(
        rows.filter((r) => r.sourcePath.toLowerCase() === OWN).length,
        1,
      );
      assert.equal(rows[0]?.destinationPath, REPL);
    });

    it("a még értékesíthető jelölt termék lapja és régi címe változatlan marad", () => {
      assert.deepEqual(
        shopRedirects(
          [szabaly()],
          new Map([
            [
              "p1",
              termek({ discontinued: { pagePath: OWN, destination: REPL } }),
            ],
          ]),
        ),
        [
          {
            sourcePath: "/Jebao-SLW-30",
            destinationPath: OWN,
            httpStatus: 301,
            target: "page",
          },
        ],
      );
    });
  });
});
