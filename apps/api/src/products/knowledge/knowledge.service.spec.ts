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
import { CURRENT_ATTRIBUTE_DEFINITIONS } from "../attributes/attribute-definitions.js";
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

function memoryStore(variantIds: string[] = ["v-egy"]) {
  let seq = 0;
  let clock = 0;
  const results: (FieldResultRecord & {
    evidence: unknown;
    checkedAt: number;
    sourceType: string | null;
  })[] = [];
  const facts = new Map<string, FactRecord>();
  const copy = new Map<ProductCopyBlock, CopyRecord>();
  const barcodes: {
    variantId: string;
    code: string;
    fieldResultId: string;
    isPrimary: boolean;
  }[] = [];
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
      [...facts.values()].sort(
        (a, b) =>
          a.field.localeCompare(b.field) ||
          (a.variantId ?? "").localeCompare(b.variantId ?? ""),
      ),
    // the seed itself (PR 2), so the door checks what the database will hold
    definition: async (field) => {
      // a definíciók MA (a PR 4 után az `ean` vonalkód, nem tény)
      const seed = CURRENT_ATTRIBUTE_DEFINITIONS.find((d) => d.key === field);
      // `isActive` is the column default (true); the seed does not carry it
      return seed ? { ...seed, isActive: true } : null;
    },
    variantIds: async () => [...variantIds],
    acceptBarcode: async (input) => {
      const masik = barcodes.find((b) => b.code === input.code);
      if (masik && masik.variantId !== input.variantId)
        return { kind: "taken" as const, sku: `${masik.variantId}-sku` };
      if (masik) return { kind: "exists" as const };
      const isPrimary = !barcodes.some(
        (b) => b.variantId === input.variantId && b.isPrimary,
      );
      barcodes.push({ ...input, isPrimary });
      return { kind: "created" as const, isPrimary };
    },
    upsertFact: async (input) => {
      // the Prisma key: product, scopeKey (`variantId ?? ""`), field
      const key = `${input.variantId ?? ""}|${input.field}`;
      const previous = facts.get(key);
      const result = results.find((r) => r.id === input.fieldResultId)!;
      facts.set(key, {
        field: input.field,
        variantId: input.variantId,
        value: input.value,
        unit: input.unit,
        status: input.status,
        revision: (previous?.revision ?? 0) + 1,
        public: true,
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
        usedFields: input.usedFields,
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
  return { store, results, facts, copy, barcodes };
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
    variantId: f.variantId,
    value: f.value,
    unit: f.unit,
    status: f.status,
    revision: f.revision,
    public: f.public,
    sourceType: f.source.sourceType,
  }));
  const copy: CopyRow[] = (await memory.store.copy(PRODUCT)).map((c) => ({
    block: c.block,
    body: c.body,
    status: c.status,
    revision: c.revision,
    basedOn: c.basedOn,
    usedFields: c.usedFields,
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
  it("two evidences conflict, the accepted fact has no value, and the projection does not carry it (D5)", async () => {
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

    // D5 (kártya 4622f1ac): a feloldatlan konfliktus nem jut a vásárlóhoz.
    const payload = await projected(memory);
    assert.deepEqual(payload.facts, []);
  });

  it("a human picks one value: VERIFIED on the same pointer, the revision bumped, and it reaches the shop", async () => {
    const { knowledge, memory } = service();
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
    // A feloldás az út vissza a lapra: a VERIFIED érték kimegy.
    assert.deepEqual(
      (await projected(memory)).facts.map((f) => [f.field, f.status]),
      [["dosing", "VERIFIED"]],
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

describe("product knowledge: per-block basedOn (SEO P0 PR 1b)", () => {
  /**
   * THE SAVE NAMES THE FACTS THE BLOCK USES, AND ONLY THOSE COUNT.
   *
   * WHAT TURNS IT RED: `basedOn` keeps every fact; a key with no fact passes
   * silently (acrobot 27489: refused, with the key's name); approval measures
   * staleness product-wide while the projection measures it per block.
   */
  const APPLICATION = {
    field: "application",
    raw: "SPS és LPS korallokhoz",
    value: "SPS és LPS korallok",
    url: "https://gyarto.example.invalid/amino",
    sourceType: "MANUFACTURER_PAGE",
  };

  it("the save stores the used facts' revisions only, and the view returns the list", async () => {
    const { knowledge, memory } = service();
    const dosing = await knowledge.addEvidence(PRODUCT, DAILY, USER);
    await knowledge.accept(PRODUCT, dosing.fieldResultId, USER);
    const app = await knowledge.addEvidence(PRODUCT, APPLICATION, USER);
    await knowledge.accept(PRODUCT, app.fieldResultId, USER);
    const view = await knowledge.saveCopy(
      PRODUCT,
      "lead",
      "Korallokhoz.",
      USER,
      ["application"],
    );
    assert.deepEqual(memory.copy.get("lead")!.basedOn, { application: 1 });
    assert.deepEqual(view.copy[0]!.usedFields, ["application"]);
    // without the list: today's product-wide basedOn
    await knowledge.saveCopy(PRODUCT, "body", "Törzs.", USER);
    assert.deepEqual(memory.copy.get("body")!.basedOn, {
      application: 1,
      dosing: 1,
    });
  });

  it("(6) a key with no accepted fact is refused, naming the key", async () => {
    const { knowledge, memory } = service();
    const dosing = await knowledge.addEvidence(PRODUCT, DAILY, USER);
    await knowledge.accept(PRODUCT, dosing.fieldResultId, USER);
    await assert.rejects(
      knowledge.saveCopy(PRODUCT, "lead", "x", USER, ["dosing", "aplication"]),
      (err: unknown) =>
        err instanceof BadRequestException && /aplication/.test(err.message),
    );
    await assert.rejects(
      knowledge.saveCopy(PRODUCT, "lead", "x", USER, "dosing"),
      BadRequestException,
    );
    assert.equal(memory.copy.size, 0);
  });

  it("approval follows the block's own facts: an unused fact's change does not block it", async () => {
    const { knowledge, memory } = service();
    const first = await knowledge.addEvidence(PRODUCT, DAILY, USER);
    await knowledge.accept(PRODUCT, first.fieldResultId, USER);
    const app = await knowledge.addEvidence(PRODUCT, APPLICATION, USER);
    await knowledge.accept(PRODUCT, app.fieldResultId, USER);
    await knowledge.saveCopy(PRODUCT, "lead", "Korallokhoz.", USER, [
      "application",
    ]);
    // dosing moves to revision 2 (the conflict arrives); the lead does not use it
    const second = await knowledge.addEvidence(PRODUCT, WEEKLY, USER);
    const view = await knowledge.accept(PRODUCT, second.fieldResultId, USER);
    assert.deepEqual(
      view.copy.map((c) => [c.block, c.stale]),
      [["lead", false]],
    );
    await knowledge.approveCopy(PRODUCT, "lead", USER);
    assert.equal(memory.copy.get("lead")!.status, "APPROVED");
  });
});

/*
  A VALTOZAT-SZINTU TENY (SEO P0 PR 3, D1 es D2). A tomeg VARIANT-hatokoru
  mezo (a PR 2 seedje), az `application` PRODUCT-hatokoru.

  MI PIROSIT: egy egyvaltozatos termek tomege termekszintu sorba kerul, vagy
  egy masodik elfogadas uj sort nyit a meglevo leptetese helyett (a FO ESET:
  a stage-en 1900/1909 termek egyvaltozatos, acrobot 2026-10-07 16:45); egy
  tobbvaltozatos termek tomege valtozat nelkul is atmegy; egy termekszintu
  mezo valtozatot kap; a vetuletbe valtozat-szintu teny kerul.
*/
describe("product knowledge: the variant a fact belongs to (SEO P0 PR 3)", () => {
  const ALKALMAZAS = {
    field: "application",
    raw: "SPS és LPS korallokhoz",
    value: "SPS és LPS korallok",
    url: "https://gyarto.example.invalid/amino",
    sourceType: "MANUFACTURER_PAGE",
  };
  const WEIGHT = {
    field: "weight",
    raw: "Gewicht: 120 g",
    value: "120 g",
    url: "https://gyarto.example.invalid/amino",
    sourceType: "MANUFACTURER_PAGE",
  };

  it("one variant: the weight binds to it without being named", async () => {
    const { knowledge, memory } = service(memoryStore(["v-egy"]));
    const r = await knowledge.addEvidence(PRODUCT, WEIGHT, USER);
    const view = await knowledge.accept(PRODUCT, r.fieldResultId, USER);
    assert.deepEqual(
      view.facts.map((f) => [f.field, f.variantId, f.revision]),
      [["weight", "v-egy", 1]],
    );
    assert.deepEqual([...memory.facts.keys()], ["v-egy|weight"]);
  });

  it("one variant: a second acceptance bumps the same row, it does not open a new one", async () => {
    const { knowledge, memory } = service(memoryStore(["v-egy"]));
    const first = await knowledge.addEvidence(PRODUCT, WEIGHT, USER);
    await knowledge.accept(PRODUCT, first.fieldResultId, USER);
    const second = await knowledge.addEvidence(
      PRODUCT,
      { ...WEIGHT, url: "https://gyarto.example.invalid/amino-2" },
      USER,
    );
    const view = await knowledge.accept(PRODUCT, second.fieldResultId, USER);
    assert.deepEqual(
      view.facts.map((f) => [f.field, f.variantId, f.revision]),
      [["weight", "v-egy", 2]],
    );
    assert.equal(memory.facts.size, 1);
  });

  it("several variants: the weight needs the variant named, and goes to that one", async () => {
    const { knowledge, memory } = service(memoryStore(["v-a", "v-b"]));
    const r = await knowledge.addEvidence(PRODUCT, WEIGHT, USER);
    await assert.rejects(
      knowledge.accept(PRODUCT, r.fieldResultId, USER),
      (err: unknown) =>
        err instanceof BadRequestException && /variantId/.test(err.message),
    );
    assert.equal(memory.facts.size, 0);
    await assert.rejects(
      knowledge.accept(PRODUCT, r.fieldResultId, USER, "v-masik-termeke"),
      BadRequestException,
    );
    const view = await knowledge.accept(PRODUCT, r.fieldResultId, USER, "v-b");
    assert.deepEqual(
      view.facts.map((f) => [f.field, f.variantId]),
      [["weight", "v-b"]],
    );
  });

  it("a product-level field takes no variant", async () => {
    const { knowledge, memory } = service(memoryStore(["v-a", "v-b"]));
    const r = await knowledge.addEvidence(PRODUCT, ALKALMAZAS, USER);
    await assert.rejects(
      knowledge.accept(PRODUCT, r.fieldResultId, USER, "v-a"),
      (err: unknown) =>
        err instanceof BadRequestException && /product-level/.test(err.message),
    );
    assert.equal(memory.facts.size, 0);
    const view = await knowledge.accept(PRODUCT, r.fieldResultId, USER);
    assert.deepEqual(
      view.facts.map((f) => [f.field, f.variantId]),
      [["application", null]],
    );
  });

  it("the variant's fact stays in the OS: the projection carries the product's facts only", async () => {
    const { knowledge, memory } = service(memoryStore(["v-egy"]));
    const w = await knowledge.addEvidence(PRODUCT, WEIGHT, USER);
    await knowledge.accept(PRODUCT, w.fieldResultId, USER);
    const a = await knowledge.addEvidence(PRODUCT, ALKALMAZAS, USER);
    await knowledge.accept(PRODUCT, a.fieldResultId, USER);
    // pozitiv kontroll: mindket teny VERIFIED es public, tehat a vetulet nem
    // a statusz vagy a kapu miatt hagyja ki a tomeget, hanem a valtozat miatt
    assert.deepEqual(
      (await memory.store.facts(PRODUCT)).map((f) => [
        f.field,
        f.variantId,
        f.status,
        f.public,
      ]),
      [
        ["application", null, "VERIFIED", true],
        ["weight", "v-egy", "VERIFIED", true],
      ],
    );
    assert.deepEqual(
      (await projected(memory)).facts.map((f) => f.field),
      ["application"],
    );
  });
});

/*
  AZ ELFOGADOTT EAN VONALKÓD, NEM TÉNY (SEO P0 PR 4, C3). MI PIROSIT: az EAN
  tényként tárolódik; a kód nem a csomagolás alakjában (13 jegy) áll, hanem a
  JEV 14 jegyes alakjában; egy másik változat kódja felülíródik vagy
  megkettőződik; egy meglévő primary elveszti a rangját; egy ütköző EAN érték
  nélkül íródik.
*/
describe("product knowledge: the accepted EAN is a barcode (SEO P0 PR 4)", () => {
  const EAN = {
    field: "ean",
    raw: "EAN: 4260507580214",
    value: "4260507580214",
    url: "https://gyarto.example.invalid/amino",
    sourceType: "MANUFACTURER_PAGE",
  };

  it("one variant: a primary JEV barcode in the package's form, and no fact", async () => {
    const { knowledge, memory } = service(memoryStore(["v-egy"]));
    const r = await knowledge.addEvidence(PRODUCT, EAN, USER);
    const view = await knowledge.accept(PRODUCT, r.fieldResultId, USER);
    assert.deepEqual(memory.barcodes, [
      {
        variantId: "v-egy",
        code: "4260507580214",
        fieldResultId: r.fieldResultId,
        verifiedById: "u-owner",
        verifiedAt: new Date("2026-10-03T19:00:00.000Z"),
        isPrimary: true,
      },
    ]);
    assert.deepEqual(view.facts, []);
    assert.equal(memory.facts.size, 0);
  });

  it("a code another variant holds is a 409 naming it; the existing primary keeps its rank", async () => {
    const { knowledge, memory } = service(memoryStore(["v-egy"]));
    memory.barcodes.push({
      variantId: "v-masik",
      code: "4260507580214",
      fieldResultId: "x",
      isPrimary: true,
    });
    const r = await knowledge.addEvidence(PRODUCT, EAN, USER);
    await assert.rejects(
      knowledge.accept(PRODUCT, r.fieldResultId, USER),
      (err: unknown) =>
        err instanceof ConflictException && /v-masik-sku/.test(err.message),
    );
    assert.equal(memory.barcodes.length, 1);

    const sajat = service(memoryStore(["v-egy"]));
    sajat.memory.barcodes.push({
      variantId: "v-egy",
      code: "5999999999993",
      fieldResultId: "y",
      isPrimary: true,
    });
    const r2 = await sajat.knowledge.addEvidence(PRODUCT, EAN, USER);
    await sajat.knowledge.accept(PRODUCT, r2.fieldResultId, USER);
    assert.deepEqual(
      sajat.memory.barcodes.map((b) => [b.code, b.isPrimary]),
      [
        ["5999999999993", true],
        ["4260507580214", false],
      ],
    );
  });

  it("a resolved EAN conflict becomes the barcode too, never a fact", async () => {
    const { knowledge, memory } = service(memoryStore(["v-egy"]));
    await knowledge.addEvidence(PRODUCT, EAN, USER);
    const masik = await knowledge.addEvidence(
      PRODUCT,
      {
        ...EAN,
        raw: "EAN: 4006381333931",
        value: "4006381333931",
        url: "https://beszallito.example.invalid/amino",
        sourceType: "MANUFACTURER_DOCUMENT",
      },
      USER,
    );
    // ütközés: értéke nincs, vonalkódként nem írható
    await assert.rejects(
      knowledge.accept(PRODUCT, masik.fieldResultId, USER),
      ConflictException,
    );
    await knowledge.resolve(
      PRODUCT,
      masik.fieldResultId,
      "4006381333931",
      USER,
    );
    assert.deepEqual(
      memory.barcodes.map((b) => [b.variantId, b.code, b.isPrimary]),
      [["v-egy", "4006381333931", true]],
    );
    assert.equal(memory.facts.size, 0);
  });
});
