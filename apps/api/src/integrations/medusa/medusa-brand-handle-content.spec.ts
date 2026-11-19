import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handleContentReader,
  type HandleContentSources,
} from "./medusa-brand-handle-content.js";

/*
  A HANDLE-T FOGLALO GYUJTEMENY TARTALMA (kartya ec82b629, acrobot 57247). MI PIROSIT: ha a sajat, a mas markaju es a nem
  parosithato termek rossz rovatba kerul; ha a marka nelkuli termek "sajat"-nak szamit; ha egy csonkolt lista vagy egy hiba
  iteletet ad (osszekotest engedne meg nem mert tartalomra); ha egy jelolt hibaja a tobbit is elviszi; ha a hiba nem jut el a
  hivohoz.
*/
const sources = (
  over: Partial<HandleContentSources> = {},
): HandleContentSources => ({
  collectionProductIds: async (collectionId) =>
    collectionId === "pcol_fm"
      ? {
          ids: ["prod_1", "prod_2", "prod_3", "prod_4", "prod_5"],
          truncated: false,
        }
      : { ids: [], truncated: false },
  // prod_5 nem parosithato (nincs kotes-sor, nincs egyertelmu SKU)
  osProductsOfShop: async (ids) =>
    new Map(
      ids.flatMap((id) =>
        id === "prod_5" ? [] : [[id, `os_${id.slice(5)}`] as [string, string]],
      ),
    ),
  // os_3 masik markae, os_4 marka nelkuli
  brandsOfOsProducts: async (ids) =>
    new Map(
      ids.map((id) => [
        id,
        id === "os_3" ? "brand-other" : id === "os_4" ? null : "brand-fm",
      ]),
    ),
  ...over,
});

describe("handleContentReader", () => {
  it("a sajat, a mas markaju (a marka nelkulivel) es a nem parosithato termeket kulon szamolja", async () => {
    const read = handleContentReader(sources());
    const contents = await read([
      { collectionId: "pcol_fm", brandId: "brand-fm" },
    ]);

    assert.deepEqual(contents.get("pcol_fm"), {
      total: 5,
      sameBrand: 2,
      otherBrand: 2,
      unknown: 1,
    });
  });

  it("az ures gyujtemeny itelete ures (osszekotheto)", async () => {
    const read = handleContentReader(sources());
    const contents = await read([
      { collectionId: "pcol_ures", brandId: "brand-fm" },
    ]);

    assert.deepEqual(contents.get("pcol_ures"), {
      total: 0,
      sameBrand: 0,
      otherBrand: 0,
      unknown: 0,
    });
  });

  it("a csonkolt lista nem ad iteletet, es a hivo megtudja", async () => {
    const hibak: string[] = [];
    const read = handleContentReader(
      sources({
        collectionProductIds: async () => ({
          ids: ["prod_1"],
          truncated: true,
        }),
      }),
      (collectionId) => hibak.push(collectionId),
    );
    const contents = await read([
      { collectionId: "pcol_fm", brandId: "brand-fm" },
    ]);

    assert.equal(contents.has("pcol_fm"), false);
    assert.deepEqual(hibak, ["pcol_fm"]);
  });

  it("egy jelolt hibaja nem ad iteletet ra, a tobbi jelolt megy tovabb, a hiba eljut a hivohoz", async () => {
    const hibak: string[] = [];
    const read = handleContentReader(
      sources({
        collectionProductIds: async (collectionId) => {
          if (collectionId === "pcol_rossz") throw new Error("HTTP 500");
          return { ids: [], truncated: false };
        },
      }),
      (collectionId, error) =>
        hibak.push(`${collectionId}: ${(error as Error).message}`),
    );
    const contents = await read([
      { collectionId: "pcol_rossz", brandId: "brand-a" },
      { collectionId: "pcol_jo", brandId: "brand-b" },
    ]);

    assert.deepEqual([...contents.keys()], ["pcol_jo"]);
    assert.deepEqual(hibak, ["pcol_rossz: HTTP 500"]);
  });
});
