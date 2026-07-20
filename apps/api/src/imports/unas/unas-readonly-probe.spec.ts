import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { UnasApiCategory, UnasApiProduct } from "@acropora/types";

import type {
  UnasCategoryPageRequest,
  UnasProductPageRequest,
} from "./unas-api.client.js";
import { main, type UnasProbeOutput } from "./unas-readonly-probe.cli.js";
import {
  normalizeUnasProbeError,
  parseUnasProbeOptions,
  runUnasReadonlyProbe,
  type UnasReadonlyProbeClient,
} from "./unas-readonly-probe.js";

const originalApiKey = process.env.UNAS_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.UNAS_API_KEY;
  else process.env.UNAS_API_KEY = originalApiKey;
});

const category = (externalId: string): UnasApiCategory => ({
  externalId,
  name: `sensitive-category-${externalId}`,
  state: "live",
  parentExternalId: null,
  sortOrder: null,
  sourceCreatedAt: null,
  sourceUpdatedAt: "2026-07-01T00:00:00.000Z",
  rawPayload: { secret: "category-payload" },
});

const product = (
  externalId: string,
  state: "live" | "deleted",
): UnasApiProduct => ({
  externalId,
  sku: `sensitive-sku-${externalId}`,
  name: `sensitive-product-${externalId}`,
  state,
  externalStatus: null,
  sourceCreatedAt: null,
  sourceUpdatedAt: "2026-07-02T00:00:00.000Z",
  descriptionShort: null,
  descriptionLong: null,
  descriptionShortIsHtml: null,
  descriptionLongIsHtml: null,
  unit: null,
  secondaryUnit: "box",
  secondaryUnitFactor: null,
  manufacturerPartNumber: null,
  brandName: null,
  vatRate: null,
  netPrice: null,
  grossPrice: "100",
  saleNetPrice: null,
  saleGrossPrice: null,
  saleStartsAt: null,
  saleEndsAt: null,
  priceDisplay: null,
  minimumOrderQuantity: null,
  maximumOrderQuantity: null,
  lowStockThreshold: null,
  orderQuantityStep: null,
  backorderAllowed: null,
  variantStockEnabled: null,
  reportedStock: "2",
  productUrl: `https://sensitive.example/${externalId}`,
  sefUrl: null,
  manufacturerUrl: null,
  primaryCategoryExternalId: "10",
  alternativeCategoryExternalIds: [],
  images: [],
  parameters: [],
  seo: { title: null, description: null, keywords: null, robots: null },
  rawPayload: { secret: "product-payload" },
});

class FakeClient implements UnasReadonlyProbeClient {
  readonly calls: Array<{
    operation: "login" | "category" | "product";
    request?: UnasCategoryPageRequest | UnasProductPageRequest;
  }> = [];

  login(apiKey: string) {
    assert.equal(apiKey, "environment-only-key");
    this.calls.push({ operation: "login" });
    return Promise.resolve({
      token: "sensitive-token",
      expireTime: 2_000_000_000,
    });
  }

  getCategoryPage(_token: string, request: UnasCategoryPageRequest) {
    this.calls.push({ operation: "category", request });
    return Promise.resolve(
      request.limitStart === 0 ? [category("1"), category("2")] : [],
    );
  }

  getProductPage(_token: string, request: UnasProductPageRequest) {
    this.calls.push({ operation: "product", request });
    return Promise.resolve(
      request.limitStart === 0
        ? [product(request.state === "deleted" ? "4" : "3", request.state!)]
        : [],
    );
  }
}

describe("UNAS read-only probe", () => {
  it("uses bounded read calls and emits only aggregate structural data", async () => {
    process.env.UNAS_API_KEY = " environment-only-key ";
    const client = new FakeClient();
    const times = [100, 125];
    const result = await runUnasReadonlyProbe(
      client,
      {
        pageSize: 2,
        pages: 2,
      },
      () => times.shift()!,
    );

    assert.deepEqual(
      client.calls.map((call) => [
        call.operation,
        call.request?.limitStart,
        call.request && "state" in call.request
          ? call.request.state
          : undefined,
      ]),
      [
        ["login", undefined, undefined],
        ["category", 0, undefined],
        ["category", 2, undefined],
        ["product", 0, "live"],
        ["product", 0, "deleted"],
      ],
    );
    assert.deepEqual(result.counts, { category: 2, live: 1, deleted: 1 });
    assert.deepEqual(result.fieldPresence.price, { live: 1, deleted: 1 });
    assert.deepEqual(result.sourceModifiedAt, {
      minimum: "2026-07-01T00:00:00.000Z",
      maximum: "2026-07-02T00:00:00.000Z",
    });
    assert.equal(result.durationMs, 25);
    const output = JSON.stringify(result);
    for (const forbidden of [
      "environment-only-key",
      "sensitive-token",
      "sensitive-product",
      "sensitive-sku",
      "sensitive.example",
      "payload",
    ]) {
      assert.equal(output.includes(forbidden), false);
    }
  });

  it("fails in a controlled way when UNAS_API_KEY is missing", async () => {
    delete process.env.UNAS_API_KEY;
    const client = new FakeClient();
    await assert.rejects(
      () => runUnasReadonlyProbe(client, { pageSize: 10, pages: 1 }),
      { message: "UNAS_PROBE_API_KEY_MISSING" },
    );
    assert.deepEqual(client.calls, []);
  });

  it("normalizes upstream errors without exposing their content", async () => {
    process.env.UNAS_API_KEY = "environment-only-key";
    const client = new FakeClient();
    client.getProductPage = () =>
      Promise.reject(new Error("raw secret response and sensitive URL"));
    let caught: unknown;
    try {
      await runUnasReadonlyProbe(client, { pageSize: 10, pages: 1 });
    } catch (error) {
      caught = error;
    }
    assert.equal(normalizeUnasProbeError(caught), "UNAS_PROBE_LIVE_FAILED");
    assert.equal(String(caught).includes("raw secret response"), false);
  });

  it("keeps CLI stdout and stderr free of source and credential data", async () => {
    process.env.UNAS_API_KEY = "environment-only-key";
    const values = { stdout: "", stderr: "" };
    const output: UnasProbeOutput = {
      stdout: (value) => {
        values.stdout += value;
      },
      stderr: (value) => {
        values.stderr += value;
      },
    };

    const successCode = await main([], new FakeClient(), output);
    assert.equal(successCode, 0);
    assert.equal(values.stderr, "");
    assert.deepEqual(JSON.parse(values.stdout), {
      ok: true,
      counts: { category: 2, live: 1, deleted: 1 },
      fieldPresence: {
        stableId: { category: 2, live: 1, deleted: 1 },
        lastModTime: { category: 2, live: 1, deleted: 1 },
        price: { live: 1, deleted: 1 },
        reportedStock: { live: 1, deleted: 1 },
        secondaryUnit: { live: 1, deleted: 1 },
        categoryFields: { live: 1, deleted: 1 },
      },
      sourceModifiedAt: {
        minimum: "2026-07-01T00:00:00.000Z",
        maximum: "2026-07-02T00:00:00.000Z",
      },
      durationMs: JSON.parse(values.stdout).durationMs,
    });

    const forbiddenValues = [
      "environment-only-key",
      "sensitive-token",
      "sensitive-product",
      "sensitive-sku",
      "sensitive.example",
      "product-payload",
      "externalId",
    ];
    for (const forbidden of forbiddenValues) {
      assert.equal(values.stdout.includes(forbidden), false);
      assert.equal(values.stderr.includes(forbidden), false);
    }

    values.stdout = "";
    values.stderr = "";
    const failingClient = new FakeClient();
    failingClient.getCategoryPage = () =>
      Promise.reject(
        new Error(
          "UNAS XML Error: secret-key sensitive-token <Error>raw response body</Error>",
        ),
      );
    const failureCode = await main([], failingClient, output);
    assert.equal(failureCode, 1);
    assert.equal(values.stdout, "");
    assert.equal(
      values.stderr,
      '{"ok":false,"errorCode":"UNAS_PROBE_CATEGORY_FAILED"}\n',
    );
  });

  it("enforces the default and hard pagination bounds", () => {
    assert.deepEqual(parseUnasProbeOptions([]), { pageSize: 10, pages: 1 });
    assert.deepEqual(
      parseUnasProbeOptions(["--page-size=100", "--pages", "2"]),
      {
        pageSize: 100,
        pages: 2,
      },
    );
    assert.throws(() => parseUnasProbeOptions(["--page-size", "101"]), {
      message: "UNAS_PROBE_INVALID_ARGUMENT",
    });
    assert.throws(() => parseUnasProbeOptions(["--pages=3"]), {
      message: "UNAS_PROBE_INVALID_ARGUMENT",
    });
  });
});
