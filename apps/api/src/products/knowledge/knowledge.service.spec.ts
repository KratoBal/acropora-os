import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { ProductCopyBlock } from "@acropora/types";

import type {
  EnrichmentFactsReader,
  StoredCheck,
} from "../enrichment/enrichment-run.js";
import type { ProductService } from "../product.service.js";
import {
  knowledgeProjection,
  type CopyRow,
  type FactRow,
} from "./knowledge.policy.js";
import type {
  CopyRecord,
  FactRecord,
  FieldResultRecord,
  KnowledgeStore,
} from "./knowledge.repository.js";
import { ProductKnowledgeService } from "./knowledge.service.js";

/**
 * THE KNOWLEDGE SERVICE ON AN IN-MEMORY STORE. The store keeps the same
 * rows the Prisma one writes (a manual check per entry, a fact per field,
 * a copy row per block); the database side is measured in the integration
 * spec. Invented product and sources only.
 */
const PRODUCT = "p-kz";

function memoryStore() {
  let seq = 0;
  let clock = 0;
  const results: (FieldResultRecord & {
    evidence: unknown;
    checkedAt: number;
    sourceType: string | null;
  })[] = [];
  const facts = new Map<string, FactRecord>();
  const copy = new Map<ProductCopyBlock, CopyRecord>();
  const store: KnowledgeStore = {
    latestFieldResult: async (productId, field) => {
      const row = results
        .filter((r) => r.productId === productId && r.field === field)
        .sort((a, b) => b.checkedAt - a.checkedAt)[0];
      return row ? { id: row.id, evidence: row.evidence } : null;
    },
    fieldResult: async (id) => results.find((r) => r.id === id) ?? null,
    saveManualCheck: async (check: StoredCheck) => {
      const field = check.fields[0]!;
      const id = `fr-${++seq}`;
      results.push({
        id,
        productId: check.productId,
        field: field.field,
        status: field.status,
        value: field.value,
        conflicts: field.conflicts,
        finished: true,
        evidence: field.evidence,
        checkedAt: ++clock,
        sourceType: field.sourceType,
      });
      return id;
    },
    facts: async () =>
      [...facts.values()].sort((a, b) => a.field.localeCompare(b.field)),
    upsertFact: async (input) => {
      const previous = facts.get(input.field);
      const result = results.find((r) => r.id === input.fieldResultId)!;
      facts.set(input.field, {
        field: input.field,
        value: input.value,
        unit: input.unit,
        status: input.status,
        revision: (previous?.revision ?? 0) + 1,
        acceptedAt: input.acceptedAt,
        acceptedBy: {
          id: input.acceptedById,
          displayName: "Kitalált Elfogadó",
        },
        fieldResultId: input.fieldResultId,
        source: {
          sourceType: result.sourceType,
          sourceRef: null,
          retrievedAt: null,
        },
      });
    },
    copy: async () => [...copy.values()],
    saveCopy: async (input) => {
      const previous = copy.get(input.block);
      copy.set(input.block, {
        block: input.block,
        body: input.body,
        status: "DRAFT",
        revision: (previous?.revision ?? 0) + 1,
        basedOn: input.basedOn,
        updatedAt: new Date(0),
        approvedAt: null,
      });
    },
    approveCopy: async (input) => {
      const row = copy.get(input.block)!;
      copy.set(input.block, {
        ...row,
        status: "APPROVED",
        approvedAt: input.approvedAt,
      });
    },
  };
  return { store, results, facts, copy };
}

function service(memory = memoryStore()) {
  const products = {
    getProduct: async (id: string) => {
      if (id !== PRODUCT)
        throw new NotFoundException("A termék nem található.");
      return { id };
    },
  } as unknown as ProductService;
  const factsReader: EnrichmentFactsReader = {
    productFacts: async (productId) => ({
      productId,
      name: "Kitalált Amino 100 ml",
      brandWebsiteUrl: null,
      unasManufacturerUrl: null,
      current: {},
    }),
    supplierWebsite: async () => null,
  };
  return {
    knowledge: new ProductKnowledgeService(
      products,
      memory.store,
      factsReader,
      () => new Date("2026-10-03T19:00:00.000Z"),
    ),
    memory,
  };
}

const USER = { id: "u-owner" };
const DAILY = {
  field: "dosing",
  raw: "1 Tropfen je 100 Liter /Tag",
  value: "1 drop/100 L/day",
  url: "https://gyarto.example.invalid/amino",
  sourceType: "MANUFACTURER_PAGE",
};
const WEEKLY = {
  field: "dosing",
  raw: "Korallenzucht dosage: 1-2 x/week 1 drop/100L",
  value: "1 drop/100 L, 1-2/week",
  url: "https://gyarto.example.invalid/dosage-2013.pdf",
  sourceType: "MANUFACTURER_DOCUMENT",
};

/** What the projection would send, from the rows the service wrote. */
async function projected(memory: ReturnType<typeof memoryStore>) {
  const facts: FactRow[] = (await memory.store.facts(PRODUCT)).map((f) => ({
    field: f.field,
    value: f.value,
    unit: f.unit,
    status: f.status,
    revision: f.revision,
    sourceType: f.source.sourceType,
  }));
  const copy: CopyRow[] = (await memory.store.copy(PRODUCT)).map((c) => ({
    block: c.block,
    body: c.body,
    status: c.status,
    revision: c.revision,
    basedOn: c.basedOn,
  }));
  return knowledgeProjection(facts, copy);
}

describe("product knowledge: the conflict path end to end", () => {
  /**
   * Two manual evidences -> CONFLICTING -> accepted with a null value ->
   * projected with a null value. WHAT TURNS IT RED: any step that keeps a
   * value for the conflict (a winner picked, a value copied into the fact
   * or into the payload).
   */
  it("two evidences conflict, the accepted fact has no value, and neither has the projection", async () => {
    const { knowledge, memory } = service();
    const first = await knowledge.addEvidence(PRODUCT, DAILY, USER);
    assert.equal(first.status, "VERIFIED");
    const second = await knowledge.addEvidence(PRODUCT, WEEKLY, USER);
    assert.equal(second.status, "CONFLICTING_SOURCES");
    assert.equal(second.value, null);
    assert.equal(second.evidenceCount, 2);

    const view = await knowledge.accept(PRODUCT, second.fieldResultId, USER);
    assert.deepEqual(
      view.facts.map((f) => [f.field, f.value, f.status, f.fieldResultId]),
      [["dosing", null, "CONFLICTING_SOURCES", second.fieldResultId]],
    );
    // Both values stay in the JEV result the fact points at.
    const pointed = memory.results.find((r) => r.id === second.fieldResultId)!;
    assert.deepEqual(
      (pointed.conflicts as { value: string }[]).map((c) => c.value),
      ["1 drop/100 L/day", "1 drop/100 L, 1-2/week"],
    );

    const payload = await projected(memory);
    assert.deepEqual(payload.facts, [
      {
        field: "dosing",
        value: null,
        unit: null,
        status: "CONFLICTING_SOURCES",
        source_type: null,
        revision: 1,
      },
    ]);
  });

  it("a human picks one value: VERIFIED on the same pointer, the revision bumped", async () => {
    const { knowledge } = service();
    await knowledge.addEvidence(PRODUCT, DAILY, USER);
    const conflict = await knowledge.addEvidence(PRODUCT, WEEKLY, USER);
    await knowledge.accept(PRODUCT, conflict.fieldResultId, USER);
    const view = await knowledge.resolve(
      PRODUCT,
      conflict.fieldResultId,
      "1 drop/100 L/day",
      USER,
    );
    assert.deepEqual(
      view.facts.map((f) => [f.value, f.status, f.revision, f.fieldResultId]),
      [["1 drop/100 L/day", "VERIFIED", 2, conflict.fieldResultId]],
    );
  });
});

describe("product knowledge: what a decision may be made on", () => {
  it("only the NEWEST result of a field: an older one was superseded by newer evidence", async () => {
    const { knowledge } = service();
    const first = await knowledge.addEvidence(PRODUCT, DAILY, USER);
    await knowledge.addEvidence(PRODUCT, WEEKLY, USER);
    await assert.rejects(
      knowledge.accept(PRODUCT, first.fieldResultId, USER),
      (error: unknown) =>
        error instanceof ConflictException &&
        /newer result/.test(String(error.message)),
    );
  });

  it("another product's result is not found here", async () => {
    const { knowledge, memory } = service();
    const own = await knowledge.addEvidence(PRODUCT, DAILY, USER);
    memory.results.find((r) => r.id === own.fieldResultId)!.productId = "masik";
    await assert.rejects(
      knowledge.accept(PRODUCT, own.fieldResultId, USER),
      NotFoundException,
    );
  });

  it("an invalid evidence body is a 400 with the reason, and nothing is stored", async () => {
    const { knowledge, memory } = service();
    await assert.rejects(
      knowledge.addEvidence(PRODUCT, { ...DAILY, value: "naponta" }, USER),
      BadRequestException,
    );
    assert.equal(memory.results.length, 0);
  });
});

describe("product knowledge: stale copy", () => {
  /**
   * A copy saved against revision 1 goes stale when the fact moves to
   * revision 2: it reads as stale, it cannot be approved, and an approved
   * one stops travelling. WHAT TURNS IT RED: a stored stale flag that did
   * not follow the revision, or an approval that ignored it.
   */
  it("a revision bump after the save makes the copy stale and blocks its approval", async () => {
    const { knowledge, memory } = service();
    const first = await knowledge.addEvidence(PRODUCT, DAILY, USER);
    await knowledge.accept(PRODUCT, first.fieldResultId, USER);
    await knowledge.saveCopy(PRODUCT, "lead", "Napi egy csepp.", USER);
    await knowledge.approveCopy(PRODUCT, "lead", USER);
    assert.deepEqual((await projected(memory)).copy, [
      { block: "lead", body: "Napi egy csepp.", revision: 1 },
    ]);

    const second = await knowledge.addEvidence(PRODUCT, WEEKLY, USER);
    const view = await knowledge.accept(PRODUCT, second.fieldResultId, USER);
    assert.deepEqual(
      view.copy.map((c) => [c.block, c.status, c.stale]),
      [["lead", "APPROVED", true]],
    );
    assert.deepEqual((await projected(memory)).copy, []);

    await knowledge.saveCopy(PRODUCT, "body", "Törzs.", USER);
    await knowledge.accept(PRODUCT, second.fieldResultId, USER);
    await assert.rejects(
      knowledge.approveCopy(PRODUCT, "body", USER),
      ConflictException,
    );
  });

  it("saving over an approved block makes it a draft again, with a new revision", async () => {
    const { knowledge } = service();
    await knowledge.saveCopy(PRODUCT, "lead", "Első.", USER);
    await knowledge.approveCopy(PRODUCT, "lead", USER);
    const view = await knowledge.saveCopy(PRODUCT, "lead", "Második.", USER);
    assert.deepEqual(
      view.copy.map((c) => [c.body, c.status, c.stale]),
      [["Második.", "DRAFT", false]],
    );
  });

  it("an unknown block is a 400", async () => {
    const { knowledge } = service();
    await assert.rejects(
      knowledge.saveCopy(PRODUCT, "description", "x", USER),
      BadRequestException,
    );
  });
});
