import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssetCategoryProjectionInput } from "./asset-category-projection.js";
import type { CategoryOption, GoldenItem } from "./evaluation.js";
import type { FetchLike } from "./jev-client.js";
import {
  ASSET_CATEGORY_POLICY,
  choiceCriteria,
  modelState,
  optionsHash,
  reportMarkdown,
  runAssetCategoryEvaluation,
} from "./run.js";

const KULCS = "titkos-kulcs-SOHA-NEM-LATSZIK";

const KATEGORIAK: CategoryOption[] = [
  { id: "c_szivattyu", name: "Szivattyú", code: "SZI" },
  { id: "c_lampa", name: "Lámpa", code: "LAM" },
];

const ESZKOZOK: Record<string, AssetCategoryProjectionInput> = {
  a1: {
    name: "BIO/LSS07 Keringető szivattyú II.",
    manufacturer: "Tunze",
    departmentPath: ["BIO", "LSS07"],
    parentCategory: "Szűrési rendszer",
  },
  a2: { name: "AKV/A11 Lámpa", departmentPath: ["FAN", "AKV", "A11"] },
};

/** A nem sikeres eredmeny hibakodja, vagy `null`. */
function hibakod(result: { ok: boolean } | undefined): string | null {
  return result && !result.ok && "errorCode" in result
    ? (result as { errorCode: string }).errorCode
    : null;
}

const arany = (id: string, kat: string | null, unres = false): GoldenItem => ({
  assetId: id,
  primary: kat,
  accepted: new Set(kat ? [kat] : []),
  unresolvable: unres,
});

/** A dupla a `state` alapjan valaszol: ami szivattyu, azt oda sorolja. */
function jevDupla(opciok: { unknownModel?: boolean } = {}) {
  const allapotok: string[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body) as { state: string; model: string };
    allapotok.push(body.state);
    if (opciok.unknownModel)
      return {
        status: 400,
        headers: { get: () => null },
        text: async () =>
          '{"error_type":"api_usage_error","message":"Unknown model: jev-1.13.0"}',
      };
    const choice = body.state.includes("szivattyú") ? "c_szivattyu" : "c_lampa";
    return {
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          model: body.model,
          answers: {
            q: {
              choice,
              confidence: 0.95,
              probabilities: { [choice]: 0.95 },
            },
          },
          usage: { input_tokens: 100 },
        }),
    };
  };
  return { fetch, allapotok };
}

async function futtat(golden: GoldenItem[], jev = jevDupla()) {
  const report = await runAssetCategoryEvaluation({
    golden,
    categories: KATEGORIAK,
    loadAsset: async (id) => ESZKOZOK[id] ?? null,
    apiKey: KULCS,
    client: { fetch: jev.fetch, sleep: async () => undefined },
    concurrency: 1,
    now: () => new Date("2026-09-28T12:00:00.000Z"),
  });
  return { report, jev };
}

describe("a V0 kiértékelés futtatása", () => {
  it("a modell a tisztított vetületet látja: előtag, sorszám és részleg-kód nélkül", async () => {
    const { jev } = await futtat([
      arany("a1", "c_szivattyu"),
      arany("a2", "c_lampa"),
    ]);
    assert.deepEqual(jev.allapotok, [
      '{"manufacturer": "Tunze", "name": "Keringető szivattyú", "resze_ennek": "Ez az eszköz egy nagyobb egység ALKATRÉSZE; a befoglaló egység kategóriája: Szűrési rendszer. A kérdés az ALKATRÉSZ saját kategóriája."}',
      '{"name": "Lámpa"}',
    ]);
    for (const allapot of jev.allapotok)
      assert.doesNotMatch(allapot, /BIO|LSS07|AKV|A11|FAN/);
  });

  it("a riport: mérőszámok, hash, előtag-szabály, és a kulcs sehol", async () => {
    const { report } = await futtat([
      arany("a1", "c_szivattyu"),
      arany("a2", "c_lampa"),
    ]);
    assert.equal(report.metrics.overallAgreement, 1);
    assert.equal(report.stoppedReason, null);
    assert.equal(report.respondedModelMismatches, 0);
    assert.deepEqual(report.prefixRules, {
      department: 2,
      pattern: 0,
      none: 0,
    });
    assert.match(
      report.items[0]?.projectionHash ?? "",
      /^cph1:sha256:[0-9a-f]{64}$/,
    );
    assert.doesNotMatch(JSON.stringify(report), new RegExp(KULCS));
    const md = reportMarkdown(
      report,
      (id) => KATEGORIAK.find((k) => k.id === id)?.name ?? id,
    );
    assert.match(md, /jev-1\.13\.0/);
    assert.doesNotMatch(md, new RegExp(KULCS));
  });

  /**
   * A ROGZITETT MODELL ELTUNESE MEGALLITJA A FUTAST (Q-004 H), es a meg nem
   * futott elemek NEM szamitanak szolgaltatoi hibanak -- kulonben a riport egy
   * 100%-os hibaaranyt mutatna egy megallitott futasrol.
   */
  it("eltűnt modellnél megáll, és a nem futott elem nem szolgáltatói hiba", async () => {
    const { report, jev } = await futtat(
      [arany("a1", "c_szivattyu"), arany("a2", "c_lampa")],
      jevDupla({ unknownModel: true }),
    );
    assert.match(report.stoppedReason ?? "", /jev-1\.13\.0/);
    assert.equal(jev.allapotok.length, 1);
    assert.equal(report.items[1]?.result.ok, false);
    assert.equal(hibakod(report.items[1]?.result), "NOT_RUN");
    assert.equal(report.metrics.items, 1);
  });

  it("a nem található eszköz nem kerül a mérőszámokba", async () => {
    const { report } = await futtat([
      arany("a1", "c_szivattyu"),
      arany("nincs", "c_lampa"),
    ]);
    assert.equal(hibakod(report.items[1]?.result), "ASSET_NOT_FOUND");
    assert.equal(report.metrics.items, 1);
  });
});

describe("a policy és az opciók", () => {
  /**
   * @2: A POLICY BETURE A MERT HIVAS (acrobot A/B, 2026-09-28). Ezek a szovegek
   * a mert eredmeny reszei; atirasuk uj meres es uj policy-verzio.
   */
  it("a policy @2 a mért utasítást és NONE-leírást viszi", () => {
    assert.equal(ASSET_CATEGORY_POLICY.version, 2);
    assert.equal(
      ASSET_CATEGORY_POLICY.instructions,
      "Melyik eszköz-kategóriába tartozik ez az akvárium- vagy vízgépészeti eszköz?",
    );
    assert.equal(
      ASSET_CATEGORY_POLICY.noneDescription,
      "Nem sorolhato be ebbol az adatbol",
    );
    assert.equal(
      ASSET_CATEGORY_POLICY.projectionSchema,
      "service-assets.asset-category@2",
    );
  });

  it("a state a Python json.dumps alakja: rendezett kulcs, vessző-szóköz, kettőspont-szóköz, nyers ékezet", () => {
    assert.equal(
      modelState({ b: "ő", a: ["x", 1], c: { z: null } }),
      '{"a": ["x", 1], "b": "ő", "c": {"z": null}}',
    );
  });

  it("a modell rögzített, nem jev-latest", () => {
    assert.equal(ASSET_CATEGORY_POLICY.model, "jev-1.13.0");
    assert.notEqual(ASSET_CATEGORY_POLICY.model, "jev-latest");
  });

  it("az opciók: minden kategória azonosítóval, plusz NONE", () => {
    assert.deepEqual(Object.keys(choiceCriteria(KATEGORIAK)), [
      "c_szivattyu",
      "c_lampa",
      "NONE",
    ]);
  });

  it("az opciók hash-e a sorrendtől független, a névtől nem", () => {
    assert.equal(
      optionsHash(KATEGORIAK),
      optionsHash([...KATEGORIAK].reverse()),
    );
    assert.notEqual(
      optionsHash(KATEGORIAK),
      optionsHash([{ ...KATEGORIAK[0]!, name: "Szivattyúk" }, KATEGORIAK[1]!]),
    );
  });
});
