import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";

import { withUniqueCode } from "./unique-code.util.js";

/**
 * AMIT EZ A FAJL ORIZ.
 *
 * Ket bizonylat akkor kap azonos szamot, ha ugyanabban a masodpercben keszul es
 * ugyanazt a negyjegyu veget huzza. Ma a kimenetel HIBA, es a felhasznalonak
 * kell ujraprobalnia -- a rendszer nem probalja meg maga, holott a kovetkezo
 * huzas mas veletlent adna.
 *
 * A veletlen itt VEZERELVE van, tehat az utkozes nem ritka esemeny, hanem egy
 * sor. Enelkul ezek az allitasok 65 536-bol egy eselyre varnanak.
 */

/** Egy Prisma-szeru egyedisegi hiba, a megsertett oszlop nevevel. */
const duplicate = (field: string) => ({
  code: "P2002",
  meta: { target: [field] },
});

/** A veg, amit a generator huzni fog, sorban. */
function tails(...values: string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

describe("withUniqueCode", () => {
  before(() => {
    // Fix ora: igy KIZAROLAG a veg valtozik a probalkozasok kozott, es a teszt
    // pontosan azt meri, amirol szol.
    mock.timers.enable({
      apis: ["Date"],
      now: Date.UTC(2026, 7, 26, 11, 38, 56, 0),
    });
  });
  after(() => {
    mock.timers.reset();
  });

  it("passes the minted code to the write", async () => {
    const seen: string[] = [];

    const result = await withUniqueCode(
      { prefix: "ESZK", field: "assetNumber", randomSuffix: tails("AB12") },
      async (code) => {
        seen.push(code);
        return "kesz";
      },
    );

    assert.equal(result, "kesz");
    assert.deepEqual(seen, ["ESZK-20260826-113856-AB12"]);
  });

  /**
   * A LENYEGI ALLITAS. Az elso kod utkozik, a masodik atmegy -- es a masodik
   * MAS kod, nem ugyanaz ujra. Ha a burkolat a kodot kivulrol kapna, itt
   * ugyanaz a kod jonne otször.
   */
  it("mints a NEW code for the retry, not the same one again", async () => {
    const seen: string[] = [];

    const result = await withUniqueCode(
      {
        prefix: "ESZK",
        field: "assetNumber",
        randomSuffix: tails("AB12", "99F0"),
      },
      async (code) => {
        seen.push(code);
        if (seen.length === 1) throw duplicate("assetNumber");
        return "kesz";
      },
    );

    assert.equal(result, "kesz");
    assert.equal(seen.length, 2);
    assert.notEqual(seen[0], seen[1]);
    assert.equal(seen[1], "ESZK-20260826-113856-99F0");
  });

  it("runs the write once when nothing collides", async () => {
    let calls = 0;

    await withUniqueCode(
      { prefix: "VEVO", field: "customerNumber", randomSuffix: tails("AB12") },
      async () => {
        calls += 1;
        return null;
      },
    );

    assert.equal(calls, 1);
  });

  /**
   * A HATAR, ES AMI UTANA TORTENIK. Az eredeti hiba jon vissza, valtozatlanul:
   * a hatar utani eset PONTOSAN a mai viselkedes, tehat a legrosszabb eset nem
   * lesz rosszabb, mint a valtozas elott volt.
   */
  it("gives up after the stated number of attempts, with the original error", async () => {
    let calls = 0;
    const error = duplicate("assetNumber");

    await assert.rejects(
      () =>
        withUniqueCode(
          {
            prefix: "ESZK",
            field: "assetNumber",
            maxAttempts: 3,
            randomSuffix: tails("AB12", "99F0", "C3D4", "EEEE"),
          },
          async () => {
            calls += 1;
            throw error;
          },
        ),
      (thrown) => thrown === error,
    );

    // Pontosan harom, nem negy es nem vegtelen.
    assert.equal(calls, 3);
  });

  /**
   * AMIT NEM SZABAD UJRAPROBALNI. Egy P2002 csak annyit mond, hogy VALAMELYIK
   * egyedisegi megkotes serult. Egy mar hasznalt email-cimet otször ujraprobalni
   * annyit ernek, hogy ugyanaz az uzleti hiba KESOBB jon vissza.
   */
  it("does not retry a unique violation on a different column", async () => {
    let calls = 0;
    const error = duplicate("email");

    await assert.rejects(
      () =>
        withUniqueCode(
          { prefix: "VEVO", field: "customerNumber" },
          async () => {
            calls += 1;
            throw error;
          },
        ),
      (thrown) => thrown === error,
    );

    assert.equal(calls, 1);
  });

  it("does not retry an ordinary failure", async () => {
    let calls = 0;
    const error = new Error("a halozat elszallt");

    await assert.rejects(
      () =>
        withUniqueCode({ prefix: "POS", field: "orderNumber" }, async () => {
          calls += 1;
          throw error;
        }),
      (thrown) => thrown === error,
    );

    assert.equal(calls, 1);
  });

  it("refuses a nonsense attempt count instead of looping forever", async () => {
    await assert.rejects(() =>
      withUniqueCode(
        { prefix: "ESZK", field: "assetNumber", maxAttempts: 0 },
        async () => null,
      ),
    );
  });
});
