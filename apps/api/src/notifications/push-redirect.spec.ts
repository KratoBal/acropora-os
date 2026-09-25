import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pushRedirect } from "./push-redirect.js";

describe("pushRedirect", () => {
  it('hiányzó vagy üres érték mellett "off", a MAI viselkedés', () => {
    for (const nyers of [undefined, null, "", "   "]) {
      assert.deepEqual(pushRedirect(nyers), { kind: "off" });
    }
  });

  it("egy felhasználó-azonosító mellett arra az egyre irányít", () => {
    assert.deepEqual(pushRedirect("user-42"), {
      kind: "on",
      userIds: ["user-42"],
    });
  });

  it("több azonosítót vesszővel tagolva, a szóközök levágva", () => {
    assert.deepEqual(pushRedirect(" user-1, user-2 ,user-3"), {
      kind: "on",
      userIds: ["user-1", "user-2", "user-3"],
    });
  });

  it('csupa vesszőből és szóközből álló érték "off"-ot ad', () => {
    assert.deepEqual(pushRedirect(" , , "), { kind: "off" });
  });
});
