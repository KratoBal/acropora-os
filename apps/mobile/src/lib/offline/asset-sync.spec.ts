import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MAX_PAGES,
  syncAssetsForOffline,
  type OfflinePage,
} from "./asset-sync";

/**
 * A CSENDBEN ELVÁGOTT MÁSOLAT A TÉT.
 *
 * Egy ötven elemnél megálló letöltés ugyanúgy néz ki, mint a teljes: a lista
 * megjelenik, a sáv frissnek mondja, és a hiba csak akkor derül ki, amikor egy
 * szerelő egy létező matricára azt a választ kapja, hogy ismeretlen eszköz.
 * Ezért mér ez a fájl darabszámot, korlátot és a hiba utáni viselkedést is.
 */

function pages(
  total: number,
  pageSize: number,
): (page: number) => OfflinePage<{ id: string }> {
  const totalPages = Math.ceil(total / pageSize);
  return (page: number) => ({
    items: Array.from(
      {
        length: Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize)),
      },
      (_, index) => ({ id: `asset-${(page - 1) * pageSize + index + 1}` }),
    ),
    pagination: { page, pageSize, totalItems: total, totalPages },
  });
}

describe("syncAssetsForOffline", () => {
  it("walks every page, not just the one the screen shows", async () => {
    const saved: string[] = [];
    const page = pages(120, 50);

    const result = await syncAssetsForOffline({
      fetchPage: async (number) => page(number),
      remember: async (items) => {
        saved.push(...items.map((item) => item.id));
      },
    });

    assert.equal(result.pagesFetched, 3);
    assert.equal(result.itemsSaved, 120);
    assert.equal(saved.length, 120);
    assert.equal(saved[119], "asset-120");
    assert.equal(result.truncated, false);
    assert.equal(result.failed, false);
  });

  it("stops at a single page without asking for a second one", async () => {
    const asked: number[] = [];
    const page = pages(10, 50);

    const result = await syncAssetsForOffline({
      fetchPage: async (number) => {
        asked.push(number);
        return page(number);
      },
      remember: async () => {},
    });

    assert.deepEqual(asked, [1]);
    assert.equal(result.itemsSaved, 10);
  });

  /**
   * A KORLÁT KIMONDVA. Nem az a kérdés, hogy van-e felső határ -- kell hogy
   * legyen --, hanem hogy a hívó megtudja-e, hogy elvágtuk.
   */
  it("says when the ceiling cut the copy short", async () => {
    const page = pages(50 * (DEFAULT_MAX_PAGES + 5), 50);

    const result = await syncAssetsForOffline({
      fetchPage: async (number) => page(number),
      remember: async () => {},
    });

    assert.equal(result.pagesFetched, DEFAULT_MAX_PAGES);
    assert.equal(result.truncated, true);
  });

  /**
   * A FÉLIG LEHÚZOTT MÁSOLAT IS ÉR VALAMIT: a metróban megszakadt letöltés után
   * az első két oldal ott van a készüléken. Amit nem szabad, az elhallgatni,
   * hogy nem teljes.
   */
  it("keeps what it already saved when a page fails, and reports the failure", async () => {
    const page = pages(200, 50);
    let saved = 0;

    const result = await syncAssetsForOffline({
      fetchPage: async (number) => {
        if (number === 3) throw new Error("network down");
        return page(number);
      },
      remember: async (items) => {
        saved += items.length;
      },
    });

    assert.equal(result.failed, true);
    assert.equal(result.pagesFetched, 2);
    assert.equal(saved, 100);
  });

  /**
   * A SZERVER TÖBBET ÍGÉR, MINT AMENNYIT AD: `totalPages` négy, de a harmadik
   * oldal üres. Továbbmenni végtelen ciklus lenne.
   */
  it("stops on an empty page instead of looping forever", async () => {
    const result = await syncAssetsForOffline({
      fetchPage: async (number) => ({
        items: number <= 2 ? [{ id: `asset-${number}` }] : [],
        pagination: { page: number, pageSize: 1, totalItems: 4, totalPages: 4 },
      }),
      remember: async () => {},
    });

    assert.equal(result.pagesFetched, 3);
    assert.equal(result.itemsSaved, 2);
  });
});
