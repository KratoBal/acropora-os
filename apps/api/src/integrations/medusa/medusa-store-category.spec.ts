import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  MedusaAdminClient,
  MedusaCategoryInput,
  MedusaCategoryPatch,
  MedusaCategoryRow,
} from "./medusa-admin.client.js";
import type {
  MedusaCategoryLink,
  MedusaStoreCategoryLinkRepository,
} from "./medusa-category-link.repository.js";
import { MedusaStoreCategoryImportService } from "./medusa-store-category-import.service.js";
import { runStoreCategoryCli } from "./medusa-store-category.cli.js";
import { describeVerification } from "./medusa-category.cli.js";
import {
  planStoreCategoryImport,
  storeCategoryTargets,
  type StoreCategoryNode,
} from "./medusa-store-category-tree.js";

const NOW = new Date("2026-10-12T16:00:00.000Z");

function node(
  overrides: Partial<StoreCategoryNode> & { id: string },
): StoreCategoryNode {
  return {
    parentId: null,
    name: overrides.id,
    slug: overrides.id.replace("sc_", ""),
    seoTitle: null,
    metaDescription: null,
    intro: null,
    isActive: true,
    ...overrides,
  };
}

/** Child first on purpose: the targets must come out parent-first. */
const TREE: StoreCategoryNode[] = [
  node({
    id: "sc_szivattyu",
    parentId: "sc_technika",
    name: "Szivattyúk",
    slug: "szivattyuk",
    seoTitle: "Akvárium szivattyúk",
    metaDescription: "Áramoltató és visszanyomó szivattyúk.",
    intro: "Minden, ami a vizet mozgatja.",
  }),
  node({ id: "sc_technika", name: "Technika", slug: "technika" }),
];

function medusaFake(initial: MedusaCategoryRow[] = []) {
  const created: MedusaCategoryInput[] = [];
  const updated: { id: string; patch: MedusaCategoryPatch }[] = [];
  const rows = [...initial];
  let n = 0;
  const client = {
    // eslint-disable-next-line @typescript-eslint/require-await
    async listProductCategories() {
      return { rows: [...rows], truncated: false };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async createProductCategory(input: MedusaCategoryInput) {
      created.push(input);
      n += 1;
      const row: MedusaCategoryRow = {
        id: `pcat_new_${n}`,
        name: input.name,
        external_id: input.external_id,
        parent_category_id: input.parent_category_id ?? null,
        is_active: input.is_active,
        handle: input.handle,
        description: input.description ?? null,
        metadata: input.metadata ?? null,
      };
      rows.push(row);
      return row;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async updateProductCategory(id: string, patch: MedusaCategoryPatch) {
      updated.push({ id, patch });
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`no such category: ${id}`);
      Object.assign(row, patch);
      return row;
    },
  } as unknown as MedusaAdminClient;
  return { client, created, updated };
}

function linksFake(initial: MedusaCategoryLink[] = []) {
  const calls: string[] = [];
  const rows = [...initial];
  const put = (categoryId: string, medusaCategoryId: string) => {
    const i = rows.findIndex((l) => l.categoryId === categoryId);
    const row = { categoryId, medusaCategoryId, lastSyncedAt: NOW };
    if (i === -1) rows.push(row);
    else rows[i] = row;
    return row;
  };
  const links = {
    // eslint-disable-next-line @typescript-eslint/require-await
    async all() {
      return [...rows];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async link(categoryId: string, medusaCategoryId: string) {
      calls.push(`link ${categoryId} ${medusaCategoryId}`);
      return put(categoryId, medusaCategoryId);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async relink(categoryId: string, medusaCategoryId: string) {
      calls.push(`relink ${categoryId} ${medusaCategoryId}`);
      return put(categoryId, medusaCategoryId);
    },
  } as unknown as MedusaStoreCategoryLinkRepository;
  return { links, calls };
}

describe("the Acropora tree's targets", () => {
  it("handle is the slug, name has no suffix, intro and SEO fields go along", () => {
    const targets = storeCategoryTargets(TREE);

    assert.deepEqual(
      targets.map((t) => t.ourId),
      ["sc_technika", "sc_szivattyu"],
    );
    assert.deepEqual(targets[1], {
      ourId: "sc_szivattyu",
      parentOurId: "sc_technika",
      name: "Szivattyúk",
      handle: "szivattyuk",
      isActive: true,
      description: "Minden, ami a vizet mozgatja.",
      metadata: {
        seo_title: "Akvárium szivattyúk",
        seo_description: "Áramoltató és visszanyomó szivattyúk.",
      },
    });
    // unset fields go out empty, not missing: Medusa takes no null here
    assert.equal(targets[0]?.description, "");
    assert.deepEqual(targets[0]?.metadata, {
      seo_title: "",
      seo_description: "",
    });
  });

  /**
   * THE WHOLE TREE GOES OUT (barracuda, #1675 review): a product in an inactive
   * category needs that category's twin, or its list is never complete. The
   * flag is the effective one: under an inactive parent, inactive too.
   */
  it("an inactive category goes out inactive, and so does its active child", () => {
    const targets = storeCategoryTargets([
      node({ id: "sc_regi", isActive: false }),
      node({ id: "sc_alatta", parentId: "sc_regi" }),
      node({ id: "sc_mas" }),
    ]);

    assert.deepEqual(
      targets.map((t) => [t.ourId, t.isActive]),
      [
        ["sc_regi", false],
        ["sc_alatta", false],
        ["sc_mas", true],
      ],
    );
  });
});

describe("the Acropora tree's plan", () => {
  const targets = storeCategoryTargets(TREE);

  /**
   * THE STAGE SHOP ALREADY HOLDS 219 IMPORTED CATEGORIES, and Medusa's handle
   * is unique. A taken handle is planned, not hit mid-run.
   */
  it("a handle held by a category that is not ours is not created", () => {
    const plan = planStoreCategoryImport(targets, [
      {
        id: "pcat_import",
        externalId: null,
        parentId: null,
        handle: "technika",
        name: "Technika (import)",
        isActive: true,
        description: null,
        metadata: null,
      },
    ]);

    assert.deepEqual(plan.handleTaken, [
      { ourId: "sc_technika", handle: "technika", heldBy: "pcat_import" },
    ]);
    assert.deepEqual(
      plan.create.map((c) => c.ourId),
      ["sc_szivattyu"],
    );
  });

  it("an unchanged category is skipped with no update", () => {
    const plan = planStoreCategoryImport(
      targets,
      [
        {
          id: "pcat_t",
          externalId: "sc_technika",
          parentId: null,
          handle: "technika",
          name: "Technika",
          isActive: true,
          description: "",
          // a foreign key does not make a difference
          metadata: { seo_title: "", seo_description: "", idegen: "marad" },
        },
      ],
      [{ ourId: "sc_technika", medusaId: "pcat_t" }],
    );

    assert.deepEqual(plan.skip, ["sc_technika"]);
    assert.deepEqual(plan.update, []);
  });

  it("a changed SEO field updates the category with all four fields", () => {
    const plan = planStoreCategoryImport(
      targets,
      [
        {
          id: "pcat_t",
          externalId: "sc_technika",
          parentId: null,
          handle: "technika",
          name: "Technika",
          isActive: true,
          description: "",
          metadata: null,
        },
        {
          id: "pcat_sz",
          externalId: "sc_szivattyu",
          parentId: "pcat_t",
          handle: "szivattyuk",
          name: "Szivattyúk",
          isActive: true,
          description: "Minden, ami a vizet mozgatja.",
          metadata: { seo_title: "régi cím", seo_description: "" },
        },
      ],
      [
        { ourId: "sc_technika", medusaId: "pcat_t" },
        { ourId: "sc_szivattyu", medusaId: "pcat_sz" },
      ],
    );

    assert.deepEqual(plan.update, [
      {
        ourId: "sc_szivattyu",
        medusaId: "pcat_sz",
        parentOurId: "sc_technika",
        changed: ["metadata"],
        patch: {
          name: "Szivattyúk",
          handle: "szivattyuk",
          is_active: true,
          description: "Minden, ami a vizet mozgatja.",
          metadata: {
            seo_title: "Akvárium szivattyúk",
            seo_description: "Áramoltató és visszanyomó szivattyúk.",
          },
        },
      },
    ]);
  });

  it("a category switched on in our tree is switched on in Medusa", () => {
    const plan = planStoreCategoryImport(
      targets,
      [
        {
          id: "pcat_t",
          externalId: "sc_technika",
          parentId: null,
          handle: "technika",
          name: "Technika",
          isActive: false,
          description: "",
          metadata: null,
        },
      ],
      [{ ourId: "sc_technika", medusaId: "pcat_t" }],
    );

    assert.deepEqual(
      plan.update.map((u) => [u.ourId, u.changed, u.patch.is_active]),
      [["sc_technika", ["is_active"], true]],
    );
  });

  /**
   * A MOVE IN OUR TREE (barracuda, #1677 review). Every other field is the
   * same, so without the parent this read "unchanged" and the shop kept the
   * old chain. The root case is the same rule the other way round.
   */
  it("a category moved in our tree is updated, and so is one made a root", () => {
    const plan = planStoreCategoryImport(
      storeCategoryTargets([
        node({ id: "sc_technika", name: "Technika", slug: "technika" }),
        node({
          id: "sc_szivattyu",
          parentId: "sc_technika",
          name: "Szivattyúk",
          slug: "szivattyuk",
        }),
        node({ id: "sc_gyoker", name: "Gyökér", slug: "gyoker" }),
      ]),
      (
        [
          ["pcat_t", "sc_technika", null, "technika", "Technika"],
          ["pcat_sz", "sc_szivattyu", "pcat_regi", "szivattyuk", "Szivattyúk"],
          ["pcat_gy", "sc_gyoker", "pcat_t", "gyoker", "Gyökér"],
        ] as [string, string, string | null, string, string][]
      ).map(([id, externalId, parentId, handle, name]) => ({
        id,
        externalId,
        parentId,
        handle,
        name,
        isActive: true,
        description: "",
        metadata: null,
      })),
      [
        { ourId: "sc_technika", medusaId: "pcat_t" },
        { ourId: "sc_szivattyu", medusaId: "pcat_sz" },
        { ourId: "sc_gyoker", medusaId: "pcat_gy" },
      ],
    );

    assert.deepEqual(
      plan.update.map((u) => [u.ourId, u.parentOurId, u.changed]),
      [
        ["sc_szivattyu", "sc_technika", ["parent"]],
        ["sc_gyoker", null, ["parent"]],
      ],
    );
  });

  it("a slug moved onto a taken handle is not updated", () => {
    const plan = planStoreCategoryImport(
      targets,
      [
        {
          id: "pcat_t",
          externalId: "sc_technika",
          parentId: null,
          handle: "technika-regi",
          name: "Technika",
          isActive: true,
          description: "",
          metadata: null,
        },
        {
          id: "pcat_import",
          externalId: null,
          parentId: null,
          handle: "technika",
          name: "Technika (import)",
          isActive: true,
          description: null,
          metadata: null,
        },
      ],
      [{ ourId: "sc_technika", medusaId: "pcat_t" }],
    );

    assert.deepEqual(plan.update, []);
    assert.deepEqual(plan.handleTaken, [
      { ourId: "sc_technika", handle: "technika", heldBy: "pcat_import" },
    ]);
  });
});

describe("the Acropora tree's load", () => {
  it("creates parent first, with handle, intro and SEO keys, and links under its own repository", async () => {
    const { client, created } = medusaFake();
    const { links, calls } = linksFake();

    const report = await new MedusaStoreCategoryImportService(links).run(
      client,
      TREE,
      NOW,
    );

    assert.deepEqual(created, [
      {
        name: "Technika",
        external_id: "sc_technika",
        parent_category_id: null,
        handle: "technika",
        is_active: true,
        description: "",
        metadata: { seo_title: "", seo_description: "" },
      },
      {
        name: "Szivattyúk",
        external_id: "sc_szivattyu",
        parent_category_id: "pcat_new_1",
        handle: "szivattyuk",
        is_active: true,
        description: "Minden, ami a vizet mozgatja.",
        metadata: {
          seo_title: "Akvárium szivattyúk",
          seo_description: "Áramoltató és visszanyomó szivattyúk.",
        },
      },
    ]);
    assert.deepEqual(calls, [
      "link sc_technika pcat_new_1",
      "link sc_szivattyu pcat_new_2",
    ]);
    assert.deepEqual(report.verification, {
      carryingOurId: 2,
      activeAmongThem: 2,
      mappingRowsHere: 2,
      expected: 2,
      expectedActive: 2,
    });
  });

  it("a category moved under a parent created in the same run points at it", async () => {
    const { client, updated } = medusaFake([
      {
        id: "pcat_sz",
        name: "Szivattyúk",
        external_id: "sc_szivattyu",
        parent_category_id: "pcat_regi",
        is_active: true,
        handle: "szivattyuk",
        description: "Minden, ami a vizet mozgatja.",
        metadata: {
          seo_title: "Akvárium szivattyúk",
          seo_description: "Áramoltató és visszanyomó szivattyúk.",
        },
      },
    ]);
    const { links } = linksFake([
      {
        categoryId: "sc_szivattyu",
        medusaCategoryId: "pcat_sz",
        lastSyncedAt: NOW,
      },
    ]);

    const report = await new MedusaStoreCategoryImportService(links).run(
      client,
      TREE,
      NOW,
    );

    assert.deepEqual(
      updated.map((u) => [
        u.id,
        (u.patch as { parent_category_id?: string | null }).parent_category_id,
      ]),
      [["pcat_sz", "pcat_new_1"]],
    );
    assert.equal(report.unchanged, 0);
  });

  it("a move under a parent whose handle is taken is blocked, not left on the old parent", async () => {
    const { client, updated } = medusaFake([
      {
        id: "pcat_import",
        name: "Technika (import)",
        external_id: null,
        parent_category_id: null,
        is_active: true,
        handle: "technika",
      },
      {
        id: "pcat_sz",
        name: "Szivattyúk",
        external_id: "sc_szivattyu",
        parent_category_id: "pcat_regi",
        is_active: true,
        handle: "szivattyuk",
      },
    ]);
    const { links } = linksFake([
      {
        categoryId: "sc_szivattyu",
        medusaCategoryId: "pcat_sz",
        lastSyncedAt: NOW,
      },
    ]);

    const report = await new MedusaStoreCategoryImportService(links).run(
      client,
      TREE,
      NOW,
    );

    assert.deepEqual(updated, []);
    assert.deepEqual(report.blockedByConflict, ["sc_szivattyu"]);
  });

  it("an inactive category is created inactive, and the check expects it so", async () => {
    const { client, created } = medusaFake();
    const { links } = linksFake();

    const report = await new MedusaStoreCategoryImportService(links).run(
      client,
      [node({ id: "sc_rejtett", isActive: false }), node({ id: "sc_lathato" })],
      NOW,
    );

    assert.deepEqual(
      created.map((c) => [c.external_id, c.is_active]),
      [
        ["sc_rejtett", false],
        ["sc_lathato", true],
      ],
    );
    assert.deepEqual(report.verification, {
      carryingOurId: 2,
      activeAmongThem: 1,
      mappingRowsHere: 2,
      expected: 2,
      expectedActive: 1,
    });
  });

  it("the child of a category with a taken handle is blocked, not created at the root", async () => {
    const { client, created } = medusaFake([
      {
        id: "pcat_import",
        name: "Technika (import)",
        external_id: null,
        parent_category_id: null,
        is_active: true,
        handle: "technika",
      },
    ]);
    const { links } = linksFake();

    const report = await new MedusaStoreCategoryImportService(links).run(
      client,
      TREE,
      NOW,
    );

    assert.deepEqual(created, []);
    assert.deepEqual(report.handleTaken, ["sc_technika"]);
    assert.deepEqual(report.blockedByConflict, ["sc_szivattyu"]);
  });
});

describe("the Acropora tree's command", () => {
  function collector() {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
      out: {
        stdout: (v: string) => stdout.push(v),
        stderr: (v: string) => stderr.push(v),
      },
      stdout,
      stderr,
    };
  }

  it("without --apply it plans and writes nothing", async () => {
    const { client, created, updated } = medusaFake();
    const { links, calls } = linksFake();
    const { out, stdout } = collector();

    const code = await runStoreCategoryCli([], out, {
      client: async () => client,
      tree: async () => TREE,
      service: () => new MedusaStoreCategoryImportService(links),
      now: () => NOW,
    });

    assert.equal(code, 0);
    assert.deepEqual(created, []);
    assert.deepEqual(updated, []);
    assert.deepEqual(calls, []);
    assert.match(stdout.join(""), /Létrehozandó: 2/);
  });

  it("with --apply, a taken handle is exit 2: done, but a person has to look", async () => {
    const { client } = medusaFake([
      {
        id: "pcat_import",
        name: "Technika (import)",
        external_id: null,
        parent_category_id: null,
        is_active: true,
        handle: "technika",
      },
    ]);
    const { links } = linksFake();
    const { out, stdout } = collector();

    const code = await runStoreCategoryCli(["--apply"], out, {
      client: async () => client,
      tree: async () => TREE,
      service: () => new MedusaStoreCategoryImportService(links),
      now: () => NOW,
    });

    assert.equal(code, 2);
    assert.match(stdout.join(""), /Foglalt webcím, érintetlen: 1/);
  });
});

describe("the verification line with inactive categories", () => {
  it("counts the active ones against the tree, not against all", () => {
    assert.match(
      describeVerification({
        carryingOurId: 3,
        activeAmongThem: 2,
        mappingRowsHere: 3,
        expected: 3,
        expectedActive: 2,
      }),
      /A három szám egyezik/,
    );
    assert.match(
      describeVerification({
        carryingOurId: 3,
        activeAmongThem: 3,
        mappingRowsHere: 3,
        expected: 3,
        expectedActive: 2,
      }),
      /3 kategória aktív a Medusában, a fánk szerint 2 kellene/,
    );
  });
});
