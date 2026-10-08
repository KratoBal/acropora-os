import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runHandleSwitchCli,
  type HandleSource,
} from "./medusa-handle-switch.cli.js";

/**
 * A HANDLE-ÁTKAPCSOLÓ PARANCS (SEO P0 PR 7d). MI PIROSIT: a szárazfutás ír; a
 * kapcsoló iránya nélkül is ír (a vetítés visszaírná); nem függőségi sorrendben
 * ír; a második lap kimarad; a `--vissza` nem a UNAS-slugot írja; ismeretlen
 * kapcsolóra fut.
 */
function bolt(termekek: { id: string; handle: string }[], lap = 200) {
  const irasok: [string, string][] = [];
  return {
    irasok,
    client: {
      listProductHandles: async (offset: number, limit: number) => ({
        products: termekek.slice(offset, offset + Math.min(limit, lap)),
        count: termekek.length,
      }),
      setProductHandle: async (id: string, handle: string) => {
        irasok.push([id, handle]);
      },
    },
  };
}
const forras = (
  productId: string,
  medusaId: string,
  unasSlug: string | null,
  webshopSlug: string | null,
): HandleSource => ({ productId, medusaId, unasSlug, webshopSlug });
const csend = { stdout: () => {}, stderr: () => {} };
const BE = { MEDUSA_HANDLE_FROM_WEBSHOP_SLUG: "true" };

// m_b ma a "kozos" handle-t tartja, m_a erre vált: előbb m_b mozog
const termekek = [
  { id: "m_a", handle: "a-regi" },
  { id: "m_b", handle: "kozos" },
];
const forrasok = [
  forras("p_a", "m_a", "A-Regi", "kozos"),
  forras("p_b", "m_b", "Kozos", "b-uj"),
];

const futtat = (
  argv: string[],
  b: ReturnType<typeof bolt>,
  env: Record<string, string> = BE,
  sources = forrasok,
) =>
  runHandleSwitchCli(argv, csend, {
    client: async () => b.client as never,
    sources: async () => sources,
    env,
  });

describe("medusa:handle-switch", () => {
  it("alapból szárazfutás: nem ír", async () => {
    const b = bolt(termekek);
    assert.equal(await futtat([], b), 0);
    assert.deepEqual(b.irasok, []);
  });

  it("--apply függőségi sorrendben írja a WEBSHOP-slugot", async () => {
    const b = bolt(termekek);
    assert.equal(await futtat(["--apply"], b), 0);
    assert.deepEqual(b.irasok, [
      ["m_b", "b-uj"],
      ["m_a", "kozos"],
    ]);
  });

  it("a kapcsoló nélkül nem ír előre, kapcsolóval nem ír vissza", async () => {
    let b = bolt(termekek);
    assert.equal(await futtat(["--apply"], b, {}), 1);
    assert.deepEqual(b.irasok, []);
    b = bolt(termekek);
    assert.equal(await futtat(["--apply", "--vissza"], b, BE), 1);
    assert.deepEqual(b.irasok, []);
  });

  it("--vissza a UNAS-slug kisbetűs alakját írja", async () => {
    const b = bolt([
      { id: "m_a", handle: "kozos" },
      { id: "m_b", handle: "b-uj" },
    ]);
    assert.equal(await futtat(["--apply", "--vissza"], b, {}), 0);
    assert.deepEqual(b.irasok.sort(), [
      ["m_a", "a-regi"],
      ["m_b", "kozos"],
    ]);
  });

  it("a bolt minden lapját olvassa (a második lap termékét is)", async () => {
    const b = bolt(termekek, 1);
    assert.equal(await futtat(["--apply"], b), 0);
    assert.equal(b.irasok.length, 2);
  });

  it("ismeretlen kapcsolóra nem fut", async () => {
    const b = bolt(termekek);
    assert.equal(await futtat(["--aply"], b), 1);
    assert.deepEqual(b.irasok, []);
  });
});
