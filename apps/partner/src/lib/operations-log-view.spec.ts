import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { helyszinFa } from "./helyszin-fa.js";
import { defaultMonth, isMonth, siteOptions } from "./operations-log-view.js";

describe("az üzemeltetési napló partner-oldalának logikája", () => {
  it("a helyszín-választó a fa sorrendjében, mélység szerinti előtaggal áll, az árva sor is megjelenik", () => {
    const options = siteOptions(
      helyszinFa([
        { id: "c", parentId: "a", name: "Nagy főmedence" },
        { id: "a", parentId: null, name: "Biodóm" },
        { id: "o", parentId: "hiányzó-szülő", name: "Kiosztott gyerek" },
      ]),
    );
    assert.deepEqual(
      options.map((option) => option.label),
      ["Biodóm", "— Nagy főmedence", "Kiosztott gyerek"],
    );
    assert.deepEqual(siteOptions(helyszinFa([])), []);
  });

  it("a hónap: az aktuális az alapérték, a félkész érték érvénytelen", () => {
    assert.equal(defaultMonth(new Date(2026, 10, 20)), "2026-11");
    assert.equal(isMonth("2026-11"), true);
    for (const bad of ["", "2026-13", "2026-1", "2026", "abc"])
      assert.equal(isMonth(bad), false, bad);
  });
});
