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
    assert.equal(capabilities.navManage, true);
    assert.equal(capabilities.partnersManage, true);
  });

  it("keeps warehouse users read-only for orders but lets them manage purchasing and NAV", () => {
    const capabilities = getWebshopCapabilities("WAREHOUSE");
    assert.equal(capabilities.ordersView, true);
    assert.equal(capabilities.ordersManage, false);
    assert.equal(capabilities.purchasingManage, true);
    assert.equal(capabilities.navManage, true);
    assert.equal(capabilities.partnersManage, true);
  });

  it("does not expose the webshop workspace to the service role", () => {
    const capabilities = getWebshopCapabilities("SERVICE");
    assert.equal(capabilities.workspace, false);
    assert.equal(capabilities.ordersView, false);
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
});
