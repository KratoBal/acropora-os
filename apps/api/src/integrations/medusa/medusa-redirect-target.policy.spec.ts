import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OsBrandForShop } from "./medusa-brand-module.policy.js";
import {
  productRedirectTarget,
  shopRedirects,
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
