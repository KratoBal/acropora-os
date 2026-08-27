import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decidePublication,
  type ProductPublicationState,
} from "./medusa-publication.policy.js";

const state = (
  overrides: Partial<ProductPublicationState> = {},
): ProductPublicationState => ({
  catalogAuthority: "ACROPORA",
  isActive: true,
  webshopSellable: true,
  activeVariantCount: 1,
  ...overrides,
});

describe("a publikációs döntés", () => {
  it("aktív + webshopra jelölt ACROPORA termék: értékesíthető", () => {
    // A brief 1. falszifikálható tesztje.
    assert.deepEqual(decidePublication(state()), {
      sellable: true,
      reason: "sellable",
      status: "published",
      salesChannel: "attach",
    });
  });

  it("webshopra NEM jelölt termék: nem értékesíthető", () => {
    /**
     * A brief 2. tesztje, és ez az EGYETLEN, ami az új mezőt őrzi. Ha valaki
     * kiveszi a `webshopSellable` vizsgálatát a szabályból, minden más teszt
     * zöld marad, és ez pirosodik ki.
     */
    const decision = decidePublication(state({ webshopSellable: false }));

    assert.equal(decision.sellable, false);
    assert.equal(decision.reason, "not-webshop-sellable");
    assert.equal(decision.status, "draft");
    assert.equal(decision.salesChannel, "detach");
  });

  it("inaktív termék: nem értékesíthető, akkor sem, ha webshopra jelölt", () => {
    // A brief 3. tesztje. A jelölés ATTÓL még igaz marad, hogy a termék
    // inaktív - a kettő két külön állítás, és a sorrend dönt.
    const decision = decidePublication(
      state({ isActive: false, webshopSellable: true }),
    );

    assert.equal(decision.sellable, false);
    assert.equal(decision.reason, "product-inactive");
  });

  it("UNAS gazda: a szabály nem enged írást", () => {
    // A brief 4. tesztje. A `null` ugyanígy: fail-closed.
    for (const authority of ["UNAS", null]) {
      const decision = decidePublication(
        state({ catalogAuthority: authority }),
      );

      assert.equal(decision.sellable, false, `${authority}`);
      assert.equal(decision.reason, "not-acropora-authority", `${authority}`);
    }
  });

  it("nincs aktív változat: nem értékesíthető", () => {
    /**
     * Ma NINCS ilyen termék: Balázs mérése szerint nulla aktív termék áll
     * nulla aktív változattal. A szabály ettől még kimondja, mert a mérés a
     * MAI állapotról szól, a szabály pedig a holnapiról is.
     */
    const decision = decidePublication(state({ activeVariantCount: 0 }));

    assert.equal(decision.sellable, false);
    assert.equal(decision.reason, "no-active-variant");
  });

  it("a LEGKORÁBBI akadályt nevezi meg, nem a legutolsót", () => {
    /**
     * Ha egyszerre több feltétel sérül, az indoklás azt mondja meg, ami a
     * sorban elöl áll. Enélkül egy inaktív, nem jelölt termékről azt írnánk,
     * hogy "nincs webshopra jelölve", és valaki bejelölné - mire kiderülne,
     * hogy attól még inaktív.
     */
    const decision = decidePublication(
      state({ isActive: false, webshopSellable: false, activeVariantCount: 0 }),
    );

    assert.equal(decision.reason, "product-inactive");
  });

  it("a két kapu EGYÜTT mozog, mindig", () => {
    /**
     * A brief 6. pontja: a status és a sales channel szándékosan együtt jár.
     * Ez a teszt azt őrzi, hogy soha ne keletkezzen olyan döntés, ami
     * `published` ÉS `detach`, vagy `draft` ÉS `attach` - mert a storefront a
     * kettő metszetét nézi, és egy félig elvégzett váltás pont úgy néz ki,
     * mint egy sikeres.
     */
    const combinations: ProductPublicationState[] = [
      state(),
      state({ webshopSellable: false }),
      state({ isActive: false }),
      state({ activeVariantCount: 0 }),
      state({ catalogAuthority: "UNAS" }),
      state({ catalogAuthority: null }),
    ];

    for (const input of combinations) {
      const decision = decidePublication(input);

      assert.equal(
        decision.status === "published",
        decision.salesChannel === "attach",
        JSON.stringify(input),
      );
      assert.equal(decision.sellable, decision.status === "published");
    }
  });

  it("ugyanarra a bemenetre ugyanazt adja, akárhányszor", () => {
    // Az idempotencia ALAPJA: a döntés nem függ semmi külsőtől, tehát a
    // második vetítés ugyanazt az állapotot kéri, mint az első.
    const input = state();

    assert.deepEqual(decidePublication(input), decidePublication(input));
  });
});
