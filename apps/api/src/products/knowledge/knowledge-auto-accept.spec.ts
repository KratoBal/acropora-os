import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { knowledgeRowsFor } from "../../integrations/medusa/medusa-product-knowledge.service.js";
import { variantMeasuresFor } from "../../integrations/medusa/medusa-variant-measures.js";
import {
  AUTO_ACCEPT_RULE,
  autoAcceptDecision,
  dosingGroup,
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
        input({
          fact: { fieldResultId: "regi", acceptedByRule: null, value: null },
        }),
        /ember már elfogadta/,
      ],
      [
        "már elfogadva",
        input({
          fact: {
            fieldResultId: "fr-dosing",
            acceptedByRule: AUTO_ACCEPT_RULE,
            value: null,
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
          fact: {
            fieldResultId: "regi",
            acceptedByRule: AUTO_ACCEPT_RULE,
            value: null,
          },
        }),
      ).kind,
      "ACCEPT",
    );
  });
});

describe("a három adagolási állapot (3. szelet)", () => {
  it("a tesztfüggő mód, az útmutató és a mérendők ugyanazzal a szabállyal mennek", () => {
    for (const [field, value] of [
      ["dosingMode", "TEST_DEPENDENT"],
      ["dosingMode", "FIXED"],
      ["dosingGuidance", "Mérje a KH-t hetente."],
      ["dosingTests", "KALCIUM;KH"],
    ] as const)
      assert.equal(
        autoAcceptDecision(input({ field, result: dosing({ value }) })).kind,
        "ACCEPT",
        `${field} ${value}`,
      );
  });

  // Balázs, 2026-10-21 20:44 UTC: what was not found, he sees himself
  it("a nincs-adat soha nem megy szabállyal, akármilyen erős a forrás", () => {
    assert.deepEqual(
      autoAcceptDecision(
        input({ field: "dosingMode", result: dosing({ value: "NO_DATA" }) }),
      ),
      { kind: "SKIP", reason: "nincs adat: ember nézi meg" },
    );
  });

  it("a gyártói forrás és az azonosság itt is kötelező", () => {
    assert.equal(
      autoAcceptDecision(
        input({
          field: "dosingMode",
          result: dosing({ value: "TEST_DEPENDENT" }),
          identity: [null, null],
        }),
      ).kind,
      "SKIP",
    );
  });
});

// barracuda, #1807: field by field the rule could leave contradicting facts behind
describe("az adagolás mezői egy csoportként", () => {
  type F = "dosing" | "dosingMode" | "dosingGuidance" | "dosingTests";
  const ok = (value: string) => ({
    kind: "ACCEPT" as const,
    fieldResultId: `fr-${value}`,
    value,
  });
  const no = { kind: "SKIP" as const, reason: "nincs eredmény" };
  const fact = (value: string) => ({
    fieldResultId: "regi",
    acceptedByRule: null,
    value,
  });
  const group = (
    now: Partial<Record<F, ReturnType<typeof ok> | typeof no>>,
    facts: Partial<Record<F, ReturnType<typeof fact>>> = {},
  ) => {
    const all: F[] = ["dosing", "dosingMode", "dosingGuidance", "dosingTests"];
    const out = dosingGroup(
      new Map(all.map((f) => [f, now[f] ?? no])),
      new Map(all.map((f) => [f, facts[f] ?? null])),
    );
    return Object.fromEntries(
      all.map((f) => [
        f,
        out.get(f)!.kind === "ACCEPT"
          ? "ACCEPT"
          : (out.get(f) as { reason: string }).reason,
      ]),
    );
  };

  it("teljes tesztfüggő csoport, fix adag nélkül: mind a három megy", () => {
    assert.deepEqual(
      group({
        dosingMode: ok("TEST_DEPENDENT"),
        dosingGuidance: ok("Mérje."),
        dosingTests: ok("KH"),
      }),
      {
        dosing: "nincs eredmény",
        dosingMode: "ACCEPT",
        dosingGuidance: "ACCEPT",
        dosingTests: "ACCEPT",
      },
    );
  });

  it("hiányos tesztfüggő csoport: a mód és a társa is emberhez", () => {
    const r = group({
      dosingMode: ok("TEST_DEPENDENT"),
      dosingTests: ok("KH"),
    });
    assert.deepEqual(
      [r.dosingMode, r.dosingTests],
      [
        "tesztfüggő csoport hiányos (útmutató vagy mérendő)",
        "a tesztfüggő mód nem ment át",
      ],
    );
  });

  it("tesztfüggő mód fix adag mellett nem megy, se most, se egy korábbi adag-tény mellett", () => {
    const now = group({
      dosing: ok("1 ml/100 L/day"),
      dosingMode: ok("TEST_DEPENDENT"),
      dosingGuidance: ok("x"),
      dosingTests: ok("KH"),
    });
    assert.deepEqual(
      [now.dosing, now.dosingMode, now.dosingGuidance],
      [
        "ACCEPT",
        "ellentmond: fix adag áll mellette",
        "a tesztfüggő mód nem ment át",
      ],
    );
    const earlier = group(
      {
        dosingMode: ok("TEST_DEPENDENT"),
        dosingGuidance: ok("x"),
        dosingTests: ok("KH"),
      },
      { dosing: fact("1 ml/100 L/day") },
    );
    assert.equal(earlier.dosingMode, "ellentmond: fix adag áll mellette");
  });

  it("egy elfogadott tesztfüggő mód mellé nem jön fix adag", () => {
    assert.equal(
      group(
        { dosing: ok("1 ml/100 L/day") },
        { dosingMode: fact("TEST_DEPENDENT") },
      ).dosing,
      "ellentmond: tesztfüggő mód",
    );
  });

  it("fix mód csak adaggal, és mellette nincs útmutató", () => {
    assert.equal(
      group({ dosingMode: ok("FIXED") }).dosingMode,
      "fix mód adag nélkül",
    );
    const r = group({
      dosing: ok("1 ml/100 L/day"),
      dosingMode: ok("FIXED"),
      dosingGuidance: ok("x"),
    });
    assert.deepEqual(
      [r.dosing, r.dosingMode, r.dosingGuidance],
      ["ACCEPT", "ACCEPT", "fix mód mellett nincs útmutató"],
    );
    assert.equal(
      group({ dosingMode: ok("FIXED") }, { dosing: fact("1 ml/100 L/day") })
        .dosingMode,
      "ACCEPT",
    );
  });

  // barracuda, #1808: the mirror of the test-dependent check
  it("fix mód és adag nem megy egy korábbi tesztfüggő útmutató vagy mérendő mellé", () => {
    for (const earlier of [
      { dosingGuidance: fact("Mérje.") },
      { dosingTests: fact("KH") },
    ]) {
      const r = group(
        { dosing: ok("1 ml/100 L/day"), dosingMode: ok("FIXED") },
        earlier,
      );
      assert.deepEqual(
        [r.dosing, r.dosingMode],
        [
          "ellentmond: tesztfüggő útmutató vagy mérendő áll mellette",
          "ellentmond: tesztfüggő útmutató vagy mérendő áll mellette",
        ],
      );
    }
  });

  it("mód nélkül az adag egyedül mehet, az útmutató nem; nincs-adat tény mellé semmi", () => {
    const r = group({ dosing: ok("1 ml/100 L/day"), dosingGuidance: ok("x") });
    assert.deepEqual(
      [r.dosing, r.dosingGuidance],
      ["ACCEPT", "mód nélkül nem áll"],
    );
    assert.equal(
      group({ dosing: ok("1 ml/100 L/day") }, { dosingMode: fact("NO_DATA") })
        .dosing,
      "ellentmond: nincs-adat tény",
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
    // the four dosing fields, in the rule's order; only `dosing` has a result here
    assert.deepEqual(
      dry.map((o) => [o.field, o.kind]),
      [
        ["dosing", "WOULD_ACCEPT"],
        ["dosingMode", "SKIP"],
        ["dosingGuidance", "SKIP"],
        ["dosingTests", "SKIP"],
      ],
    );
    assert.equal(accepted.length, 0);
    const wet = await runAutoAccept(["p1"], true, deps(accepted));
    assert.deepEqual(
      wet.map((o) => o.kind),
      ["ACCEPTED", "SKIP", "SKIP", "SKIP"],
    );
    assert.deepEqual(accepted, [["p1", "fr-dosing", AUTO_ACCEPT_RULE]]);
  });

  it("a futtató a csoport döntését írja, nem a mezőnkéntit", async () => {
    const accepted: string[][] = [];
    const out = await runAutoAccept(["p1"], true, {
      ...deps(accepted),
      latestResult: async (_p: string, field: string) =>
        field === "dosing"
          ? dosing()
          : field === "dosingMode"
            ? dosing({ id: "fr-mode", value: "TEST_DEPENDENT" })
            : field === "ean"
              ? ean()
              : null,
    });
    assert.deepEqual(out.map((o) => [o.field, o.kind]).slice(0, 2), [
      ["dosing", "ACCEPTED"],
      ["dosingMode", "SKIP"],
    ]);
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
