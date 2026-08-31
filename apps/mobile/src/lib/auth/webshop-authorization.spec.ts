import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getServiceCapabilities,
  getWebshopCapabilities,
} from "./webshop-authorization";

describe("getWebshopCapabilities", () => {
  it("gives managers the complete webshop workspace", () => {
    const capabilities = getWebshopCapabilities("MANAGER");
    assert.equal(capabilities.workspace, true);
    assert.equal(capabilities.ordersManage, true);
    assert.equal(capabilities.purchasingManage, true);
    assert.equal(capabilities.productsManage, true);
    assert.equal(capabilities.partnersManage, true);
  });

  it("keeps warehouse users read-only for orders but lets them manage purchasing", () => {
    const capabilities = getWebshopCapabilities("WAREHOUSE");
    assert.equal(capabilities.ordersView, true);
    assert.equal(capabilities.ordersManage, false);
    assert.equal(capabilities.purchasingManage, true);
    assert.equal(capabilities.partnersManage, true);
  });

  it("does not expose the webshop workspace to the service role", () => {
    const capabilities = getWebshopCapabilities("SERVICE");
    assert.equal(capabilities.workspace, false);
    assert.equal(capabilities.ordersView, false);
  });

  /**
   * Service partners are the technician's working context, so the phone shows
   * the list. Editing stays off: the server grants SERVICE `partners.view` and
   * not `partners.manage`, and this gate has to agree with it -- the two sides
   * are kept in step by hand, and nothing else reports a disagreement.
   */
  it("lets the service role see partners without editing them", () => {
    const capabilities = getWebshopCapabilities("SERVICE");
    assert.equal(capabilities.partnersView, true);
    assert.equal(capabilities.partnersManage, false);
  });

  it("keeps viewer access read-only", () => {
    const capabilities = getWebshopCapabilities("VIEWER");
    assert.equal(capabilities.workspace, true);
    assert.equal(capabilities.ordersView, true);
    assert.equal(capabilities.ordersManage, false);
    assert.equal(capabilities.purchasingManage, false);
    assert.equal(capabilities.partnersManage, false);
  });
});

describe("getServiceCapabilities", () => {
  it("opens the field asset workspace for service users", () => {
    const capabilities = getServiceCapabilities("SERVICE");
    assert.equal(capabilities.workspace, true);
    assert.equal(capabilities.assetsView, true);
    assert.equal(capabilities.assetsManage, true);
  });

  it("keeps viewers read-only and webshop-only roles outside", () => {
    assert.equal(getServiceCapabilities("VIEWER").assetsManage, false);
    assert.equal(getServiceCapabilities("WAREHOUSE").workspace, false);
    assert.equal(getServiceCapabilities("SALES").assetsView, false);
  });

  /**
   * A MUNKALAP KULCSAI UGYANAZT A KÉT SZERVER-JOGOT TÜKRÖZIK, mint az eszközé
   * (`service.view`, `service.manage`), tehát szerepenként EGYÜTT KELL
   * MOZOGNIUK. Ha egyszer elválnak, az itt derül ki, nem a helyszínen: egy
   * csempe, amit a szerver minden hívásnál elutasít, hibaüzenet-gyár.
   */
  it("moves the worksheet keys with the asset keys, role by role", () => {
    for (const role of [
      "OWNER",
      "ADMIN",
      "MANAGER",
      "SALES",
      "WAREHOUSE",
      "SERVICE",
      "VIEWER",
    ] as const) {
      const capabilities = getServiceCapabilities(role);
      assert.equal(
        capabilities.worksheetsView,
        capabilities.assetsView,
        `${role}: a munkalap és az eszköz olvasása ugyanaz a szerver-jog.`,
      );
      assert.equal(
        capabilities.worksheetsManage,
        capabilities.assetsManage,
        `${role}: a munkalap és az eszköz írása ugyanaz a szerver-jog.`,
      );
    }
  });
});
