// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { SetVariantSaleDto } from "./dto/set-variant-sale.dto.js";

/**
 * A SAJÁT AKCIÓ TÖRZSE (T4.1-D3). MI PIROSÍT: ha a tizedes vagy nulla ár, a
 * hiányzó vég, vagy az időzóna nélküli időpont átmegy (az utóbbit a szerver a
 * saját zónájában értené, és egy órát csúszna); ha egy rendes törzs elakad.
 */
const ok = {
  grossPrice: "7990",
  startsAt: "2026-11-10T00:00:00+01:00",
  endsAt: "2026-11-17T00:00:00Z",
};
const hibas = (body: object) =>
  validateSync(plainToInstance(SetVariantSaleDto, body)).length > 0;

describe("SetVariantSaleDto", () => {
  it("egész forintot és két időzónás időpontot fogad", () => {
    assert.equal(hibas(ok), false);
    assert.equal(hibas({ ...ok, startsAt: "2026-11-10T00:00:00.000Z" }), false);
  });

  it("a rossz árat, a hiányzó véget és a zóna nélküli időpontot elutasítja", () => {
    for (const rossz of [
      { ...ok, grossPrice: "7990.5" },
      { ...ok, grossPrice: "0" },
      { grossPrice: ok.grossPrice, startsAt: ok.startsAt },
      { ...ok, startsAt: "2026-11-10T00:00:00" },
      { ...ok, endsAt: "2026-11-17" },
      { ...ok, endsAt: "jövő hét" },
    ])
      assert.equal(hibas(rossz), true, JSON.stringify(rossz));
  });
});
