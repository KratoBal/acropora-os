import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS, ROLE_PERMISSIONS, USER_ROLES } from "./auth.js";
import { PERMISSION_AREAS } from "./permission-areas.js";
import {
  SHIPPING_OVERRIDE_REASON_MAX,
  SHIPPING_OVERRIDE_REASON_MIN,
} from "./webshop-orders.js";

/*
  A KISZÁLLÍTÁSI KAPU FELÜLBÍRÁLÁSÁNAK JOGA (kártya 33a0d3c7). MI PIROSÍT: ha a MANAGER (vagy bármelyik más szerepkör) megkapja,
  mert a felülbírálás számla és csomag nélkül indít kártyás levonást; ha az OWNER vagy az ADMIN nem kapja; ha a jog kikerül a
  jogosultság-mátrix Rendelések területéről (a beállító felületen nem lenne kiosztható); ha az indok határai elmozdulnak.
*/
describe("orders.shipping-override", () => {
  it("only the owner and the admin hold it: not the manager, not any other role", () => {
    for (const role of USER_ROLES) {
      const holds = ROLE_PERMISSIONS[role].includes(
        PERMISSIONS.ORDERS_SHIPPING_OVERRIDE,
      );
      assert.equal(holds, role === "OWNER" || role === "ADMIN", role);
    }
  });

  it("it is its own permission, not part of orders.manage", () => {
    assert.equal(
      PERMISSIONS.ORDERS_SHIPPING_OVERRIDE,
      "orders.shipping-override",
    );
    assert.notEqual(
      PERMISSIONS.ORDERS_SHIPPING_OVERRIDE,
      PERMISSIONS.ORDERS_MANAGE,
    );
  });

  it("the permission matrix offers it under Rendelések, so it can be granted on the settings screen", () => {
    const orders = PERMISSION_AREAS.find((area) => area.key === "orders");
    assert.ok(
      orders?.extras.some(
        (extra) => extra.permission === PERMISSIONS.ORDERS_SHIPPING_OVERRIDE,
      ),
    );
  });

  it("the reason limits are 10 and 500 characters", () => {
    assert.equal(SHIPPING_OVERRIDE_REASON_MIN, 10);
    assert.equal(SHIPPING_OVERRIDE_REASON_MAX, 500);
  });
});
