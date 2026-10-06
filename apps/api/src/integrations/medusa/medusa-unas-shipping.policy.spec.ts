import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unasShippingProfile } from "./medusa-unas-shipping.policy.js";

/*
  A KOMBINÁCIÓK A VALÓDI UNAS-TÜKÖRBŐL (mérve 2026-10-06, 1901 termék,
  unas-szallitasi-osztaly-szaraz). MI PIROSÍT: ha a „csak Foxpost” termék
  normál marad (acrobot 27094 lelete); ha a nehéz-áru mód bekapcsolása nem
  nehéz; ha a felülírás nélküli termék jelzőt kap.
*/
const payload = (denied: string[], activated: string[] = []) => ({
  ShippingMethods: {
    ...(denied.length
      ? { Denied: { Method: denied.map((Name) => ({ Name })) } }
      : {}),
    ...(activated.length
      ? { Activated: { Method: activated.map((Name) => ({ Name })) } }
      : {}),
  },
});
const HEAVY = [
  "Nehéz áru GLS csomagpontra szállítása",
  "Nehéz áru házhozszállítása GLS futárszolgálattal",
];
const ALL_NORMAL = [
  "Foxpost csomagautomaták",
  "GLS házhozszállítás",
  "Átvétel a GLS csomagponton",
];
const flags = (p: ReturnType<typeof unasShippingProfile>) =>
  p
    ? Object.entries(p)
        .filter(([, v]) => v)
        .map(([k]) => k)
    : null;

describe("unasShippingProfile", () => {
  it("no override: nothing to carry (1662 products)", () => {
    assert.equal(unasShippingProfile({}), null);
    assert.equal(unasShippingProfile(payload([])), null);
  });

  it("every delivery denied is store pickup, with or without the heavy methods (35 + 54)", () => {
    assert.deepEqual(flags(unasShippingProfile(payload(ALL_NORMAL))), [
      "pickupOnly",
    ]);
    assert.deepEqual(
      flags(unasShippingProfile(payload([...ALL_NORMAL, ...HEAVY]))),
      ["pickupOnly"],
    );
  });

  it("GLS denied, Foxpost allowed is store pickup too (114 + 2, acrobot 27094)", () => {
    assert.deepEqual(
      flags(
        unasShippingProfile(
          payload(["GLS házhozszállítás", "Átvétel a GLS csomagponton"]),
        ),
      ),
      ["pickupOnly"],
    );
    assert.deepEqual(
      flags(
        unasShippingProfile(
          payload([
            "GLS házhozszállítás",
            "Átvétel a GLS csomagponton",
            ...HEAVY,
          ]),
        ),
      ),
      ["pickupOnly"],
    );
  });

  it("a heavy method switched on is heavy (27)", () => {
    assert.deepEqual(flags(unasShippingProfile(payload(ALL_NORMAL, HEAVY))), [
      "isHeavy",
    ]);
  });

  it("Foxpost denied, some GLS left is no Foxpost (1 + 4 + 2)", () => {
    assert.deepEqual(
      flags(unasShippingProfile(payload(["Foxpost csomagautomaták"]))),
      ["foxpostForbidden"],
    );
    assert.deepEqual(
      flags(
        unasShippingProfile(
          payload(["Foxpost csomagautomaták", "Átvétel a GLS csomagponton"]),
        ),
      ),
      ["foxpostForbidden"],
    );
  });

  it("reads a single method object as well as a list (the UNAS XML-to-JSON shape)", () => {
    assert.deepEqual(
      flags(
        unasShippingProfile({
          ShippingMethods: {
            Denied: { Method: { Name: "Foxpost csomagautomaták" } },
          },
        }),
      ),
      ["foxpostForbidden"],
    );
  });
});
