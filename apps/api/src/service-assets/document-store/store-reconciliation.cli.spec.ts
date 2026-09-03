import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  DocumentKey,
  DocumentStore,
  DocumentStoreStatus,
} from "./document-store.js";
import { runReconciliation } from "./store-reconciliation.cli.js";

const kulcs = (assetId: string, documentId: string): DocumentKey => ({
  assetId,
  documentId,
});

/**
 * A TAROLO-DUPLA A VARRATON KAPJA A VALODI SZERZODEST (`DocumentStore`), nem egy
 * laza objektumot. A lapunk merte, hogy egy laza varrat pontosan azt a mezot
 * engedi el, amit a hivo hasznal -- itt a `describe()` harom allapotat.
 */
function tarolo(options: {
  status?: DocumentStoreStatus;
  files?: DocumentKey[];
  describeThrows?: boolean;
  listThrows?: boolean;
  /** `null`: a tarolo EGYALTALAN nem ad meretet (a metodus hianyzik). */
  sizes?: Record<string, number | null> | null;
  sizeThrows?: boolean;
}): DocumentStore {
  return {
    put: async () => undefined,
    get: async () => null,
    delete: async () => false,
    describe: async () => {
      if (options.describeThrows) throw new Error("nem elerheto");
      return options.status ?? { state: "ready", root: "/tmp/x" };
    },
    list: async function* () {
      if (options.listThrows) throw new Error("a listazas elhasalt");
      for (const key of options.files ?? []) yield key;
    },
    /**
     * A MERET-ADO ALAK ELHAGYHATO A SZERZODESBEN, es a dupla ezt utanozza: ha
     * a hivo `sizes: null`-t ker, a metodus NINCS az objektumon -- nem az,
     * hogy `undefined`-ot ad vissza. A ket allapot mast jelent, es a futtato
     * epp ezt kulonbozteti meg.
     */
    ...(options.sizes === null
      ? {}
      : {
          size: async (key: DocumentKey) => {
            if (options.sizeThrows) throw new Error("a meret nem olvashato");
            const kulcs = `${key.assetId}/${key.documentId}`;
            return options.sizes?.[kulcs] ?? 10;
          },
        }),
  } as unknown as DocumentStore;
}

describe("tarolo-egyeztetes futtatoja", () => {
  it("egyezo allapotban nulla", async () => {
    const ki = await runReconciliation({
      store: tarolo({ files: [kulcs("a1", "d1")] }),
      fetchRows: async () => [{ key: kulcs("a1", "d1"), sizeBytes: 10 }],
    });
    assert.equal(ki.code, 0);
    assert.ok(ki.lines.some((l) => l.includes("parba allt: 1")));
  });

  /**
   * A KET ELTERES KULON SORBAN JELENIK MEG, mert a teendojuk ELLENTETES: az
   * arva fajl torolheto, a hianyzo fajl a felhasznalo ele kerul. Egy kozos
   * "elteres" szam ugyanazt mondana ket ellentetes bajra.
   */
  it("megkulonbozteti az arva fajlt a hianyzotol", async () => {
    const ki = await runReconciliation({
      store: tarolo({ files: [kulcs("a1", "arva")] }),
      fetchRows: async () => [{ key: kulcs("a1", "hianyzo"), sizeBytes: 10 }],
    });
    assert.equal(ki.code, 1);
    assert.ok(ki.lines.some((l) => l.startsWith("  ARVA    a1/arva")));
    assert.ok(ki.lines.some((l) => l.startsWith("  HIANYZO a1/hianyzo")));
  });

  /**
   * EZ AZ ALLITAS A PARANCS LETEZESENEK FELE: a "nincs beallitva" NEM azonos a
   * "tiszta" allapottal. Egy kozos nulla kilepesi kod azt allitana, hogy
   * megmertuk es rendben van -- holott nem mertunk semmit.
   */
  it("a nem beallitott tarolot NEM mondja tisztanak", async () => {
    const ki = await runReconciliation({
      store: tarolo({
        status: { state: "not-configured", reason: "nincs csatolt konyvtar" },
      }),
      fetchRows: async () => {
        throw new Error("a sorokat el sem szabad kerni");
      },
    });
    assert.equal(ki.code, 3);
    assert.ok(ki.lines.some((l) => l.includes("nem mertuk meg")));
  });

  it("a hibas tarolot elvalasztja a nem beallitottol", async () => {
    const ki = await runReconciliation({
      store: tarolo({ status: { state: "broken", reason: "nem irhato" } }),
      fetchRows: async () => [],
    });
    assert.equal(ki.code, 2);
  });

  /**
   * A HARMADIK BUKASI MOD: a tarolo azt mondja, hogy keszen all, es a
   * LISTAZAS hasal el. Ez nem ugyanaz, mint a `broken` allapot -- ott a tarolo
   * maga mondja meg; itt menet kozben derul ki, es ugyanugy NEM tudjuk, van-e
   * elteres.
   */
  /**
   * AZ OTODIK ALLAPOT: a kulcsok egyeznek, de a MERETET nem tudtuk megnezni.
   *
   * Ez NEM ugyanaz, mint hogy nincs elteres. Egy tavoli tarolonal a meret
   * kulon halozati keres fajlonkent, tehat a meret-ado alak elhagyhato -- es
   * ilyenkor a futtato KIMONDJA, hogy felig mert, nem allitja tisztanak.
   */
  it("a meretet nem ado tarolot NEM mondja tisztanak", async () => {
    const ki = await runReconciliation({
      store: tarolo({ files: [kulcs("a1", "d1")], sizes: null }),
      fetchRows: async () => [{ key: kulcs("a1", "d1"), sizeBytes: 10 }],
    });
    assert.equal(ki.code, 4);
    assert.ok(ki.lines.some((l) => l.includes("NEM AD MERETET")));
  });

  it("az eltero meretet megtalalja, es kiirja mindket szamot", async () => {
    const ki = await runReconciliation({
      store: tarolo({ files: [kulcs("a1", "d1")], sizes: { "a1/d1": 7 } }),
      fetchRows: async () => [{ key: kulcs("a1", "d1"), sizeBytes: 10 }],
    });
    assert.equal(ki.code, 1);
    assert.ok(ki.lines.some((l) => l.includes("tabla=10 tarolo=7")));
  });

  /**
   * A KULCS-ELTERES ELOZI A MERETET, es ez nem sorrendi izles: egy HIANYZO
   * fajlnak nincs merete, amit ossze lehetne vetni. Eloszor a halmaz alljon
   * helyre, aztan a tartalom.
   */
  it("kulcs-elteresnel a meretet meg nem is nezi", async () => {
    const ki = await runReconciliation({
      store: tarolo({ files: [], sizeThrows: true }),
      fetchRows: async () => [{ key: kulcs("a1", "d1"), sizeBytes: 10 }],
    });
    assert.equal(ki.code, 1);
    assert.ok(ki.lines.some((l) => l.startsWith("  HIANYZO")));
  });

  it("a menet kozben elhasalt listazas nem nulla", async () => {
    const ki = await runReconciliation({
      store: tarolo({ listThrows: true }),
      fetchRows: async () => [],
    });
    assert.equal(ki.code, 2);
    assert.ok(ki.lines.some((l) => l.includes("elhasalt")));
  });
});
