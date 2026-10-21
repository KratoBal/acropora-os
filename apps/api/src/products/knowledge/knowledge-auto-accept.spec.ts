import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { knowledgeRowsFor } from "../../integrations/medusa/medusa-product-knowledge.service.js";
import { variantMeasuresFor } from "../../integrations/medusa/medusa-variant-measures.js";
import {
  AUTO_ACCEPT_RULE,
  autoAcceptDecision,
  runAutoAccept,
  type AutoEvidence,
  type AutoInput,
  type AutoResult,
} from "./knowledge-auto-accept.js";
import { runAutoAcceptCli } from "./knowledge-auto-accept.cli.js";
import { projectedCopy, type CopyRow } from "./knowledge.policy.js";

/**
 * THE RULE'S ACCEPT (Product Knowledge step 2, card 85c38ab1). WHAT TURNS IT
 * RED: a result accepted from a retailer's page, from a reviewer's entry, from
 * a page that does not prove the product is ours, over a person's fact; a dry
 * run that writes; or an automatic fact that reaches the shop's projection.
 */
const PAGE = "https://gyarto.example.invalid/amino";
const page = (over: Partial<AutoEvidence> = {}): AutoEvidence => ({
  sourceType: "MANUFACTURER_PAGE",
  sourceKind: "MANUFACTURER",
  sourceRef: PAGE,
  accepted: true,
  ...over,
});
const own: AutoEvidence = {
  sourceType: "OS_PRODUCT_MASTER",
  sourceKind: "OS",
  sourceRef: "os://product/p1",
  accepted: true,
};
const dosing = (over: Partial<AutoResult> = {}): AutoResult => ({
  id: "fr-dosing",
  status: "VERIFIED",
  value: "1 drop/100 L/day",
  evidence: [page()],
  ...over,
});
const ean = (over: Partial<AutoResult> = {}): AutoResult => ({
  id: "fr-ean",
  status: "VERIFIED",
  value: "4260507580214",
  evidence: [own, page()],
  ...over,
});
const input = (over: Partial<AutoInput> = {}): AutoInput => ({
  field: "dosing",
  result: dosing(),
  identity: [ean(), null],
  fact: null,
  ...over,
});

describe("a szabály", () => {
  it("gyártói lap, ugyanazon a lapon a saját EAN-ünk: elfogadja", () => {
    assert.deepEqual(autoAcceptDecision(input()), {
      kind: "ACCEPT",
      fieldResultId: "fr-dosing",
      value: "1 drop/100 L/day",
    });
    // a gyártói cikkszám ugyanúgy azonosít
    assert.equal(
      autoAcceptDecision(
        input({ identity: [null, ean({ id: "fr-mpn", value: "KZ-AMINO" })] }),
      ).kind,
      "ACCEPT",
    );
  });

  it("minden más emberhez megy, és az ok megnevezi, miért", () => {
    const cases: [string, AutoInput, RegExp][] = [
      ["nincs eredmény", input({ result: null }), /nincs eredmény/],
      [
        "nem VERIFIED",
        input({ result: dosing({ status: "CONFLICTING_SOURCES" }) }),
        /státusz CONFLICTING_SOURCES/,
      ],
      ["érték nélkül", input({ result: dosing({ value: null }) }), /státusz/],
      [
        "kereskedői lap",
        input({
          result: dosing({
            evidence: [
              page({
                sourceType: "SUPPLIER_PAGE",
                sourceKind: "BULK_REEF_SUPPLY",
              }),
            ],
          }),
        }),
        /nem gyártói forrás/,
      ],
      [
        "kézi bizonyíték",
        input({ result: dosing({ evidence: [page({ manual: true })] }) }),
        /kézi bizonyíték/,
      ],
      [
        "MANUAL fajta",
        input({
          result: dosing({ evidence: [page({ sourceKind: "MANUAL" })] }),
        }),
        /kézi bizonyíték/,
      ],
      [
        "nincs azonosság",
        input({ identity: [null, null] }),
        /azonossága nem igazolt/,
      ],
      // a lap EAN-je a miénk nélkül (nincs saját értékünk) nem azonosít
      [
        "EAN saját érték nélkül",
        input({ identity: [ean({ evidence: [page()] }), null] }),
        /azonossága nem igazolt/,
      ],
      // a saját EAN-t MÁSIK lap erősítette meg
      [
        "másik lap azonosít",
        input({
          identity: [
            ean({
              evidence: [
                own,
                page({ sourceRef: "https://gyarto.example.invalid/masik" }),
              ],
            }),
            null,
          ],
        }),
        /azonossága nem igazolt/,
      ],
      [
        "az azonosság nem VERIFIED",
        input({ identity: [ean({ status: "CONFLICTING_SOURCES" }), null] }),
        /azonossága nem igazolt/,
      ],
      [
        "ember elfogadta",
        input({ fact: { fieldResultId: "regi", acceptedByRule: null } }),
        /ember már elfogadta/,
      ],
      [
        "már elfogadva",
        input({
          fact: {
            fieldResultId: "fr-dosing",
            acceptedByRule: AUTO_ACCEPT_RULE,
          },
        }),
        /már elfogadva/,
      ],
    ];
    for (const [name, value, why] of cases) {
      const d = autoAcceptDecision(value);
      assert.equal(d.kind, "SKIP", name);
      assert.match(d.kind === "SKIP" ? d.reason : "", why, name);
    }
  });

  it("egy korábbi automatikus tényt az újabb eredmény felülírhat", () => {
    assert.equal(
      autoAcceptDecision(
        input({
          fact: { fieldResultId: "regi", acceptedByRule: AUTO_ACCEPT_RULE },
        }),
      ).kind,
      "ACCEPT",
    );
  });
});

describe("a futtató", () => {
  const deps = (accepted: string[][]) => ({
    latestResult: async (_p: string, field: string) =>
      field === "dosing" ? dosing() : field === "ean" ? ean() : null,
    productFact: async () => null,
    accept: async (p: string, id: string, rule: string) => {
      accepted.push([p, id, rule]);
    },
  });

  it("szárazon nem ír, --apply-jal a szabály nevével ír", async () => {
    const accepted: string[][] = [];
    const dry = await runAutoAccept(["p1"], false, deps(accepted));
    assert.deepEqual(
      dry.map((o) => o.kind),
      ["WOULD_ACCEPT"],
    );
    assert.equal(accepted.length, 0);
    const wet = await runAutoAccept(["p1"], true, deps(accepted));
    assert.deepEqual(
      wet.map((o) => o.kind),
      ["ACCEPTED"],
    );
    assert.deepEqual(accepted, [["p1", "fr-dosing", AUTO_ACCEPT_RULE]]);
  });

  it("a szolgáltatás elutasítása nem állítja meg, és a parancs 4-gyel lép ki", async () => {
    const lines: string[] = [];
    const code = await runAutoAcceptCli(
      ["--input", "f.json", "--apply", "--actor", "u1"],
      { stdout: (t) => lines.push(t), stderr: (t) => lines.push(t) },
      () => ({
        ...deps([]),
        accept: async () => {
          throw new Error("a newer result exists for dosing");
        },
        readInput: async () =>
          JSON.stringify({
            products: [{ productId: "p1" }, { productId: "p2" }],
          }),
        actorExists: async () => true,
      }),
    );
    assert.equal(code, 4);
    assert.match(lines.join(""), /FAILED +p2 dosing +a newer result/);
  });

  it("--apply --actor nélkül és ismeretlen futtatóval nem indul", async () => {
    const run = (argv: string[], exists = true) =>
      runAutoAcceptCli(argv, { stdout: () => {}, stderr: () => {} }, () => ({
        ...deps([]),
        readInput: async () =>
          JSON.stringify({ products: [{ productId: "p1" }] }),
        actorExists: async () => exists,
      }));
    assert.equal(await run(["--input", "f.json", "--apply"]), 2);
    assert.equal(
      await run(["--input", "f.json", "--apply", "--actor", "x"], false),
      2,
    );
    assert.equal(await run(["--apply", "--actor", "u1"]), 2);
  });
});

describe("az automatikus tény nem megy ki a boltba", () => {
  /** The `where` each projection reader sends; `db` is untyped there, so the test says it. */
  it("a tény-vetítés és a változat-méret csak emberi tényt kérdez", async () => {
    const asked: unknown[] = [];
    await knowledgeRowsFor(
      {
        productKnowledgeFact: {
          findMany: async (args: unknown) => {
            asked.push(args);
            return [];
          },
        },
        productCopy: { findMany: async () => [] },
        attributeDefinition: { findMany: async () => [] },
      },
      "p1",
    );
    await variantMeasuresFor(
      {
        attributeDefinition: {
          findMany: async () => [
            { key: "weight", medusaNativeField: "VARIANT_WEIGHT" },
          ],
        },
        productKnowledgeFact: {
          findMany: async (args: unknown) => {
            asked.push(args);
            return [];
          },
        },
      },
      "p1",
      [],
    );
    assert.equal(asked.length, 2);
    for (const args of asked) {
      const where = (args as { where: Record<string, unknown> }).where;
      assert.ok("acceptedByRule" in where, JSON.stringify(where));
      assert.equal(where.acceptedByRule, null);
    }
  });
});

describe("a szöveg sem viszi ki az automatikus tényt (barracuda, #1801)", () => {
  /**
   * The projection reads the facts with `acceptedByRule: null`, so an automatic
   * `dosing` is not in its list. An approved text built on it must then stay
   * out too: otherwise the fact leaves through the prose. Positive control: the
   * same text on a person's fact goes out.
   */
  const lead: CopyRow = {
    block: "lead",
    body: "Naponta 1 csepp 100 literenként.",
    status: "APPROVED",
    revision: 1,
    basedOn: { dosing: 1 },
    usedFields: ["dosing"],
  };
  const emberi = {
    field: "dosing",
    variantId: null,
    revision: 1,
    status: "VERIFIED",
    public: true,
  };
  it("az automatikus tényre épülő szöveg nem megy ki, az emberire igen", () => {
    assert.equal(projectedCopy([lead], [], "ACROPORA"), null);
    assert.ok(projectedCopy([lead], [emberi], "ACROPORA")?.description);
  });
});
