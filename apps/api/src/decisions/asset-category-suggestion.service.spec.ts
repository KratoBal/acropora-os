import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForbiddenException } from "@nestjs/common";
import type { FetchLike } from "@acropora/jev";
import type { AuthenticatedUser } from "@acropora/types";

import { AssetCategorySuggestionController } from "./asset-category-suggestion.controller.js";
import { AssetCategorySuggestionService } from "./asset-category-suggestion.service.js";
import type {
  CategoryRow,
  DecisionRunRepository,
  StoredRun,
} from "./decision-run.repository.js";

const KULCS = "titkos-kulcs-SOHA-NEM-LATSZIK";
/* A 10%-os kontroll kulcsai (Python hashlib-bel szamolva, lasd a jev csomag tesztjet). */
const KONTROLL = "asset-create:web:teszt-27";
const URLAP = "asset-create:web:teszt-0";

const KATEGORIAK: CategoryRow[] = [
  { id: "cat_lig", name: "Világítás", code: "LIG" },
  { id: "cat_avs", name: "Automata váltószelep", code: "AVS" },
];

type Sor = { -readonly [K in keyof StoredRun]: StoredRun[K] } & {
  clientOperationId: string;
  entityId: string | null;
  data: Record<string, unknown>;
};

/**
 * A TAROLO DUPLAJA: a valodi szerzodes tipusat kapja (a haz szabalya), es a
 * `DecisionRun` sorokat egy tombben tartja, hogy a teszt a TENYLEG irt
 * sorokat merje, ne a szolgaltatas valaszat.
 */
function tarolo(opciok: { mentett?: Record<string, unknown> | null } = {}) {
  const sorok: Sor[] = [];
  const repo: Pick<
    DecisionRunRepository,
    | "activeCategories"
    | "unitName"
    | "parentCategoryName"
    | "departmentPath"
    | "savedAsset"
    | "findRun"
    | "markOthersStale"
    | "createRun"
    | "openRunForOperation"
    | "resolveRun"
  > = {
    activeCategories: async () => KATEGORIAK,
    unitName: async () => "watt",
    parentCategoryName: async () => null,
    departmentPath: async () => ["BIO", "LSS07"],
    savedAsset: async () =>
      (opciok.mentett === undefined
        ? {
            name: "BIO/LSS07 Kessil lámpa",
            manufacturer: "Kessil",
            model: null,
            kind: "EQUIPMENT",
            performance: null,
            performanceUnitId: null,
            powerConsumption: null,
            parentAssetId: null,
            departmentId: "d1",
            categoryId: "cat_lig",
          }
        : opciok.mentett) as never,
    findRun: async (k) =>
      sorok.find(
        (s) =>
          s.clientOperationId === k.clientOperationId &&
          s.projectionHash === k.projectionHash,
      ) ?? null,
    markOthersStale: async (k, id) => {
      for (const s of sorok)
        if (
          s.clientOperationId === k.clientOperationId &&
          s.entityId === null
        ) {
          if (s.id !== id && s.resolution === null) s.resolution = "STALE";
          if (s.id === id && s.resolution === "STALE") s.resolution = null;
        }
    },
    createRun: async (data) => {
      const sor: Sor = {
        id: `run${sorok.length + 1}`,
        projectionHash: data.projectionHash,
        selectedValue: data.selectedValue ?? null,
        confidence: data.confidence ?? null,
        exposure: data.exposure,
        status: data.status,
        resolution: null,
        clientOperationId: data.clientOperationId as string,
        entityId: null,
        data: data as unknown as Record<string, unknown>,
      };
      sorok.push(sor);
      return sor;
    },
    openRunForOperation: async (_k, _v, cid) =>
      [...sorok]
        .reverse()
        .find(
          (s) =>
            s.clientOperationId === cid &&
            s.entityId === null &&
            s.resolution === null,
        ) ?? null,
    resolveRun: async (id, data) => {
      const sor = sorok.find((s) => s.id === id) as Sor;
      sor.entityId = data.entityId;
      sor.resolution = data.resolution;
      sor.data = { ...sor.data, resolvedValue: data.resolvedValue };
    },
  };
  return { repo: repo as DecisionRunRepository, sorok };
}

/** A Jev duplaja: minden hivas a megadott valaszt kapja, es szamolja a hivasokat. */
function jev(
  valasz:
    | { choice: string; confidence: number }
    | { status: number; body: string }
    | Error,
) {
  const hivasok: string[] = [];
  const fetch: FetchLike = async (_url, init) => {
    hivasok.push(init.body);
    if (valasz instanceof Error) throw valasz;
    if ("status" in valasz)
      return {
        status: valasz.status,
        headers: { get: () => null },
        text: async () => valasz.body,
      };
    return {
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            q: {
              ...valasz,
              probabilities: { [valasz.choice]: valasz.confidence },
            },
          },
          usage: { input_tokens: 50 },
        }),
    };
  };
  return { fetch, hivasok };
}

const BE = { JEV_ASSET_CATEGORY_PREFILL: "live", TYPESAFE_API_KEY: KULCS };
const MEZOK = {
  name: "BIO/LSS07 Kessil lámpa",
  manufacturer: "Kessil",
  departmentId: "d1",
  kind: "EQUIPMENT",
};

function szolgaltatas(
  env: NodeJS.ProcessEnv,
  j = jev({ choice: "cat_lig", confidence: 0.95 }),
  t = tarolo(),
) {
  return {
    service: new AssetCategorySuggestionService(t.repo, env, j.fetch),
    ...t,
    ...j,
  };
}

describe("a kategória-javaslat: kapcsoló", () => {
  it("kikapcsolva nem hív, nem ír, és azt mondja, hogy ki van kapcsolva", async () => {
    for (const env of [
      {},
      { ...BE, JEV_ASSET_CATEGORY_PREFILL: "on" },
      { ...BE, TYPESAFE_API_KEY: "" },
    ]) {
      const s = szolgaltatas(env as NodeJS.ProcessEnv);
      assert.deepEqual(await s.service.suggest(URLAP, MEZOK), {
        enabled: false,
        categoryId: null,
      });
      assert.equal(s.hivasok.length, 0);
      assert.equal(s.sorok.length, 0);
    }
  });
});

describe("a kategória-javaslat: láthatóság", () => {
  it("validált kategória ≥ 0,90-nel: a javaslat visszajön, a futás SHOWN", async () => {
    const s = szolgaltatas(BE);
    assert.deepEqual(await s.service.suggest(URLAP, MEZOK), {
      enabled: true,
      categoryId: "cat_lig",
    });
    assert.equal(s.sorok[0]?.exposure, "SHOWN");
    assert.equal(s.sorok[0]?.data.status, "OK");
  });

  /** A REJTETT JAVASLAT SOHA NEM JUT EL A BONGESZOIG. */
  it("ritka kategória: a futás HIDDEN, és a válaszban nincs kategória", async () => {
    const s = szolgaltatas(BE, jev({ choice: "cat_avs", confidence: 0.99 }));
    assert.deepEqual(await s.service.suggest(URLAP, MEZOK), {
      enabled: true,
      categoryId: null,
    });
    assert.equal(s.sorok[0]?.exposure, "HIDDEN");
    assert.equal(s.sorok[0]?.selectedValue, "cat_avs");
  });

  it("a kontrollba eső űrlap a jogosult javaslatot sem kapja meg", async () => {
    const s = szolgaltatas(BE);
    assert.deepEqual(await s.service.suggest(KONTROLL, MEZOK), {
      enabled: true,
      categoryId: null,
    });
    assert.equal(s.sorok[0]?.exposure, "HIDDEN");
  });
});

describe("a kategória-javaslat: a futás tartalma", () => {
  it("a Jev a tisztított vetületet látja, a kulcs sehol nincs a futásban", async () => {
    const s = szolgaltatas(BE);
    await s.service.suggest(URLAP, MEZOK);
    assert.match(
      s.hivasok[0] ?? "",
      /"state":"\{\\"kind\\": \\"EQUIPMENT\\", \\"manufacturer\\": \\"Kessil\\", \\"name\\": \\"Kessil lámpa\\"\}"/,
    );
    assert.doesNotMatch(s.hivasok[0] ?? "", /LSS07/);
    assert.doesNotMatch(JSON.stringify(s.sorok), new RegExp(KULCS));
    assert.equal(s.sorok[0]?.data.policyVersion, 2);
    assert.equal(s.sorok[0]?.data.requestedModel, "jev-1.13.0");
    assert.match(String(s.sorok[0]?.data.projectionHash), /^cph1:sha256:/);
    assert.match(String(s.sorok[0]?.data.optionsHash), /^cph1:sha256:/);
  });

  it("ugyanarra a vetületre nincs új hívás", async () => {
    const s = szolgaltatas(BE);
    await s.service.suggest(URLAP, MEZOK);
    await s.service.suggest(URLAP, MEZOK);
    assert.equal(s.hivasok.length, 1);
    assert.equal(s.sorok.length, 1);
  });

  it("új vetület: új futás, a régi STALE; visszaírva a régi újra nyitott", async () => {
    const s = szolgaltatas(BE);
    await s.service.suggest(URLAP, MEZOK);
    await s.service.suggest(URLAP, { ...MEZOK, model: "A360X" });
    assert.deepEqual(
      s.sorok.map((r) => r.resolution),
      ["STALE", null],
    );
    await s.service.suggest(URLAP, MEZOK);
    assert.deepEqual(
      s.sorok.map((r) => r.resolution),
      [null, "STALE"],
    );
    assert.equal(s.hivasok.length, 2);
  });
});

describe("a kategória-javaslat: hiba nem akasztja meg az űrlapot", () => {
  it("hálózati hiba vagy időtúllépés: null javaslat, ERROR futás, nincs dobás", async () => {
    const s = szolgaltatas(
      BE,
      jev(new Error("The operation was aborted due to timeout")),
    );
    assert.deepEqual(await s.service.suggest(URLAP, MEZOK), {
      enabled: true,
      categoryId: null,
    });
    assert.equal(s.sorok[0]?.data.status, "ERROR");
    assert.equal(s.sorok[0]?.exposure, "HIDDEN");
    assert.equal(s.hivasok.length, 1, "az űrlap útján nincs újrapróbálás");
  });

  it("a tároló hibája sem dob: null javaslat", async () => {
    const t = tarolo();
    t.repo.activeCategories = async () => {
      throw new Error("adatbázis nem érhető el");
    };
    const s = szolgaltatas(BE, undefined, t);
    assert.deepEqual(await s.service.suggest(URLAP, MEZOK), {
      enabled: true,
      categoryId: null,
    });
  });

  /** A ROGZITETT MODELL ELTUNESE LEALLITJA A POLICY-T (Q-004 H), jev-latest nincs. */
  it("eltűnt modell: a policy leáll, a következő kérés már nem hív", async () => {
    const s = szolgaltatas(
      BE,
      jev({
        status: 400,
        body: '{"error_type":"api_usage_error","message":"Unknown model: jev-1.13.0"}',
      }),
    );
    await s.service.suggest(URLAP, MEZOK);
    assert.equal(s.service.enabled(), false);
    assert.deepEqual(await s.service.suggest(URLAP, { ...MEZOK, model: "X" }), {
      enabled: false,
      categoryId: null,
    });
    assert.equal(s.hivasok.length, 1);
    assert.doesNotMatch(s.hivasok.join(""), /jev-latest/);
  });
});

describe("a feloldás mentéskor", () => {
  async function mentes(opciok: {
    valasz?: { choice: string; confidence: number };
    urlap?: string;
    mentett?: Record<string, unknown>;
  }) {
    const t = tarolo({ mentett: opciok.mentett });
    const s = szolgaltatas(
      BE,
      jev(opciok.valasz ?? { choice: "cat_lig", confidence: 0.95 }),
      t,
    );
    const urlap = opciok.urlap ?? URLAP;
    await s.service.suggest(urlap, MEZOK);
    await s.service.resolveOnCreate({
      clientOperationId: urlap,
      assetId: "asset1",
    });
    return s.sorok[0] as Sor;
  }
  const MENTETT = {
    name: "BIO/LSS07 Kessil lámpa",
    manufacturer: "Kessil",
    model: null,
    kind: "EQUIPMENT",
    performance: null,
    performanceUnitId: null,
    powerConsumption: null,
    parentAssetId: null,
    departmentId: "d1",
  };

  it("látott és változatlanul mentett: ACCEPTED, az eszközhöz kötve", async () => {
    const run = await mentes({
      mentett: { ...MENTETT, categoryId: "cat_lig" },
    });
    assert.equal(run.resolution, "ACCEPTED");
    assert.equal(run.entityId, "asset1");
    assert.equal(run.data.resolvedValue, "cat_lig");
  });

  it("látott, de mást mentett: OVERRIDDEN", async () => {
    const run = await mentes({
      mentett: { ...MENTETT, categoryId: "cat_avs" },
    });
    assert.equal(run.resolution, "OVERRIDDEN");
  });

  it("rejtett és egyező: SHADOW_MATCH; rejtett és más: SHADOW_MISMATCH", async () => {
    assert.equal(
      (
        await mentes({
          urlap: KONTROLL,
          mentett: { ...MENTETT, categoryId: "cat_lig" },
        })
      ).resolution,
      "SHADOW_MATCH",
    );
    assert.equal(
      (
        await mentes({
          urlap: KONTROLL,
          mentett: { ...MENTETT, categoryId: "cat_avs" },
        })
      ).resolution,
      "SHADOW_MISMATCH",
    );
  });

  it("ha a mentett eszköz vetülete eltér a javaslatétól: STALE", async () => {
    const run = await mentes({
      mentett: { ...MENTETT, model: "más", categoryId: "cat_lig" },
    });
    assert.equal(run.resolution, "STALE");
  });

  it("a feloldás soha nem dob, és a kategóriát nem írja", async () => {
    const t = tarolo();
    t.repo.savedAsset = async () => {
      throw new Error("adatbázis nem érhető el");
    };
    const s = szolgaltatas(BE, undefined, t);
    await s.service.suggest(URLAP, MEZOK);
    await s.service.resolveOnCreate({
      clientOperationId: URLAP,
      assetId: "asset1",
    });
    assert.equal(s.sorok[0]?.entityId, null);
  });

  it("művelet-azonosító nélkül semmi nem történik", async () => {
    const s = szolgaltatas(BE);
    await s.service.resolveOnCreate({
      clientOperationId: undefined,
      assetId: "asset1",
    });
    assert.equal(s.sorok.length, 0);
  });
});

describe("a javaslat-végpont", () => {
  /** A PILOT CSAK A BELSO WEB (P-013): a partner szerviz szerep is `SERVICE_MANAGE`. */
  it("partner felhasználónak 403", async () => {
    const vezerlo = new AssetCategorySuggestionController(
      szolgaltatas(BE).service,
    );
    assert.throws(
      () =>
        vezerlo.suggest({ clientOperationId: URLAP, name: "Lámpa" }, {
          id: "u1",
          role: "PARTNER_SERVICE",
          customerId: "c1",
        } as unknown as AuthenticatedUser),
      ForbiddenException,
    );
  });
});
