import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { FetchLike } from "@acropora/jev";
import type { SupplierLineSuggestionRequest } from "@acropora/types";

import {
  SUPPLIER_LINE_JEV_POLICY,
  decideSupplierLine,
} from "./supplier-line-policy.js";
import type {
  SuggestionProduct,
  SupplierLineSuggestionRepository,
} from "./supplier-line-suggestion.repository.js";
import { SupplierLineSuggestionService } from "./supplier-line-suggestion.service.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const PLUGS: SuggestionProduct = {
  variantId: "v-plugs",
  sku: "ACR-L-000042",
  productName: "Dupla Marin Coral Plugs 10 db",
};
const RACK: SuggestionProduct = {
  variantId: "v-rack",
  sku: "ACR-L-000043",
  productName: "Dupla Marin Coral Rack L",
};
const SCREW: SuggestionProduct = {
  variantId: "v-screw",
  sku: "ACR-L-000044",
  productName: "MF KALAPÁCSFEJŰ CSAVAR 38/40+40/60 M10X50MM FOCUS",
};

const LIVE = {
  JEV_SUPPLIER_LINE_SUGGESTION: "live",
  JEV_SUPPLIER_LINE_SUPPLIER_VAT_IDS: "DE 342032439",
  TYPESAFE_API_KEY: "kulcs-SOHA-NEM-LATSZIK",
} as NodeJS.ProcessEnv;

function fake(options: {
  mapped?: SuggestionProduct | null;
  byEan?: SuggestionProduct | null;
  byCode?: Array<
    SuggestionProduct & { manufacturerPartNumber: string | null; name: string }
  >;
  vatId?: string;
  master?: SuggestionProduct[];
  /** variant id -> short description (HTML), as the product table holds it */
  descriptions?: Record<string, string>;
  runs?: Array<{
    id: string;
    policyKey: string;
    selectedValue: string | null;
    exposure: "HIDDEN" | "SHOWN";
    entityId: string | null;
    resolution: string | null;
  }>;
}) {
  const created: Array<Record<string, unknown>> = [];
  const resolved: Array<{ id: string; data: Record<string, unknown> }> = [];
  const codesAsked: string[][] = [];
  const repository = {
    candidateMaster: async () =>
      (options.master ?? [PLUGS, RACK]).map((product) => ({
        variantId: product.variantId,
        text: product.productName,
        product,
        description: options.descriptions?.[product.variantId] ?? null,
      })),
    supplierVatId: async () => options.vatId ?? "DE342032439",
    mappedProduct: async () => options.mapped ?? null,
    barcodeProduct: async () => options.byEan ?? null,
    productsByCode: async (codes: readonly string[]) => {
      codesAsked.push([...codes]);
      return options.byCode ?? [];
    },
    createRun: async (data: Record<string, unknown>) => {
      created.push(data);
      return { id: `run-${created.length}` };
    },
    runs: async () => options.runs ?? [],
    resolveRun: async (id: string, data: Record<string, unknown>) => {
      resolved.push({ id, data });
    },
  } as unknown as SupplierLineSuggestionRepository;
  return { repository, created, resolved, codesAsked };
}

function jevAnswer(
  choice: string | ((keys: Record<string, string>) => string),
  confidence: number,
) {
  const calls: Array<{ body: string; authorization: string }> = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push({ body: init.body, authorization: init.headers.Authorization! });
    const request = JSON.parse(init.body);
    const criteria = request.questions.match.criteria as Record<string, string>;
    const picked = typeof choice === "function" ? choice(criteria) : choice;
    return {
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            match: {
              choice: picked,
              confidence,
              probabilities: { [picked]: confidence },
            },
          },
          usage: { input_tokens: 900 },
        }),
    };
  };
  return { fetch, calls };
}

/** The key under which Jev saw a product name. */
const keyOf = (name: string) => (criteria: Record<string, string>) =>
  Object.entries(criteria).find(([, value]) => value === name)![0];

const REQUEST: SupplierLineSuggestionRequest = {
  clientOperationId: "op-1",
  lineKey: "import-0-1",
  supplierId: "supplier-hertlein",
  description: "Dupla Marin Coral Plugs 10 St., SB",
  supplierSku: "81593",
  ean: "4011444815934",
};

describe("SupplierLineSuggestionService", () => {
  it("is off unless the switch says live, and then touches nothing", async () => {
    const { repository, created } = fake({ mapped: PLUGS });
    const service = new SupplierLineSuggestionService(
      repository,
      {} as NodeJS.ProcessEnv,
    );
    const result = await service.suggest(REQUEST);
    assert.deepEqual(result, {
      enabled: false,
      decisionRunId: null,
      suggestion: null,
      conflict: false,
      blocked: false,
    });
    assert.equal(created.length, 0);
  });

  it("the supplier mapping comes first, then the EAN, each with its own audit key", async () => {
    const mapping = fake({ mapped: PLUGS, byEan: PLUGS });
    const first = await new SupplierLineSuggestionService(
      mapping.repository,
      LIVE,
    ).suggest(REQUEST);
    assert.equal(first.suggestion?.source, "MAPPING");
    assert.equal(first.suggestion?.variantId, PLUGS.variantId);
    assert.equal(mapping.created[0]!.policyKey, "supplier-line-mapping");
    assert.equal(mapping.created[0]!.exposure, "SHOWN");
    assert.equal(mapping.created[0]!.requestedModel, "deterministic");

    const ean = fake({ byEan: RACK });
    const second = await new SupplierLineSuggestionService(
      ean.repository,
      LIVE,
    ).suggest(REQUEST);
    assert.equal(second.suggestion?.source, "EAN");
    assert.equal(ean.created[0]!.policyKey, "supplier-line-ean");
  });

  it("a mapping and an EAN pointing at two products is a conflict: no suggestion, no Jev", async () => {
    const { repository, created } = fake({ mapped: PLUGS, byEan: RACK });
    const jev = jevAnswer(keyOf(PLUGS.productName), 0.99);
    const result = await new SupplierLineSuggestionService(
      repository,
      LIVE,
      jev.fetch,
    ).suggest(REQUEST);
    assert.equal(result.conflict, true);
    assert.equal(result.suggestion, null);
    assert.equal(jev.calls.length, 0);
    assert.equal(created[0]!.errorCode, "MAPPING_EAN_CONFLICT");
  });

  it("the supplier's code as our SKU or MPN comes after the EAN and before any Jev", async () => {
    const TESTER: SuggestionProduct = {
      variantId: "v-no3po4",
      sku: "ACR-L-000512",
      productName: "Red Sea NO3:PO4-X 1000 ml",
    };
    const { repository, created, codesAsked } = fake({
      byCode: [
        {
          ...TESTER,
          manufacturerPartNumber: "R22204",
          name: TESTER.productName,
        },
      ],
    });
    const jev = jevAnswer(keyOf(PLUGS.productName), 0.99);
    const result = await new SupplierLineSuggestionService(
      repository,
      LIVE,
      jev.fetch,
    ).suggest({
      ...REQUEST,
      description: "RS NO3:PO4-X 1 litre",
      supplierSku: "RS-R22204",
    });
    assert.equal(result.suggestion?.source, "CODE");
    assert.equal(result.suggestion?.variantId, TESTER.variantId);
    assert.equal(result.suggestion?.confidence, null);
    assert.deepEqual(codesAsked, [["RS-R22204", "R22204"]]);
    assert.equal(jev.calls.length, 0);
    assert.equal(created.length, 1);
    assert.equal(created[0]!.policyKey, "supplier-line-code");
    assert.equal(created[0]!.exposure, "SHOWN");
    assert.equal(created[0]!.requestedModel, "deterministic");
    assert.equal(created[0]!.selectedValue, TESTER.variantId);
  });

  it("a code that fits two of our products suggests nothing by itself and leaves it to the Jev", async () => {
    const { repository, created } = fake({
      byCode: [
        { ...PLUGS, manufacturerPartNumber: "81593", name: PLUGS.productName },
        { ...RACK, manufacturerPartNumber: "81593", name: RACK.productName },
      ],
    });
    const jev = jevAnswer(keyOf(PLUGS.productName), 0.99);
    const result = await new SupplierLineSuggestionService(
      repository,
      LIVE,
      jev.fetch,
    ).suggest(REQUEST);
    assert.equal(result.suggestion?.source, "JEV");
    assert.equal(jev.calls.length, 1);
    assert.ok(created.every((run) => run.policyKey !== "supplier-line-code"));
  });

  /*
    A MAGYAR SZALLITO (murena, acrobot 24924, 2026-09-30): a torzsadatban a
    hazai adoszam all ("14116380-2-06"), amibol eddig `null` kulcs lett, es a
    Jev el sem indult, akarmi allt a listaban.
    MI PIROSIT: ha a hazai alak megint nem ad kulcsot, vagy ha a lista a
    torzsszamot nem ugyanarra a cegre erti.
  */
  describe("Hungarian suppliers, by the tax number's base (törzsszám)", () => {
    const HAZAI = "14116380-2-06";
    const env = (list: string) =>
      ({
        ...LIVE,
        JEV_SUPPLIER_LINE_SUPPLIER_VAT_IDS: list,
      }) as NodeJS.ProcessEnv;
    const ask = async (list: string) => {
      const { repository } = fake({ vatId: HAZAI });
      const jev = jevAnswer(keyOf(PLUGS.productName), 0.95);
      await new SupplierLineSuggestionService(
        repository,
        env(list),
        jev.fetch,
      ).suggest(REQUEST);
      return jev.calls.length;
    };

    it("the Jev runs when the list names the supplier in its domestic form", async () => {
      assert.equal(await ask(`DE342032439,${HAZAI}`), 1);
    });

    it("…or as its EU VAT id, or with another VAT or county code", async () => {
      assert.equal(await ask("HU14116380"), 1);
      assert.equal(await ask("14116380-1-41"), 1);
    });

    it("not when the list does not name it (no switch-on by default)", async () => {
      assert.equal(await ask("DE342032439"), 0);
    });
  });

  describe("per supplier, as measured (PD 2026-09-29)", () => {
    const DEJONG = "NL802708705B01";
    const BOTH = {
      ...LIVE,
      JEV_SUPPLIER_LINE_SUPPLIER_VAT_IDS: `DE342032439,${DEJONG}`,
    } as NodeJS.ProcessEnv;
    const DESCRIPTIONS = {
      [PLUGS.variantId]:
        "<p>Kerámia fragtalp&nbsp;10 db,\n korallok rögzítéséhez.</p>",
    };
    const sentCriteria = (calls: Array<{ body: string }>) =>
      Object.values(
        JSON.parse(calls[0]!.body).questions.match.criteria as Record<
          string,
          string
        >,
      );

    it("De Jong: the Jev reads name + description, and the run says so", async () => {
      const { repository, created } = fake({
        vatId: DEJONG,
        descriptions: DESCRIPTIONS,
      });
      const jev = jevAnswer(keyOf(PLUGS.productName), 0.85);
      await new SupplierLineSuggestionService(
        repository,
        BOTH,
        jev.fetch,
      ).suggest(REQUEST);
      const criteria = sentCriteria(jev.calls);
      assert.ok(
        criteria.includes(
          "Dupla Marin Coral Plugs 10 db. Kerámia fragtalp 10 db, korallok rögzítéséhez.",
        ),
      );
      // a product without a description goes by its name, as measured
      assert.ok(criteria.includes(RACK.productName));
      const projection = created[0]!.projectionPayload as {
        data: { criteria?: string };
      };
      assert.equal(projection.data.criteria, "name+description@200");
    });

    it("De Jong shows from 0.80; Hertlein keeps 0.9 and the name alone", async () => {
      // the choice is keyed by the text the Jev saw, so find it by prefix
      const byPrefix = (criteria: Record<string, string>) =>
        Object.entries(criteria).find(([, v]) =>
          v.startsWith(PLUGS.productName),
        )![0];
      const dejong = fake({ vatId: DEJONG, descriptions: DESCRIPTIONS });
      const shown = await new SupplierLineSuggestionService(
        dejong.repository,
        BOTH,
        jevAnswer(byPrefix, 0.85).fetch,
      ).suggest(REQUEST);
      assert.equal(shown.suggestion?.variantId, PLUGS.variantId);

      const hertlein = fake({ descriptions: DESCRIPTIONS });
      const jev = jevAnswer(keyOf(PLUGS.productName), 0.85);
      const hidden = await new SupplierLineSuggestionService(
        hertlein.repository,
        BOTH,
        jev.fetch,
      ).suggest(REQUEST);
      assert.equal(hidden.suggestion, null);
      assert.equal(hertlein.created[0]!.exposure, "HIDDEN");
      // Hertlein was measured by name: the description never reaches the Jev
      assert.ok(sentCriteria(jev.calls).includes(PLUGS.productName));
      assert.equal(
        (
          hertlein.created[0]!.projectionPayload as {
            data: { criteria?: string };
          }
        ).data.criteria,
        undefined,
      );
    });
  });

  it("asks Jev only for a listed supplier, with the measured policy and question key", async () => {
    const other = fake({ vatId: "DE999999999" });
    const silent = jevAnswer(keyOf(PLUGS.productName), 0.99);
    const skipped = await new SupplierLineSuggestionService(
      other.repository,
      LIVE,
      silent.fetch,
    ).suggest(REQUEST);
    assert.equal(skipped.suggestion, null);
    assert.equal(silent.calls.length, 0);

    const { repository, created } = fake({});
    const jev = jevAnswer(keyOf(PLUGS.productName), 0.95);
    const result = await new SupplierLineSuggestionService(
      repository,
      LIVE,
      jev.fetch,
    ).suggest(REQUEST);
    assert.deepEqual(result.suggestion, {
      source: "JEV",
      ...PLUGS,
      confidence: 0.95,
    });
    const body = JSON.parse(jev.calls[0]!.body);
    assert.deepEqual(Object.keys(body.questions), ["match"]);
    assert.equal(body.model, "jev-1.13.0");
    assert.equal(
      body.state,
      `Supplier invoice line from Hertlein Aquaristik (German wording): ${REQUEST.description}`,
    );
    assert.equal(
      body.questions.match.instructions,
      SUPPLIER_LINE_JEV_POLICY.instructions,
    );
    // the candidates go by name under opaque keys; no id, no code, no EAN, no key in the body
    for (const secret of [
      PLUGS.variantId,
      RACK.variantId,
      "81593",
      "4011444815934",
      LIVE.TYPESAFE_API_KEY!,
    ])
      assert.ok(!jev.calls[0]!.body.includes(secret), secret);
    assert.equal(created[0]!.exposure, "SHOWN");
    assert.equal(created[0]!.selectedValue, PLUGS.variantId);
    assert.deepEqual(
      (created[0]!.projectionPayload as { data: { candidates: string[] } }).data
        .candidates.length,
      2,
    );
  });

  it("below 0.9 the run is kept, hidden, and nothing is shown; NONE and AMBIGUOUS never act", async () => {
    for (const [choice, confidence, selected] of [
      [keyOf(PLUGS.productName), 0.8, PLUGS.variantId],
      ["NONE", 0.99, "NONE"],
      [keyOf(PLUGS.productName), 0.6, PLUGS.variantId],
    ] as const) {
      const { repository, created } = fake({});
      const jev = jevAnswer(choice, confidence);
      const result = await new SupplierLineSuggestionService(
        repository,
        LIVE,
        jev.fetch,
      ).suggest(REQUEST);
      assert.equal(result.suggestion, null);
      assert.equal(created[0]!.exposure, "HIDDEN");
      assert.equal(created[0]!.selectedValue, selected);
    }
  });

  it("the personal-data guard stops the call before anything leaves", async () => {
    const { repository, created } = fake({ master: [SCREW, PLUGS] });
    const jev = jevAnswer(keyOf(PLUGS.productName), 0.99);
    const result = await new SupplierLineSuggestionService(
      repository,
      LIVE,
      jev.fetch,
    ).suggest({
      ...REQUEST,
      description: "FIP Schrägsitzventil M10X50MM Coral Plugs",
      ean: undefined,
      supplierSku: undefined,
    });
    assert.equal(result.blocked, true);
    assert.equal(jev.calls.length, 0);
    assert.equal(created[0]!.errorCode, "BLOCKED_INPUT");
  });

  it("a vanished model stops the Jev part until restart", async () => {
    const { repository } = fake({});
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return {
        status: 400,
        headers: { get: () => null },
        text: async () => "Unknown model jev-1.13.0",
      };
    };
    const service = new SupplierLineSuggestionService(repository, LIVE, fetch);
    await service.suggest(REQUEST);
    await service.suggest({ ...REQUEST, lineKey: "import-1-2" });
    assert.equal(calls, 1);
  });

  it("closes each saved line's run: accepted, overridden, shadow, and never twice", async () => {
    const { repository, resolved } = fake({
      runs: [
        {
          id: "r1",
          policyKey: "supplier-line-jev",
          selectedValue: "v-plugs",
          exposure: "SHOWN",
          entityId: null,
          resolution: null,
        },
        {
          id: "r2",
          policyKey: "supplier-line-ean",
          selectedValue: "v-rack",
          exposure: "SHOWN",
          entityId: null,
          resolution: null,
        },
        {
          id: "r3",
          policyKey: "supplier-line-jev",
          selectedValue: "NONE",
          exposure: "HIDDEN",
          entityId: null,
          resolution: null,
        },
        {
          id: "r4",
          policyKey: "supplier-line-jev",
          selectedValue: "v-plugs",
          exposure: "SHOWN",
          entityId: "old",
          resolution: "ACCEPTED",
        },
      ],
    });
    await new SupplierLineSuggestionService(repository, LIVE).resolveForInvoice(
      [
        { decisionRunId: "r1", lineId: "l1", variantId: "v-plugs" },
        { decisionRunId: "r2", lineId: "l2", variantId: "v-plugs" },
        { decisionRunId: "r3", lineId: "l3", variantId: null },
        { decisionRunId: "r4", lineId: "l4", variantId: "v-rack" },
      ],
    );
    assert.deepEqual(
      resolved.map((entry) => [
        entry.id,
        entry.data.resolution,
        entry.data.resolvedValue,
        entry.data.entityId,
      ]),
      [
        ["r1", "ACCEPTED", "v-plugs", "l1"],
        ["r2", "OVERRIDDEN", "v-plugs", "l2"],
        ["r3", "SHADOW_MATCH", "NONE", "l3"],
      ],
    );
  });
});

describe("the frozen p3-final policy", () => {
  it("is the measured text, byte for byte (sha256 of stage-b/policies/p3-final.json)", () => {
    assert.equal(
      sha(SUPPLIER_LINE_JEV_POLICY.stateTemplate),
      "94233f89b6985a909a86b69dea0a3f5711d08b7acf59dfaa5e3a059d5f780416",
    );
    assert.equal(
      sha(SUPPLIER_LINE_JEV_POLICY.instructions),
      "93f34f7d83353c21c3dfaf02cb08c4006d86238d19c67c240b5a60e8eed9b6f5",
    );
    assert.equal(
      sha(SUPPLIER_LINE_JEV_POLICY.noneDescription),
      "78f84f16055d5489a5ab8af17367ffa8e7b83d9a49a24e53a2f328ea581e096f",
    );
    assert.equal(SUPPLIER_LINE_JEV_POLICY.model, "jev-1.13.0");
    assert.equal(SUPPLIER_LINE_JEV_POLICY.minConfidence, 0.7);
  });

  it("decides like Stage B: NONE, AMBIGUOUS under 0.7, MATCH otherwise", () => {
    assert.equal(
      decideSupplierLine({
        choice: "NONE",
        confidence: 0.99,
        probabilities: {},
      }),
      "NONE",
    );
    assert.equal(
      decideSupplierLine({
        choice: "c01",
        confidence: 0.69,
        probabilities: {},
      }),
      "AMBIGUOUS",
    );
    assert.equal(
      decideSupplierLine({ choice: "c01", confidence: 0.7, probabilities: {} }),
      "MATCH",
    );
  });
});
