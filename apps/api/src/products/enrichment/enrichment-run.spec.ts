import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHALLENGE_PAGE,
  fakeClock,
  productPage,
  scriptedNetwork,
  type ScriptedAnswer,
} from "./enrichment-test-fixtures.js";
import {
  runEnrichment,
  type EnrichmentRunStore,
  type ProductFacts,
  type RunProductInput,
  type StoredCheck,
} from "./enrichment-run.js";

const BRS = "https://www.bulkreefsupply.com";
const MA = "https://marine-aquatics.eu";
const MAKER = "https://gyarto.example.invalid";

/** Invented product facts. */
const facts = (over: Partial<ProductFacts> = {}): ProductFacts => ({
  productId: "p-1",
  name: "Kitalált pumpa",
  brandWebsiteUrl: null,
  unasManufacturerUrl: null,
  current: { title: "Kitalált pumpa", ean: "5901234123457" },
  ...over,
});

function memoryStore() {
  const runs: {
    id: string;
    status?: string;
    productCount?: number;
    requestCount?: number;
    errorCode?: string | null;
  }[] = [];
  const checks: StoredCheck[] = [];
  const store: EnrichmentRunStore = {
    startRun: async () => {
      runs.push({ id: `run-${runs.length + 1}` });
      return runs.at(-1)!.id;
    },
    saveCheck: async (_runId, check) => {
      checks.push(check);
    },
    finishRun: async (runId, result) => {
      Object.assign(
        runs.find((r) => r.id === runId)!,
        result,
      );
    },
  };
  return { store, runs, checks };
}

async function run(
  products: RunProductInput[],
  table: Record<string, ScriptedAnswer>,
  options: {
    facts?: Record<string, ProductFacts>;
    productLimit?: number;
    requestLimit?: number;
    suppliers?: Record<string, string>;
  } = {},
) {
  const network = scriptedNetwork(table);
  const clock = fakeClock();
  const memory = memoryStore();
  const summary = await runEnrichment(
    products,
    {
      requestedById: "u-1",
      productLimit: options.productLimit ?? 20,
      requestLimit: options.requestLimit ?? 200,
    },
    {
      store: memory.store,
      facts: {
        productFacts: async (id) =>
          (options.facts ?? { "p-1": facts() })[id] ?? null,
        supplierWebsite: async (id) => options.suppliers?.[id] ?? null,
      },
      fetch: network.fetch,
      sleep: clock.sleep,
      now: clock.now,
    },
  );
  return { summary, network, ...memory };
}

describe("egy kézi futás, árnyékban", () => {
  it("két független forrás egyezik: ellenőrzött; eltérnek: ütközés, forrással, URL-lel, idővel, bizonyítékkal", async () => {
    const { summary, checks, runs } = await run(
      [
        {
          productId: "p-1",
          sources: [
            { kind: "BULK_REEF_SUPPLY", url: `${BRS}/p/1` },
            { kind: "MARINE_AQUATICS", url: `${MA}/p/1` },
          ],
        },
      ],
      {
        [`${BRS}/p/1`]: {
          status: 200,
          body: productPage({
            gtin13: "5901234123457",
            additionalProperty: [
              { name: "Flow rate", value: 3000, unitText: "l/h" },
            ],
          }),
        },
        [`${MA}/p/1`]: {
          status: 200,
          body: productPage({
            gtin13: "5901234123457",
            additionalProperty: [
              { name: "Flow rate", value: 2500, unitText: "l/h" },
            ],
          }),
        },
      },
    );
    assert.equal(summary.status, "COMPLETED");
    assert.equal(runs[0]!.status, "COMPLETED");
    const fields = Object.fromEntries(
      checks[0]!.fields.map((f) => [f.field, f]),
    );
    assert.equal(fields.ean!.status, "VERIFIED");
    assert.equal(fields.ean!.sourceRef, `${BRS}/p/1`);
    assert.equal(fields.flowRate!.status, "CONFLICTING_SOURCES");
    assert.equal(fields.flowRate!.value, null, "no silent winner");
    const evidence = fields.ean!.evidence.find(
      (e) => e.sourceKind === "BULK_REEF_SUPPLY",
    )!;
    assert.equal(evidence.sourceRef, `${BRS}/p/1`);
    assert.ok(evidence.retrievedAt);
    assert.match(evidence.excerpt!, /gtin13/);
    // our own value alone is never "verified" by itself
    assert.equal(fields.title!.status, "UNVERIFIED");
    assert.equal(fields.weight!.status, "MISSING");
    assert.equal(checks[0]!.sourceCount, 2);
  });

  // PD-013 calibration: a URL outside the four sources is refused, never requested.
  it("a négy forráson kívüli URL-t elutasítja, és le sem kéri", async () => {
    const { checks, network } = await run(
      [
        {
          productId: "p-1",
          sources: [
            {
              kind: "BULK_REEF_SUPPLY",
              url: "https://masik-bolt.example.invalid/p",
            },
          ],
        },
      ],
      {},
    );
    assert.deepEqual(
      checks[0]!.fetches.map((f) => [f.outcome, f.reason]),
      [["REFUSED", "HOST_NOT_ALLOWED"]],
    );
    assert.equal(network.requests.length, 0);
  });

  // PD-013 calibration: a refusing or captcha page is an "unavailable" source.
  it("elutasító vagy captchás oldal: nem elérhető forrás, a futás megy tovább, a mező nem üres érték", async () => {
    const { summary, checks } = await run(
      [
        {
          productId: "p-1",
          sources: [
            { kind: "BULK_REEF_SUPPLY", url: `${BRS}/p/1` },
            { kind: "MARINE_AQUATICS", url: `${MA}/p/1` },
          ],
        },
      ],
      {
        [`${BRS}/p/1`]: { status: 200, body: CHALLENGE_PAGE },
        [`${MA}/p/1`]: { status: 403 },
      },
    );
    assert.equal(summary.status, "COMPLETED");
    assert.deepEqual(
      checks[0]!.fetches.map((f) => [f.outcome, f.reason]),
      [
        ["UNAVAILABLE", "CHALLENGE"],
        ["UNAVAILABLE", "HTTP_403"],
      ],
    );
    const ean = checks[0]!.fields.find((f) => f.field === "ean")!;
    assert.equal(
      ean.status,
      "UNVERIFIED",
      "our own value stays; nothing is invented",
    );
    assert.equal(ean.value, null);
  });

  it("a UNAS gyártói linkje magától forrás lesz, a gyártó saját oldalaként", async () => {
    const { checks } = await run(
      [{ productId: "p-1", sources: [] }],
      {
        [`${MAKER}/p/1`]: {
          status: 200,
          body: productPage({ gtin13: "5901234123457" }),
        },
      },
      { facts: { "p-1": facts({ unasManufacturerUrl: `${MAKER}/p/1` }) } },
    );
    assert.deepEqual(
      checks[0]!.fetches.map((f) => [f.sourceKind, f.outcome]),
      [["MANUFACTURER", "FETCHED"]],
    );
    assert.equal(
      checks[0]!.fields.find((f) => f.field === "ean")!.sourceType,
      "MANUFACTURER_PAGE",
    );
  });

  // PD-013 calibration: reaching the limit stops the run and says so.
  it("a lekérés-korlátnál a futás megáll, jelzi, és a félbe maradt terméket nem tárolja", async () => {
    const two = { "p-1": facts(), "p-2": facts({ productId: "p-2" }) };
    const { summary, checks, runs, network } = await run(
      [
        {
          productId: "p-1",
          sources: [{ kind: "BULK_REEF_SUPPLY", url: `${BRS}/p/1` }],
        },
        {
          productId: "p-2",
          sources: [{ kind: "BULK_REEF_SUPPLY", url: `${BRS}/p/2` }],
        },
      ],
      {
        [`${BRS}/p/1`]: { status: 200, body: productPage({}) },
        [`${BRS}/p/2`]: { status: 200, body: productPage({}) },
      },
      { facts: two, requestLimit: 2 },
    );
    assert.equal(summary.status, "LIMIT_REACHED");
    assert.equal(summary.limit, "REQUESTS");
    assert.deepEqual(
      checks.map((c) => c.productId),
      ["p-1"],
    );
    assert.equal(runs[0]!.status, "LIMIT_REACHED");
    assert.equal(runs[0]!.errorCode, "REQUESTS_LIMIT_REACHED");
    assert.equal(network.requests.length, 2);
  });

  it("a termék-korlátnál is megáll és jelzi", async () => {
    const two = { "p-1": facts(), "p-2": facts({ productId: "p-2" }) };
    const { summary } = await run(
      [
        { productId: "p-1", sources: [] },
        { productId: "p-2", sources: [] },
      ],
      {},
      { facts: two, productLimit: 1 },
    );
    assert.deepEqual(
      [summary.status, summary.limit, summary.productCount],
      ["LIMIT_REACHED", "PRODUCTS", 1],
    );
  });

  it("ismeretlen terméknél el sem indul: nincs futás-sor, nincs lekérés", async () => {
    const memory = memoryStore();
    const network = scriptedNetwork({});
    await assert.rejects(() =>
      runEnrichment(
        [{ productId: "nincs", sources: [] }],
        { requestedById: "u-1", productLimit: 20, requestLimit: 200 },
        {
          store: memory.store,
          facts: {
            productFacts: async () => null,
            supplierWebsite: async () => null,
          },
          fetch: network.fetch,
          sleep: async () => {},
          now: () => new Date(),
        },
      ),
    );
    assert.equal(memory.runs.length, 0);
    assert.equal(network.requests.length, 0);
  });

  it("a futás tárolója csak az ellenőrzés tábláit írja: termékhez nincs út", () => {
    const source = readFileSync(
      "src/products/enrichment/enrichment-run.store.ts",
      "utf8",
    );
    const writes = [
      ...source.matchAll(
        /prisma\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g,
      ),
    ].map((m) => m[1]);
    assert.ok(writes.length > 0, "the file was read");
    assert.deepEqual([...new Set(writes)].sort(), [
      "productEnrichmentRun",
      "productEnrichmentRunProduct",
    ]);
    assert.ok(
      !/\$executeRaw|\$queryRaw/.test(source),
      "no raw SQL in the store",
    );
  });
});
