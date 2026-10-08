import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_QUOTE_TEMPLATES } from "./quote-template-defaults.js";
import { runQuoteTemplatesSeed } from "./quote-templates-seed.cli.js";
import { templateBody, templateDto } from "./quote-templates.service.js";

const quiet = () => {
  const lines: string[] = [];
  return {
    lines,
    out: {
      stdout: (t: string) => lines.push(t),
      stderr: (t: string) => lines.push(t),
    },
  };
};

describe("the starting templates (Figma 579:2243)", () => {
  it("are the frame's four, with its block counts, and pass the editor's rules", () => {
    assert.deepEqual(
      DEFAULT_QUOTE_TEMPLATES.map((t) => [t.name, t.blocks.length]),
      [
        ["Komplett akvárium kivitelezés", 6],
        ["Technikai rendszer ajánlat", 5],
        ["Szerviz / fejlesztési ajánlat", 4],
        ["English complete aquarium", 6],
      ],
    );
    for (const t of DEFAULT_QUOTE_TEMPLATES) {
      const body = templateBody(t);
      const sum = (body.milestones as Array<{ percent: string }>).reduce(
        (s, m) => s + Number(m.percent),
        0,
      );
      assert.equal(sum, 100, t.name);
    }
  });
});

describe("the seed command", () => {
  function deps(existing: string[]) {
    const created: string[] = [];
    return {
      created,
      deps: {
        names: async () => [...existing, ...created],
        create: async (t: { name: string }) => {
          created.push(t.name);
        },
      },
    };
  }

  it("without --apply writes nothing", async () => {
    const { created, deps: d } = deps([]);
    const { lines, out } = quiet();
    assert.equal(await runQuoteTemplatesSeed([], out, d), 0);
    assert.deepEqual(created, []);
    assert.match(lines.join(""), /4 sablont vennék fel/);
  });

  it("with --apply adds only the missing ones, and a second run adds none", async () => {
    const { created, deps: d } = deps(["Technikai rendszer ajánlat"]);
    const { out } = quiet();
    await runQuoteTemplatesSeed(["--apply"], out, d);
    assert.deepEqual(created, [
      "Komplett akvárium kivitelezés",
      "Szerviz / fejlesztési ajánlat",
      "English complete aquarium",
    ]);
    const second = quiet();
    await runQuoteTemplatesSeed(["--apply"], second.out, d);
    assert.equal(created.length, 3);
    assert.match(second.lines.join(""), /mind megvan/);
  });

  it("a broken template stops the run before any write", async () => {
    const { created, deps: d } = deps([]);
    const { out } = quiet();
    const code = await runQuoteTemplatesSeed(["--apply"], out, d, [
      ...DEFAULT_QUOTE_TEMPLATES,
      {
        name: "Hibás",
        priceDisplay: "NET",
        defaultValidityDays: 30,
        blocks: [{ kind: "TERMS", title: "Feltételek" }],
        milestones: [],
      },
    ]);
    assert.equal(code, 1);
    assert.deepEqual(created, []);
  });
});

describe("a stored template, read back", () => {
  it("a broken row lists with empty parts instead of throwing", () => {
    const dto = templateDto({
      id: "t",
      name: "Régi",
      blocks: { not: "an array" },
      milestones: [{ label: 1 }],
      priceDisplay: "WEIRD",
      defaultValidityDays: 30,
      archivedAt: null,
      updatedAt: new Date("2026-10-08T00:00:00Z"),
    });
    assert.deepEqual(dto.blocks, []);
    assert.deepEqual(dto.milestones, []);
    assert.equal(dto.priceDisplay, "NET");
  });
});
