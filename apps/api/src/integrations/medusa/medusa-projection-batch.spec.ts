import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeBatchSize,
  parseBatchArguments,
  selectBatchTargets,
  type BatchSelectionDatabase,
} from "./medusa-projection-batch.js";

function ok(args: string[]) {
  const result = parseBatchArguments(args);
  assert.equal(result.kind, "ok", `hibát adott: ${JSON.stringify(result)}`);
  if (result.kind !== "ok") throw new Error("unreachable");
  return result.selection;
}

function hiba(args: string[]) {
  const result = parseBatchArguments(args);
  assert.equal(result.kind, "error", "elfogadta, pedig hibás");
  if (result.kind !== "error") throw new Error("unreachable");
  return result.message;
}

describe("a vetítés kötegelése", () => {
  it("a mai alak változatlanul megy: felsorolt azonosítók", () => {
    const selection = ok(["prod_1", "sku:ABC"]);
    assert.deepEqual(selection.targets, ["prod_1", "sku:ABC"]);
    assert.equal(selection.limit, null);
  });

  it("a --forget-link megmarad a felsorolás mellett", () => {
    const selection = ok(["prod_1", "--forget-link"]);
    assert.equal(selection.forgetOnly, true);
    assert.deepEqual(selection.targets, ["prod_1"]);
  });

  it("köteget kér: limit és kezdőpont", () => {
    const selection = ok(["--limit", "20", "--from", "prod_x"]);
    assert.equal(selection.limit, 20);
    assert.equal(selection.from, "prod_x");
    assert.deepEqual(selection.targets, []);
  });

  it("a köteg ugyanazzal a stabil termék-lekérdezéssel jön minden hívónak", async () => {
    const queries: unknown[] = [];
    const database: BatchSelectionDatabase = {
      product: {
        findMany: async (query: unknown) => {
          queries.push(query);
          return [{ id: "prod_2" }, { id: "prod_3" }];
        },
      },
    };

    const targets = await selectBatchTargets(
      ok(["--limit", "2", "--from", "prod_1"]),
      database,
    );

    assert.deepEqual(targets, ["prod_2", "prod_3"]);
    assert.deepEqual(queries, [
      {
        where: { id: { gt: "prod_1" } },
        orderBy: { id: "asc" },
        take: 2,
        select: { id: true },
      },
    ]);
  });

  it("a tömeges menet az írás ELŐTT kimondja a kiválasztott darabszámot", () => {
    assert.equal(
      describeBatchSize(["prod_1", "prod_2"]),
      "A tömeges vetítés 2 terméket fog érinteni.\n",
    );
  });

  /**
   * ES INNENTOL A SZUKITES. Egy keszlet, ami csak azt meri, hogy a helyes
   * alakok mukodnek, ugyanolyan zold lenne egy olyan ertelmezovel is, ami
   * MINDENT elfogad -- es epp az a veszelyes, mert akkor egy elgepeles
   * csendben mast futtatna.
   */
  it("a felsorolás ÉS a köteg együtt HIBA", () => {
    assert.match(hiba(["prod_1", "--limit", "20"]), /a kettő együtt nem megy/);
  });

  it("a --from önmagában HIBA, mert a teljes maradék indulna", () => {
    assert.match(hiba(["--from", "prod_x"]), /enélkül a teljes maradék/);
  });

  it("üres hívás HIBA, ahogy ma is", () => {
    assert.match(hiba([]), /Adj meg legalább egy termékazonosítót/);
  });

  /**
   * A HIANYZO ERTEK KULON ESET. Egy `--limit` a sor VEGEN: a kovetkezo
   * argumentum `undefined`, es egy elnezo ertelmezes NULLA termeket futtatna --
   * sikeresen, es a hivo azt hinne, nincs mit vinni.
   */
  it("a --limit érték nélkül HIBA, nem nulla", () => {
    assert.match(hiba(["--limit"]), /után érték kell/);
  });

  /**
   * ES HA A KOVETKEZO ARGUMENTUM EGY MASIK KAPCSOLO: enelkul a
   * `--limit --from prod_x` alakban a limit erteke a "--from" SZOVEG lenne, a
   * `--from` pedig elveszne -- ket hiba egyszerre, es egyik sem latszana.
   */
  it("a --limit után egy MÁSIK kapcsoló nem érték", () => {
    assert.match(
      hiba(["--limit", "--from", "prod_x"]),
      /nem egy másik kapcsoló/,
    );
  });

  it("a --limit értéke nem lehet nulla, negatív vagy tört", () => {
    for (const rossz of ["0", "-3", "2.5", "húsz"])
      assert.match(
        hiba(["--limit", rossz]),
        /1-nél nem kisebb egész szám/,
        `elfogadta: ${rossz}`,
      );
  });

  it("ismeretlen kapcsolót NEM néz termékazonosítónak", () => {
    assert.match(hiba(["--mindet"]), /Ismeretlen kapcsoló/);
  });
});
