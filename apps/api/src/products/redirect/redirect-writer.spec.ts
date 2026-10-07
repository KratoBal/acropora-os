import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRedirectStore } from "./redirect-memory-store.js";
import {
  RedirectError,
  redirectInvariantViolations,
  writeRedirect,
  type WriteRedirectInput,
} from "./redirect-writer.js";

/**
 * A LÁNC ÉS A KÖR (SEO P0 PR 6, C5). MI PIROSIT: egy új szabály célja forrás marad
 * (lánc); a régi forrásra mutató szabályok nem íródnak át; egy kör vagy egy A → A
 * átmegy; két, csak betűméretben eltérő forrás megfér; a `keep` felülír.
 */
const ir = (
  store: MemoryRedirectStore,
  source: string,
  destination: string,
  extra: Partial<WriteRedirectInput> = {},
) =>
  writeRedirect(store, {
    source,
    destination,
    reason: "MANUAL",
    onExisting: "keep",
    ...extra,
  });

const szabalyok = async (store: MemoryRedirectStore) =>
  (await store.listActive())
    .map((r) => `${r.sourcePath} -> ${r.destinationPath}`)
    .sort();

const hibaja = (kind: RedirectError["kind"]) => (error: unknown) =>
  error instanceof RedirectError && error.kind === kind;

describe("writeRedirect: lánc", () => {
  it("A→B, majd B→C: A→C és B→C", async () => {
    const store = new MemoryRedirectStore();
    await ir(store, "/a", "/b");
    const eredmeny = await ir(store, "/b", "/c");
    assert.equal(eredmeny.repointed, 1);
    assert.deepEqual(await szabalyok(store), ["/a -> /c", "/b -> /c"]);
    assert.deepEqual(await redirectInvariantViolations(store), []);
  });

  it("fordítva beírva is: B→C, majd A→B: A→C", async () => {
    const store = new MemoryRedirectStore();
    await ir(store, "/b", "/c");
    await ir(store, "/a", "/b");
    assert.deepEqual(await szabalyok(store), ["/a -> /c", "/b -> /c"]);
    assert.deepEqual(await redirectInvariantViolations(store), []);
  });

  it("hosszabb sorban is egy cél sosem forrás", async () => {
    const store = new MemoryRedirectStore();
    for (const [a, b] of [
      ["/1", "/2"],
      ["/3", "/4"],
      ["/2", "/3"],
      ["/4", "/5"],
      ["/0", "/1"],
    ] as const)
      await ir(store, a, b);
    assert.deepEqual(await szabalyok(store), [
      "/0 -> /5",
      "/1 -> /5",
      "/2 -> /5",
      "/3 -> /5",
      "/4 -> /5",
    ]);
    assert.deepEqual(await redirectInvariantViolations(store), []);
  });

  it("a lánc kisbetűsen is lánc", async () => {
    const store = new MemoryRedirectStore();
    await ir(store, "/a", "/B");
    await ir(store, "/b", "/c");
    assert.deepEqual(await szabalyok(store), ["/a -> /c", "/b -> /c"]);
  });
});

describe("writeRedirect: kör és hibás szabály", () => {
  it("A→B, B→A elutasítva, és nem ír", async () => {
    const store = new MemoryRedirectStore();
    await ir(store, "/a", "/b");
    await assert.rejects(ir(store, "/b", "/a"), hibaja("cycle"));
    assert.deepEqual(await szabalyok(store), ["/a -> /b"]);
  });

  it("hosszabb kör is elutasítva", async () => {
    const store = new MemoryRedirectStore();
    await ir(store, "/a", "/b");
    await ir(store, "/b", "/c");
    await assert.rejects(ir(store, "/c", "/a"), hibaja("cycle"));
  });

  it("A→A elutasítva, betűméretben eltérve is", async () => {
    const store = new MemoryRedirectStore();
    await assert.rejects(ir(store, "/a", "/a/"), hibaja("self-redirect"));
    await assert.rejects(
      ir(store, "/Pumpa", "/pumpa"),
      hibaja("self-redirect"),
    );
  });

  it("két, csak betűméretben eltérő forrás nem fér meg (D2)", async () => {
    const store = new MemoryRedirectStore();
    await ir(store, "/Pumpa", "/x");
    await assert.rejects(ir(store, "/pumpa", "/y"), hibaja("case-collision"));
    assert.deepEqual(await szabalyok(store), ["/Pumpa -> /x"]);
  });

  it("nem út: elutasítva", async () => {
    const store = new MemoryRedirectStore();
    await assert.rejects(ir(store, " ", "/x"), hibaja("invalid-path"));
  });
});

describe("writeRedirect: meglévő szabály", () => {
  it("ugyanoda mutató: változatlan, nem ír", async () => {
    const store = new MemoryRedirectStore([
      { id: "r1", sourcePath: "/a", destinationPath: "/b", isActive: true },
    ]);
    assert.equal((await ir(store, "/a/", "/b")).status, "unchanged");
    assert.deepEqual(store.created(), []);
    assert.deepEqual(store.updated(), []);
  });

  it("más célú, keep: a jelentésbe megy, felülírás nélkül", async () => {
    const store = new MemoryRedirectStore([
      { id: "r1", sourcePath: "/a", destinationPath: "/b", isActive: true },
    ]);
    const eredmeny = await ir(store, "/a", "/c");
    assert.deepEqual(eredmeny, {
      status: "conflict",
      repointed: 0,
      existingDestination: "/b",
    });
    assert.deepEqual(store.updated(), []);
  });

  it("más célú, replace: felülírja", async () => {
    const store = new MemoryRedirectStore([
      { id: "r1", sourcePath: "/a", destinationPath: "/b", isActive: true },
    ]);
    assert.equal(
      (await ir(store, "/a", "/c", { onExisting: "replace" })).status,
      "updated",
    );
    assert.deepEqual(await szabalyok(store), ["/a -> /c"]);
  });

  it("kikapcsolt szabály: újra él, az új céllal", async () => {
    const store = new MemoryRedirectStore([
      { id: "r1", sourcePath: "/a", destinationPath: "/b", isActive: false },
    ]);
    assert.equal((await ir(store, "/a", "/c")).status, "reactivated");
    assert.deepEqual(await szabalyok(store), ["/a -> /c"]);
  });

  it("élő cél: a rajta álló szabály megszűnik, és nincs kör", async () => {
    const store = new MemoryRedirectStore();
    await ir(store, "/a", "/b");
    await ir(store, "/b", "/a", { destinationIsLive: true });
    assert.deepEqual(await szabalyok(store), ["/b -> /a"]);
    assert.deepEqual(await redirectInvariantViolations(store), []);
  });
});

describe("MemoryRedirectStore napló", () => {
  it("egy új szabály későbbi módosítása az új sorba olvad", async () => {
    const store = new MemoryRedirectStore([
      { id: "r1", sourcePath: "/x", destinationPath: "/a", isActive: true },
    ]);
    await ir(store, "/a", "/b");
    await ir(store, "/b", "/c");
    assert.deepEqual(
      store.created().map((r) => `${r.sourcePath} -> ${r.destinationPath}`),
      ["/a -> /c", "/b -> /c"],
    );
    assert.deepEqual(store.updated(), [
      { id: "r1", data: { destinationPath: "/c" } },
    ]);
  });
});
