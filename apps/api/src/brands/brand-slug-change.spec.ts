import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyBrandSlugChange,
  assertBrandSlugFree,
  type BrandSlugTx,
} from "./brand-slug-change.js";

/**
 * A MÁRKA SLUG-CSERÉJE (t11, barracuda #1678 C). MI PIROSÍTJA: egy átnevezés
 * után a régi /hu/marka/ cím átirányítás nélkül marad; a régi slug nem kerül a
 * történetbe, vagy egy MÁSIK márka megkaphatja; a saját régi slug visszavétele
 * ütközésnek számít; a zár nem az írás előtt jön; változatlan slugnál írás megy.
 */
function hamis(tortenet: { entityId: string; slug: string }[] = []) {
  const hivasok: string[] = [];
  const sorok = [...tortenet];
  const tx = {
    slugHistory: {
      findFirst: async (args: {
        where: { slug: string; entityId?: { not: string } };
      }) =>
        sorok.find(
          (s) =>
            s.slug === args.where.slug &&
            s.entityId !== args.where.entityId?.not,
        ) ?? null,
      deleteMany: async (args: {
        where: { entityId: string; slug: string };
      }) => {
        hivasok.push(`torol ${args.where.entityId}/${args.where.slug}`);
        return { count: 0 };
      },
      create: async (args: { data: { entityId: string; slug: string } }) => {
        hivasok.push(`tortenet ${args.data.entityId}/${args.data.slug}`);
        sorok.push(args.data);
        return args.data;
      },
    },
  } as unknown as BrandSlugTx;
  const deps = {
    lock: async () => {
      hivasok.push("zar");
    },
    write: async (
      _tx: unknown,
      input: {
        source: string;
        destination: string;
        reason: string;
        onExisting: string;
        destinationIsLive?: boolean;
      },
    ) => {
      hivasok.push(
        `301 ${input.source} -> ${input.destination} ${input.reason} ${input.onExisting} ${input.destinationIsLive}`,
      );
    },
  };
  return { tx, deps, hivasok };
}

describe("a márka slug-cseréje", () => {
  it("zár, a régi slug a történetbe, és 301 a régi címről az újra", async () => {
    const { tx, deps, hivasok } = hamis();
    const tortent = await applyBrandSlugChange(
      tx,
      { brandId: "b1", from: "aqua-forest", to: "aquaforest", actorId: "u1" },
      deps,
    );
    assert.equal(tortent, true);
    assert.deepEqual(hivasok, [
      "zar",
      "torol b1/aquaforest",
      "tortenet b1/aqua-forest",
      "301 /hu/marka/aqua-forest -> /hu/marka/aquaforest SLUG_CHANGE replace true",
    ]);
  });

  it("változatlan slugnál semmi nem íródik", async () => {
    const { tx, deps, hivasok } = hamis();
    assert.equal(
      await applyBrandSlugChange(
        tx,
        { brandId: "b1", from: "x", to: "x" },
        deps,
      ),
      false,
    );
    assert.deepEqual(hivasok, []);
  });

  it("egy másik márka régi slugja foglalt, a saját régi slug nem", async () => {
    const { tx } = hamis([{ entityId: "b2", slug: "red-sea" }]);
    await assert.rejects(
      assertBrandSlugFree(tx, "red-sea", "b1"),
      /SLUG_TAKEN/,
    );
    await assert.rejects(
      assertBrandSlugFree(tx, "red-sea", null),
      /SLUG_TAKEN/,
    );
    await assertBrandSlugFree(tx, "red-sea", "b2");
    await assertBrandSlugFree(tx, "uj-nev", "b1");
  });
});
