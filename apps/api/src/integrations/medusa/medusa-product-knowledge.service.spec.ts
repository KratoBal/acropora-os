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
    public: true,
    sourceType: null,
  },
  {
    field: "packSize",
    value: "100 ml",
    unit: null,
    status: "VERIFIED",
    revision: 1,
    public: true,
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
    usedFields: [],
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
  // D5 (kártya 4622f1ac): a konfliktus nem megy ki, és a mellette írt szöveg sem
  it("writes the contract body: the VERIFIED fact only; the lead written beside the conflict is held back", async () => {
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
              field: "packSize",
              value: "100 ml",
              unit: null,
              status: "VERIFIED",
              source_type: "MANUFACTURER_PAGE",
              revision: 1,
              public: true,
            },
          ],
          copy: [],
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
  /**
   * THE COPY QUERY ASKS FOR `usedFields` (SEO P0 PR 1b; barracuda's preview,
   * point A). The table handle here is loosely typed, so the compiler does not
   * see a select that forgot the column (measured: removing it stays green).
   * Without it every block falls back to the product-wide rule in the shop,
   * while the panel counts per block, and nothing fails.
   *
   * WHAT TURNS IT RED: a select without one of the fields the rule reads.
   */
  /**
   * THE FACTS CARRY THEIR DEFINITION'S `public` FLAG (SEO P0 PR 2, decision 10).
   * The table handle is loosely typed, so a reader that skipped the
   * definitions would compile; this test is the guard. A fact with no
   * definition is not public.
   *
   * WHAT TURNS IT RED: the definitions are not asked for, or asked for
   * without the `public` filter, or a fact's flag ignores them.
   */
  it("every fact carries its definition's public flag", async () => {
    const kerdes: unknown[] = [];
    const tenyek = ["packSize", "application", "ismeretlenKulcs"].map(
      (field) => ({
        field,
        value: "x",
        unit: null,
        status: "VERIFIED",
        revision: 1,
        fieldResult: { status: "VERIFIED", sourceType: null, conflicts: null },
      }),
    );
    const rows = await knowledgeRowsFor(
      {
        productKnowledgeFact: { findMany: async () => tenyek },
        productCopy: { findMany: async () => [] },
        attributeDefinition: {
          findMany: async (args: unknown) => {
            kerdes.push(args);
            return [{ key: "packSize" }];
          },
        },
      },
      "p-kz",
    );
    assert.deepEqual(kerdes, [
      { where: { public: true, isActive: true }, select: { key: true } },
    ]);
    assert.deepEqual(
      rows.facts.map((f) => [f.field, f.public]),
      [
        ["packSize", true],
        ["application", false],
        ["ismeretlenKulcs", false],
      ],
    );
  });

  it("the copy select carries every field the publication rule reads", async () => {
    const asked: unknown[] = [];
    await knowledgeRowsFor(
      {
        productKnowledgeFact: { findMany: async () => [] },
        productCopy: {
          findMany: async (args: unknown) => {
            asked.push(args);
            return [];
          },
        },
        attributeDefinition: { findMany: async () => [] },
      },
      "p-kz",
    );
    const select = (asked[0] as { select: Record<string, boolean> }).select;
    for (const field of [
      "block",
      "body",
      "status",
      "revision",
      "basedOn",
      "usedFields",
    ])
      assert.equal(select[field], true, field);
  });

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
                public: true,
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
        attributeDefinition: {
          findMany: async () => [
            { key: "packSize" },
            { key: "packageContents" },
          ],
        },
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
              public: true,
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
        attributeDefinition: {
          findMany: async () => [
            { key: "packSize" },
            { key: "packageContents" },
          ],
        },
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
