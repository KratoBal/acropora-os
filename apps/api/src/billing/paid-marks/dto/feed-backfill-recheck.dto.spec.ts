import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { FeedBackfillRecheckDto } from "./feed-backfill-recheck.dto.js";

/*
  A VISSZAVONÁS SOROZAT-NEVE (acrobot 58207): egy tábla-sor törlését vezérli, ezért a név alakja kötött. MI PIROSÍT: ha szabad szöveg,
  SQL-részlet, útvonal vagy túl hosszú név átmegy; ha a két valódi alak (`ACRW-2026`, `2026`) elutasul; ha hiányzó vagy nem szöveges
  érték átmegy.
*/
const errorsOf = async (series: unknown) =>
  (await validate(plainToInstance(FeedBackfillRecheckDto, { series }))).length;

describe("FeedBackfillRecheckDto", () => {
  it("takes the two real series shapes", async () => {
    assert.equal(await errorsOf("ACRW-2026"), 0);
    assert.equal(await errorsOf("2026"), 0);
  });

  it("refuses everything that is not a series name", async () => {
    for (const bad of [
      "",
      "ACRW-2026/00004",
      "2026; DROP TABLE x",
      "ACRW 2026",
      "../2026",
      "ACRW-26",
      "A".repeat(41) + "-2026",
      "ACRW-2026\n",
      undefined,
      2026,
      null,
    ])
      assert.ok((await errorsOf(bad)) > 0, `accepted: ${String(bad)}`);
  });
});
