import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  knowledgeProjection,
  type CopyRow,
  type FactRow,
  type KnowledgeProjection,
} from "../../products/knowledge/knowledge.policy.js";
import {
  MedusaProductKnowledgeService,
  knowledgeRowsFor,
} from "./medusa-product-knowledge.service.js";

/** Invented ids and values only. */
const FACTS: FactRow[] = [
  {
    field: "dosing",
    value: null,
    unit: null,
    status: "CONFLICTING_SOURCES",
    revision: 1,
    sourceType: null,
  },
  {
    field: "packSize",
    value: "100 ml",
    unit: null,
    status: "VERIFIED",
    revision: 1,
    sourceType: "MANUFACTURER_PAGE",
  },
];
const COPY: CopyRow[] = [
  {
    block: "lead",
    body: "Bevezető.",
    status: "APPROVED",
    revision: 2,
    basedOn: { dosing: 1, packSize: 1 },
  },
];

function fakes(current: KnowledgeProjection | null, linked = true) {
  const writes: { id: string; body: KnowledgeProjection }[] = [];
  const reads: string[] = [];
  const service = new MedusaProductKnowledgeService(
    {
      findByProductId: async () =>
        linked ? ({ medusaProductId: "prod_kitalalt" } as never) : null,
    },
    {
      fetchProductKnowledge: async (id) => {
        reads.push(id);
        return current;
      },
      setProductKnowledge: async (id, body) => {
        writes.push({ id, body });
        return body;
      },
    },
  );
  return { service, writes, reads };
}

describe("the product knowledge projection, OS -> Medusa", () => {
  it("writes the contract body: the conflict with a null value, the approved lead", async () => {
    const { service, writes } = fakes(null);
    const outcome = await service.project(
      "p-kz",
      { facts: FACTS, copy: COPY },
      true,
    );
    assert.equal(outcome.action, "applied");
    assert.deepEqual(writes, [
      {
        id: "prod_kitalalt",
        body: {
          facts: [
            {
              field: "dosing",
              value: null,
              unit: null,
              status: "CONFLICTING_SOURCES",
              source_type: null,
              revision: 1,
            },
            {
              field: "packSize",
              value: "100 ml",
              unit: null,
              status: "VERIFIED",
              source_type: "MANUFACTURER_PAGE",
              revision: 1,
            },
          ],
          copy: [{ block: "lead", body: "Bevezető.", revision: 2 }],
        },
      },
    ]);
  });

  /**
   * THE DIFF BEFORE THE WRITE. WHAT TURNS IT RED: a projection that writes
   * every time (the report could no longer tell "already so" from "set now"),
   * or one that writes on a dry run.
   */
  it("the shop already holds it: unchanged, nothing written", async () => {
    const first = fakes(null);
    await first.service.project("p-kz", { facts: FACTS, copy: COPY }, true);
    const { service, writes } = fakes(first.writes[0]!.body);
    const outcome = await service.project(
      "p-kz",
      { facts: FACTS, copy: COPY },
      true,
    );
    assert.equal(outcome.action, "unchanged");
    assert.deepEqual(writes, []);
  });

  it("without apply it only plans", async () => {
    const { service, writes } = fakes(null);
    const outcome = await service.project(
      "p-kz",
      { facts: FACTS, copy: COPY },
      false,
    );
    assert.equal(outcome.action, "planned");
    assert.deepEqual(writes, []);
  });

  it("no knowledge row: skipped without asking the shop; not in the shop: skipped", async () => {
    const empty = fakes(null);
    assert.deepEqual(
      await empty.service.project("p", { facts: [], copy: [] }, true),
      { action: "skipped", reason: "no-knowledge" },
    );
    assert.deepEqual(empty.reads, []);
    const unlinked = fakes(null, false);
    assert.deepEqual(
      await unlinked.service.project("p", { facts: FACTS, copy: [] }, true),
      { action: "skipped", reason: "no-link" },
    );
    assert.deepEqual(unlinked.writes, []);
  });

  it("rows that project to nothing (drafts only) clear a record the shop still holds", async () => {
    const held = fakes({
      facts: [],
      copy: [{ block: "lead", body: "Régi.", revision: 1 }],
    });
    const outcome = await held.service.project(
      "p-kz",
      { facts: [], copy: [{ ...COPY[0]!, status: "DRAFT" }] },
      true,
    );
    assert.equal(outcome.action, "applied");
    assert.deepEqual(held.writes[0]!.body, { facts: [], copy: [] });
  });
});

describe("the knowledge rows the runner reads", () => {
  it("the fact's source is read through the JEV pointer, never from the fact", async () => {
    const asked: unknown[] = [];
    const rows = await knowledgeRowsFor(
      {
        productKnowledgeFact: {
          findMany: async (args: unknown) => {
            asked.push(args);
            return [
              {
                field: "packSize",
                value: "100 ml",
                unit: null,
                status: "VERIFIED",
                revision: 1,
                fieldResult: {
                  status: "VERIFIED",
                  sourceType: "SUPPLIER_PAGE",
                  conflicts: null,
                },
              },
            ];
          },
        },
        productCopy: { findMany: async () => [] },
      },
      "p-kz",
    );
    assert.equal(rows.facts[0]!.sourceType, "SUPPLIER_PAGE");
    assert.deepEqual((asked[0] as { where: unknown }).where, {
      productId: "p-kz",
    });
  });

  /**
   * KZ Amino stage run (#1431 comment 5972125293, finding 4): a fact resolved
   * from a conflict points at the conflict result, whose own source is null,
   * and it projected with `source_type: null`. WHAT TURNS IT RED: reading the
   * pointer's own `sourceType` for a resolved fact.
   */
  it("a resolved fact projects the chosen value's source, not the conflict's null", async () => {
    const rows = await knowledgeRowsFor(
      {
        productKnowledgeFact: {
          findMany: async () => [
            {
              field: "packageContents",
              value: "Üvegpalack pipettával",
              unit: null,
              status: "VERIFIED",
              revision: 2,
              fieldResult: {
                status: "CONFLICTING_SOURCES",
                sourceType: null,
                conflicts: [
                  {
                    value: "Üvegpalack pipettával",
                    sources: [
                      { sourceType: "OS_PRODUCT_MASTER" },
                      { sourceType: "MANUFACTURER_PAGE" },
                    ],
                  },
                  {
                    value: "Műanyag flakon",
                    sources: [{ sourceType: "SUPPLIER_PAGE" }],
                  },
                ],
              },
            },
          ],
        },
        productCopy: { findMany: async () => [] },
      },
      "p-kz",
    );
    assert.equal(rows.facts[0]!.sourceType, "MANUFACTURER_PAGE");
    assert.equal(
      knowledgeProjection(rows.facts, []).facts[0]!.source_type,
      "MANUFACTURER_PAGE",
    );
  });
});
