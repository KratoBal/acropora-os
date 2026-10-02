import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseRunInput,
  runEnrichmentCli,
  type EnrichmentCliDeps,
} from "./enrichment-run.cli.js";
import type { EnrichmentRunStore } from "./enrichment-run.js";
import {
  fakeClock,
  productPage,
  scriptedNetwork,
} from "./enrichment-test-fixtures.js";

const INPUT = JSON.stringify({
  products: [
    {
      productId: "p-1",
      sources: [
        { kind: "BULK_REEF_SUPPLY", url: "https://www.bulkreefsupply.com/p/1" },
        { kind: "BULK_REEF_SUPPLY", url: "https://masik.example.invalid/p" },
      ],
    },
  ],
});

function deps(env: NodeJS.ProcessEnv = {}, input = INPUT) {
  const network = scriptedNetwork({
    "https://www.bulkreefsupply.com/p/1": {
      status: 200,
      body: productPage({ gtin13: "5901234123457" }),
    },
  });
  const stored: string[] = [];
  const store: EnrichmentRunStore = {
    startRun: async () => {
      stored.push("start");
      return "run-1";
    },
    saveCheck: async () => {
      stored.push("check");
    },
    finishRun: async () => {
      stored.push("finish");
    },
  };
  const clock = fakeClock();
  const value: EnrichmentCliDeps = {
    env,
    readInput: async () => input,
    facts: {
      productFacts: async (id) =>
        id === "p-1"
          ? {
              productId: "p-1",
              name: "Kitalált pumpa",
              brandWebsiteUrl: null,
              unasManufacturerUrl: null,
              current: {},
            }
          : null,
      supplierWebsite: async () => null,
    },
    store,
    actorExists: async (id) => id === "u-1",
    fetch: network.fetch,
    sleep: clock.sleep,
    now: clock.now,
  };
  return { value, network, stored };
}

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    out: {
      stdout: (t: string) => void (stdout += t),
      stderr: (t: string) => void (stderr += t),
    },
    text: () => ({ stdout, stderr }),
  };
}

describe("a kézi indítás parancssora", () => {
  it("--apply nélkül csak tervez: nem megy ki a hálózatra, nem tárol", async () => {
    const d = deps({ JEV_PRODUCT_ENRICHMENT: "review" });
    const c = capture();
    assert.equal(
      await runEnrichmentCli(["--input", "x.json"], c.out, d.value),
      0,
    );
    assert.equal(d.network.requests.length, 0);
    assert.deepEqual(d.stored, []);
    assert.match(
      c.text().stdout,
      /olvasható\s+https:\/\/www\.bulkreefsupply\.com\/p\/1/,
    );
    assert.match(c.text().stdout, /ELUTASÍTVA \(HOST_NOT_ALLOWED\)/);
  });

  it("kikapcsolt kapcsolóval nem fut (1); szereplő nélkül nem fut (2)", async () => {
    const off = deps({});
    assert.equal(
      await runEnrichmentCli(
        ["--input", "x", "--apply", "--actor", "u-1"],
        capture().out,
        off.value,
      ),
      1,
    );
    assert.equal(off.network.requests.length, 0);
    const noActor = deps({ JEV_PRODUCT_ENRICHMENT: "review" });
    assert.equal(
      await runEnrichmentCli(
        ["--input", "x", "--apply", "--actor", "nincs"],
        capture().out,
        noActor.value,
      ),
      2,
    );
    assert.equal(noActor.network.requests.length, 0);
  });

  it("--apply-jal fut, tárol, és jelentést ad", async () => {
    const d = deps({ JEV_PRODUCT_ENRICHMENT: "review" });
    const c = capture();
    assert.equal(
      await runEnrichmentCli(
        ["--input", "x", "--apply", "--actor", "u-1"],
        c.out,
        d.value,
      ),
      0,
    );
    assert.deepEqual(d.stored, ["start", "check", "finish"]);
    assert.match(c.text().stdout, /COMPLETED, 1 termék/);
  });

  it("a korlát elérése 3-as kilépés és kiírt jelzés", async () => {
    const d = deps({ JEV_PRODUCT_ENRICHMENT: "review" });
    const c = capture();
    assert.equal(
      await runEnrichmentCli(
        ["--input", "x", "--apply", "--actor", "u-1", "--max-requests", "1"],
        c.out,
        d.value,
      ),
      3,
    );
    assert.match(c.text().stdout, /KORLÁT ELÉRVE \(lekérésszám\)/);
  });

  it("a korlátok felső határa kötött: teljes katalógusra nem indítható", async () => {
    const c = capture();
    assert.equal(
      await runEnrichmentCli(
        ["--input", "x", "--max-products", "5000"],
        c.out,
        deps().value,
      ),
      2,
    );
    assert.match(c.text().stderr, /1 és 50 közötti/);
  });

  it("a hibás bemenet minden hibáját felsorolja", () => {
    const parsed = parseRunInput(
      JSON.stringify({
        products: [
          { sources: [] },
          {
            productId: "p",
            sources: [
              { kind: "EBAY", url: "x" },
              { kind: "SUPPLIER", url: "https://a.example.invalid" },
            ],
          },
        ],
      }),
    );
    assert.equal(parsed.ok, false);
    assert.equal(!parsed.ok && parsed.problems.length, 3);
  });
});
