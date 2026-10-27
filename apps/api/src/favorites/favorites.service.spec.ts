import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { FAVORITE_LIMITS } from "@acropora/types";

import { FavoritesRepository } from "./favorites.repository.js";
import { FavoritesService } from "./favorites.service.js";

/*
  THE FAVOURITES' RULES. What turns these red: another user's list touched (the
  user id must be the one passed in, in every call); a malformed path stored
  (the repository must not be reached); the cap on a user's favourites ignored,
  or applied to an item that is already there (re-adding must stay a no-op);
  the order moving when an existing favourite is added again.

  The repository is a plain in-memory double of the REAL contract: a
  `Pick<FavoritesRepository, ...>`, so a signature that moves breaks the build,
  not the user.
*/

function make(initial: Record<string, string[]> = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, [...v]]));
  const calls: string[] = [];
  const repository: Pick<FavoritesRepository, "list" | "add" | "remove"> = {
    list: async (userId) => [...(store.get(userId) ?? [])],
    add: async (userId, href) => {
      calls.push(`add ${userId} ${href}`);
      const list = store.get(userId) ?? [];
      if (!list.includes(href)) list.push(href);
      store.set(userId, list);
    },
    remove: async (userId, href) => {
      calls.push(`remove ${userId} ${href}`);
      store.set(
        userId,
        (store.get(userId) ?? []).filter((item) => item !== href),
      );
    },
  };
  return {
    service: new FavoritesService(repository as FavoritesRepository),
    calls,
    store,
  };
}

describe("FavoritesService", () => {
  it("adds to the caller's own list only, and returns it in marking order", async () => {
    const { service, store } = make({ "u-2": ["/pos"] });
    await service.add("u-1", "/feladataim");
    const result = await service.add("u-1", "/szerviz/hibajegyek");
    assert.deepEqual(result, { items: ["/feladataim", "/szerviz/hibajegyek"] });
    assert.deepEqual(store.get("u-2"), ["/pos"]);
  });

  it("keeps the order when a favourite is added again", async () => {
    const { service } = make({ "u-1": ["/a", "/b"] });
    const result = await service.add("u-1", "/a");
    assert.deepEqual(result.items, ["/a", "/b"]);
  });

  it("removes one, and removing a missing one is not an error", async () => {
    const { service } = make({ "u-1": ["/a", "/b"] });
    assert.deepEqual((await service.remove("u-1", "/a")).items, ["/b"]);
    assert.deepEqual((await service.remove("u-1", "/a")).items, ["/b"]);
  });

  it("refuses a malformed path without reaching the repository", async () => {
    const { service, calls } = make();
    for (const href of ["https://x.hu/a", "//x.hu", "/a?b=1", "", "a"]) {
      await assert.rejects(service.add("u-1", href), BadRequestException);
      await assert.rejects(service.remove("u-1", href), BadRequestException);
    }
    assert.deepEqual(calls, []);
  });

  it("refuses a new favourite over the cap, but not one already stored", async () => {
    const full = Array.from(
      { length: FAVORITE_LIMITS.maxPerUser },
      (_, i) => `/oldal-${i}`,
    );
    const { service, calls } = make({ "u-1": full });
    await assert.rejects(service.add("u-1", "/uj"), BadRequestException);
    assert.deepEqual(calls, []);
    const again = await service.add("u-1", "/oldal-3");
    assert.equal(again.items.length, FAVORITE_LIMITS.maxPerUser);
  });
});
