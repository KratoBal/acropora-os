import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assetMeta,
  assetsInLocation,
  cacheNotice,
  emptyText,
  locationsFromAssets,
  partnersFromAssets,
  startStep,
  templateDecision,
  templatedOnly,
  type StartAsset,
} from "./start-picker";

/*
  A KEZDŐKÉPERNYŐ DÖNTÉSEI (task f6694b49). MI PIROSIT: ha a sablon nélküli eszköz a listában maradna; ha egy partner kétszer
  szerepelne; ha két távoli ág azonos nevű helyszíne egy sorrá olvadna (a helyszín azonosítóval különül, nem névvel); ha a szülő
  helyszín választása nem hozná a részfa eszközeit, vagy másik partner eszközét is hozná; ha a hiányzó paraméter átugorna egy
  szintet; ha egy sablonnál nem nyílna meg a rögzítés, vagy több sablonnál nem a szerelő választana; ha az üres másolat és az üres
  szerver-lista ugyanazt a mondatot kapná.
*/
const asset = (
  id: string,
  over: Partial<StartAsset> & {
    ownerId?: string;
    ownerName?: string;
    unitId?: string;
    path?: string[];
  } = {},
): StartAsset => ({
  id,
  assetNumber: `E-${id}`,
  name: `Eszköz ${id}`,
  owner: {
    id: over.ownerId ?? "p1",
    displayName: over.ownerName ?? "Fánk",
  },
  unit:
    over.unitId === undefined && over.unit === undefined
      ? { id: "u-medence", path: ["Fánk", "Biodóm", "Medence"] }
      : (over.unit ?? { id: over.unitId!, path: over.path ?? ["Fánk"] }),
  ...(over.category ? { category: over.category } : {}),
});

describe("a sablonnal rendelkező eszközök szűrése", () => {
  it("csak a halmazban szereplő azonosítók maradnak, a sorrend megmarad", () => {
    const all = [asset("a"), asset("b"), asset("c")];
    assert.deepEqual(
      templatedOnly(all, new Set(["c", "a"])).map((x) => x.id),
      ["a", "c"],
    );
  });

  it("üres halmaznál nincs eszköz (a sablon hiánya nem jelent „mind”-et)", () => {
    assert.deepEqual(templatedOnly([asset("a")], new Set()), []);
  });
});

describe("a partnerek és a helyszínek a másolatból", () => {
  it("a partner egyszer szerepel, név szerint rendezve", () => {
    const list = [
      asset("1", { ownerId: "p2", ownerName: "Zoo" }),
      asset("2", { ownerId: "p1", ownerName: "Állatkert" }),
      asset("3", { ownerId: "p2", ownerName: "Zoo" }),
    ];
    assert.deepEqual(partnersFromAssets(list), [
      { id: "p1", name: "Állatkert" },
      { id: "p2", name: "Zoo" },
    ]);
  });

  it("két azonos nevű, távoli helyszín külön sor, teljes úttal", () => {
    const list = [
      asset("1", { unitId: "u1", path: ["Fánk", "Biodóm"] }),
      asset("2", { unitId: "u2", path: ["Fánk", "Akvárium", "Biodóm"] }),
      asset("3", { unitId: "u1", path: ["Fánk", "Biodóm"] }),
    ];
    assert.deepEqual(locationsFromAssets(list, "p1"), [
      { id: "u2", label: "Fánk / Akvárium / Biodóm" },
      { id: "u1", label: "Fánk / Biodóm" },
    ]);
  });

  it("csak a kért partner helyszínei, és az eszköz helyszín nélkül kimarad", () => {
    const list = [
      asset("1", { ownerId: "p2", unitId: "ux", path: ["Más"] }),
      asset("2", { unit: undefined, ownerId: "p1", unitId: "u1" }),
    ];
    const noUnit: StartAsset = { ...asset("3"), unit: undefined };
    assert.deepEqual(locationsFromAssets([...list, noUnit], "p1"), [
      { id: "u1", label: "Fánk" },
    ]);
  });
});

describe("a helyszín eszközei a másolatból", () => {
  const list = [
    asset("1", { unitId: "u-biodom", path: ["Fánk", "Biodóm"] }),
    asset("2", { unitId: "u-medence", path: ["Fánk", "Biodóm", "Medence"] }),
    asset("3", { unitId: "u-iroda", path: ["Fánk", "Iroda"] }),
    asset("4", {
      ownerId: "p2",
      unitId: "u-biodom2",
      path: ["Fánk", "Biodóm"],
    }),
  ];

  it("a szülő helyszín a részfa eszközeit is hozza, a testvért és a másik partnert nem", () => {
    assert.deepEqual(
      assetsInLocation(list, "p1", "u-biodom").map((x) => x.id),
      ["1", "2"],
    );
  });

  it("a levél helyszín csak a sajátját hozza", () => {
    assert.deepEqual(
      assetsInLocation(list, "p1", "u-medence").map((x) => x.id),
      ["2"],
    );
  });

  it("a másolatban ismeretlen helyszínhez nincs eszköz (nem találgatunk útvonalat)", () => {
    assert.deepEqual(assetsInLocation(list, "p1", "u-nincs"), []);
    assert.deepEqual(assetsInLocation(list, "p9", "u-biodom"), []);
  });
});

describe("az eszköz felirata", () => {
  it("az eszközszám és a kategória, kihagyva a hiányzót", () => {
    assert.equal(
      assetMeta({ assetNumber: "E-1", category: "Szivattyú" }),
      "E-1 · Szivattyú",
    );
    assert.equal(assetMeta({ assetNumber: "E-1" }), "E-1");
    assert.equal(assetMeta({ assetNumber: "E-1", category: "  " }), "E-1");
  });
});

describe("a lépés a paraméterekből", () => {
  it("a hiányzó felső szint a legutolsó teljes szintre ejt, nem ugrik át", () => {
    assert.equal(startStep({}), "partners");
    assert.equal(startStep({ locationId: "u", assetId: "a" }), "partners");
    assert.equal(startStep({ partnerId: "p" }), "locations");
    assert.equal(startStep({ partnerId: "p", assetId: "a" }), "locations");
    assert.equal(startStep({ partnerId: "p", locationId: "u" }), "devices");
    assert.equal(
      startStep({ partnerId: "p", locationId: "u", assetId: "a" }),
      "templates",
    );
  });
});

describe("a sablon-döntés", () => {
  it("nincs sablon: kimondjuk; egy: megnyílik; több: a szerelő választ", () => {
    assert.deepEqual(templateDecision([]), { kind: "none" });
    assert.deepEqual(templateDecision([{ id: "t1" }]), {
      kind: "record",
      templateId: "t1",
    });
    assert.deepEqual(templateDecision([{ id: "t1" }, { id: "t2" }]), {
      kind: "choose",
    });
  });
});

describe("az üres lista mondata", () => {
  it("a másolat üres mondata a letöltést kéri, a szerveré nem", () => {
    for (const kind of ["partners", "locations", "devices"] as const) {
      assert.match(emptyText(kind, true), /töltsd le/);
      assert.doesNotMatch(emptyText(kind, false), /töltsd le/);
    }
  });

  it("a másolat felirata kimondja a korlátot", () => {
    assert.match(cacheNotice, /letöltésekor/);
  });
});
