import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  maintenanceBlock,
  type MaintenanceBlockedAction,
} from "./maintenance-guard.js";

const ACTIONS: MaintenanceBlockedAction[] = [
  "move",
  "attachWorksheet",
  "detachWorksheet",
  "setPartner",
  "hide",
  "partnerConversation",
];

/*
  A KARBANTARTÁSI LAP TILTÁSÁNAK MONDATA NEM HIBAJEGYRŐL BESZÉL (hibajegy-maradek lista, acrobot 56117; Balázs 2026-11-18: "a karbantartásnak semmi köze a hibajegyekhez"). MI PIROSÍT: ha egy
  művelet mondatában újra megjelenik a "hibajegy"; ha a javítási jegyre (REPAIR) vagy ismeretlen fajtára tiltás keletkezik; ha a mondat nem mondja ki, hogy az aláírt munkalap a kész.
*/
describe("maintenanceBlock", () => {
  it("minden tiltott művelet mondata a karbantartási lapról szól, hibajegy-szó nélkül", () => {
    for (const action of ACTIONS) {
      const sentence = maintenanceBlock("MAINTENANCE", action);
      assert.ok(sentence, `nincs mondat: ${action}`);
      assert.match(sentence, /^Karbantartási munkán nincs /);
      assert.doesNotMatch(sentence, /hibajegy/i);
      assert.match(sentence, /az aláírt munkalap a kész/);
    }
  });

  it("javítási jegyre és ismeretlen fajtára nincs tiltás", () => {
    for (const action of ACTIONS) {
      assert.equal(maintenanceBlock("REPAIR", action), null);
      assert.equal(maintenanceBlock(null, action), null);
      assert.equal(maintenanceBlock(undefined, action), null);
    }
  });
});
