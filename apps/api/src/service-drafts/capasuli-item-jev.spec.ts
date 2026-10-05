import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FetchLike } from "@acropora/jev";

import {
  capasuliThreshold,
  DEFAULT_CAPASULI_THRESHOLD,
  draftFilterState,
} from "./capasuli-filter.js";
import {
  CapasuliItemJevService,
  type CapasuliRunStore,
  type StoredRun,
} from "./capasuli-item-jev.service.js";

/**
 * A CÁPASULI JEV-SZŰRÉS (Balázs, 2026-10-05; brief: exchange/capasuli-jev-
 * szures-2026-10-05.md). Kitalált nevek és címek.
 *
 * MI PIROSÍT: ha egy biztosan nem nekünk szóló tétel látszik, vagy egy
 * bizonytalan eltűnik; ha a Jev hibája elveszít egy tételt; ha e-mail-cím megy
 * ki; ha kikapcsolva is hív; ha ugyanarra kétszer hív; ha a mérő hívás (record:
 * false) bármit ír.
 */
describe("a tétel sorsa a besorolásból", () => {
  it("a mátrix: nincs, nekünk szól, nem nekünk, nem hiba, küszöb alatt", () => {
    const t = 0.7;
    assert.equal(draftFilterState(null, t), "UNFILTERED");
    assert.equal(
      draftFilterState({ kind: "OUR_TECHNICAL_FAULT", confidence: 0.9 }, t),
      "PASSED",
    );
    assert.equal(
      draftFilterState({ kind: "NOT_OURS", confidence: 0.9 }, t),
      "FILTERED",
    );
    assert.equal(
      draftFilterState({ kind: "NOT_A_FAULT", confidence: 0.7 }, t),
      "FILTERED",
    );
    assert.equal(
      draftFilterState({ kind: "NOT_OURS", confidence: 0.69 }, t),
      "UNCERTAIN",
    );
    assert.equal(
      draftFilterState({ kind: "OUR_TECHNICAL_FAULT", confidence: 0.4 }, t),
      "UNCERTAIN",
    );
  });

  it("a küszöb a környezetből; rossz értékre az alapérték, sosem 0", () => {
    assert.equal(capasuliThreshold("0.85"), 0.85);
    assert.equal(capasuliThreshold("0,85"), 0.85);
    for (const raw of [undefined, "", "abc", "0", "-1", "1.5"])
      assert.equal(capasuliThreshold(raw), DEFAULT_CAPASULI_THRESHOLD);
  });
});

const ITEM = {
  source: "CAPASULI_DAILY_REPORT",
  mailbox: "balazs@acropora.hu",
  reportDate: "2026-09-24",
  fingerprint: "fp-1",
};
const TEXT =
  "Kovács Péter (kovacs.peter@zoobudapest.com): a bioszűrő felnyomó motorja leesett.";

function valasz(choice: string, confidence: number) {
  return JSON.stringify({
    model: "jev-1.13.0",
    answers: {
      kind: {
        type: "choice",
        choice,
        confidence,
        probabilities: { [choice]: confidence },
      },
    },
    usage: { input_tokens: 120, output_tokens: 10 },
  });
}

function setup(
  env: Record<string, string>,
  responses: { status: number; body: string }[],
) {
  const bodies: string[] = [];
  let i = 0;
  const fetch: FetchLike = async (_url, init) => {
    bodies.push(String(init.body));
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return {
      status: r.status,
      headers: { get: () => null },
      text: async () => r.body,
    };
  };
  const runs: (StoredRun & { key: string })[] = [];
  const keyOf = (k: Record<string, unknown>) =>
    JSON.stringify([k.entityId, k.projectionHash, k.policyKey]);
  const store: CapasuliRunStore = {
    findRun: async (key) =>
      runs.find((r) => r.key === keyOf(key as Record<string, unknown>)) ?? null,
    createRun: async (data) => {
      const run = {
        id: `run-${runs.length + 1}`,
        status: data.status as "OK" | "ERROR",
        selectedValue: (data.selectedValue as string | null) ?? null,
        confidence: (data.confidence as number | null) ?? null,
        key: keyOf(data as unknown as Record<string, unknown>),
      };
      runs.push(run);
      return run;
    },
  };
  const service = new CapasuliItemJevService(env, fetch, store);
  return { service, bodies, runs };
}

const LIVE = { JEV_CAPASULI_FILTER: "live", TYPESAFE_API_KEY: "kulcs" };

describe("a Cápasuli tétel besorolása", () => {
  it("kikapcsolva nem hív, és a tétel szűretlen marad", async () => {
    const { service, bodies } = setup({ TYPESAFE_API_KEY: "kulcs" }, [
      { status: 200, body: valasz("NOT_OURS", 0.99) },
    ]);
    const filter = await service.filterFor(ITEM, TEXT);
    assert.equal(filter.filterState, "UNFILTERED");
    assert.equal(bodies.length, 0);
  });

  it("bekapcsolva egyszer hív, az e-mail nem megy ki, a név igen; ugyanarra nem hív újra", async () => {
    const { service, bodies, runs } = setup(LIVE, [
      { status: 200, body: valasz("OUR_TECHNICAL_FAULT", 0.93) },
    ]);
    const first = await service.filterFor(ITEM, TEXT);
    assert.deepEqual(first, {
      filterState: "PASSED",
      jevClass: "OUR_TECHNICAL_FAULT",
      jevConfidence: 0.93,
      decisionRunId: "run-1",
    });
    assert.equal(bodies.length, 1);
    assert.doesNotMatch(bodies[0]!, /@/);
    assert.match(bodies[0]!, /Kovács Péter/);
    assert.equal(runs.length, 1);

    const second = await service.filterFor(ITEM, TEXT);
    assert.equal(second.decisionRunId, "run-1");
    assert.equal(bodies.length, 1);
  });

  it("a Jev hibája nem veszít tételt: szűretlenül látszik", async () => {
    const { service } = setup(LIVE, [{ status: 500, body: "{}" }]);
    const filter = await service.filterFor(ITEM, TEXT);
    assert.equal(filter.filterState, "UNFILTERED");
    assert.equal(filter.jevClass, null);
  });

  it("az eltűnt modell leállítja a szűrést a folyamat végéig", async () => {
    const { service, bodies } = setup(LIVE, [
      {
        status: 400,
        body: '{"error_type":"api_usage_error","message":"Unknown model: jev-1.13.0"}',
      },
    ]);
    await service.filterFor(ITEM, TEXT);
    assert.equal(service.enabled(), false);
    await service.filterFor({ ...ITEM, fingerprint: "fp-2" }, TEXT);
    assert.equal(bodies.length, 1);
  });

  it("a mérő hívás (record: false, force) a kapcsolótól függetlenül hív, és semmit nem ír", async () => {
    const { service, bodies, runs } = setup({ TYPESAFE_API_KEY: "kulcs" }, [
      { status: 200, body: valasz("NOT_OURS", 0.88) },
    ]);
    const verdict = await service.classify(ITEM, TEXT, {
      record: false,
      force: true,
    });
    assert.deepEqual(verdict, {
      kind: "NOT_OURS",
      confidence: 0.88,
      decisionRunId: null,
    });
    assert.equal(bodies.length, 1);
    assert.equal(runs.length, 0);
  });
});
