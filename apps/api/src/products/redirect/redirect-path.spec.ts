import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeRedirectPath,
  redirectPathLower,
  webshopProductPath,
} from "./redirect-path.js";

/**
 * AZ ÚT NORMALIZÁLÁSA (SEO P0 PR 6, C5). MI PIROSIT: a percent-kód vagy az NFD
 * alak más utat ad; a záró `/` vagy a query megmarad; a nagybetű elvész a tárolt
 * alakból; a perjeles SefUrl szétesik.
 */
describe("normalizeRedirectPath", () => {
  it("teljes URL-ből az út marad, query és horgony nélkül", () => {
    assert.equal(
      normalizeRedirectPath(
        "https://shop.acropora.hu/Tropic-Marin-Pro-Reef?utm=x#leiras",
      ),
      "/Tropic-Marin-Pro-Reef",
    );
  });

  it("percent-dekódolt és NFC", () => {
    const nfd = "/sza\u0301raz";
    assert.equal(normalizeRedirectPath("/sz%C3%A1raz"), "/száraz");
    assert.equal(normalizeRedirectPath(nfd), "/száraz");
    assert.equal(normalizeRedirectPath(nfd), normalizeRedirectPath("/száraz"));
  });

  it("a záró perjel megy, a gyökér marad", () => {
    assert.equal(normalizeRedirectPath("/Pumpa/"), "/Pumpa");
    assert.equal(normalizeRedirectPath("/Pumpa///"), "/Pumpa");
    assert.equal(normalizeRedirectPath("/"), "/");
    assert.equal(normalizeRedirectPath("https://shop.acropora.hu/"), "/");
  });

  it("a nagybetű megmarad, a kisbetűs kulcs külön", () => {
    assert.equal(normalizeRedirectPath("/Nyos-Reef"), "/Nyos-Reef");
    assert.equal(redirectPathLower("/Nyos-Reef"), "/nyos-reef");
  });

  it("a perjeles SefUrl és a /spd/ cím egy út marad", () => {
    assert.equal(
      normalizeRedirectPath("https://shop.acropora.hu/Pumpa-3000-liter/ora"),
      "/Pumpa-3000-liter/ora",
    );
    assert.equal(
      normalizeRedirectPath(
        "https://shop.acropora.hu/spd/156161/Nyos-Reef-Putty-200g",
      ),
      "/spd/156161/Nyos-Reef-Putty-200g",
    );
  });

  it("vezető perjel nélküli út is út; üres és szóközös nem", () => {
    assert.equal(normalizeRedirectPath("Pumpa"), "/Pumpa");
    assert.equal(normalizeRedirectPath("  "), null);
    assert.equal(normalizeRedirectPath("/a b"), null);
    assert.equal(normalizeRedirectPath("/a%20b"), null);
  });

  it("hibás percent-kód nyersen marad", () => {
    assert.equal(normalizeRedirectPath("/100%-os"), "/100%-os");
  });

  it("a webshop-cím a G2 alakja", () => {
    assert.equal(webshopProductPath("pumpa"), "/hu/termek/pumpa");
  });
});
