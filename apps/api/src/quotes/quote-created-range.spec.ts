import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createdAtRange } from "./quote-created-range.js";

/**
 * A LÉTREHOZÁS NAPJA SZERINTI SZŰRŐ HATÁRAI (Luca, kártya 7e5d3658). Mi pirosít: ha nincs szűrő, mégis van tartomány; ha a vége
 * nem a megadott nap UTÁNI nap budapesti kezdete (a vég napja kimaradna vagy egy órát csúszna); ha a nyári időszámítás váltásának
 * napján elcsúszik a kezdet; ha az egyik határ hiánya a másikat is elveszi.
 */
describe("createdAtRange", () => {
  it("is null without either end", () => {
    assert.equal(createdAtRange({}), null);
  });

  it("starts at the Budapest start of the from day and ends before the day after the to day", () => {
    // 2026-11-20 is winter time (UTC+1): the day starts at 23:00 UTC the evening before
    const range = createdAtRange({
      createdFrom: "2026-11-20",
      createdTo: "2026-11-22",
    });
    assert.equal(
      range?.gte?.toString(),
      new Date("2026-11-19T23:00:00Z").toString(),
    );
    assert.equal(
      range?.lt?.toString(),
      new Date("2026-11-22T23:00:00Z").toString(),
    );
  });

  it("keeps a late-evening quote on its own day: the to day's end is the NEXT Budapest midnight", () => {
    const range = createdAtRange({ createdTo: "2026-11-20" });
    // 23:30 Budapest on 2026-11-20 is 22:30 UTC: inside; 00:10 on the 21st is 23:10 UTC: outside
    assert.ok(new Date("2026-11-20T22:30:00Z") < (range?.lt as Date));
    assert.ok(new Date("2026-11-20T23:10:00Z") >= (range?.lt as Date));
  });

  it("takes the offset at the target midnight on the day summer time begins (2026-03-29)", () => {
    const range = createdAtRange({
      createdFrom: "2026-03-29",
      createdTo: "2026-03-29",
    });
    // the day starts in winter time (23:00 UTC the evening before) and the next one in summer time (22:00 UTC)
    assert.equal(
      (range?.gte as Date).toISOString(),
      "2026-03-28T23:00:00.000Z",
    );
    assert.equal((range?.lt as Date).toISOString(), "2026-03-29T22:00:00.000Z");
  });

  it("an open end leaves the other side open", () => {
    const onlyFrom = createdAtRange({ createdFrom: "2026-11-20" });
    assert.ok(onlyFrom?.gte && !onlyFrom.lt);
    const onlyTo = createdAtRange({ createdTo: "2026-11-20" });
    assert.ok(onlyTo?.lt && !onlyTo.gte);
  });
});
