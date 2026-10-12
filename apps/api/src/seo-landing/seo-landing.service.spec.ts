import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

import { MemoryRedirectStore } from "../products/redirect/redirect-memory-store.js";
import {
  SeoLandingService,
  type SeoLandingRow,
  type SeoLandingStore,
} from "./seo-landing.service.js";

/*
  THE SEO LANDING PAGES (SEO P1-14). What turns these red: a slug another
  landing page holds or held given out again; a slug change without the 301
  from the old /hu/valogatas/ address; a page unable to take back its own old
  slug; a filter naming a category or brand that does not exist; an empty
  filter or an attribute filter accepted.
*/
function setup() {
  const rows = new Map<string, SeoLandingRow>();
  const history = new Map<string, string>(); // slug -> landing id
  const redirects = new MemoryRedirectStore();
  let n = 0;
  const store: SeoLandingStore = {
    list: async () => [...rows.values()],
    options: async () => ({ categories: [], brands: [] }),
    find: async (id) => rows.get(id) ?? null,
    slugOwner: async (slug) => {
      for (const row of rows.values())
        if (row.slug === slug) return { landingId: row.id, kind: "live" };
      const old = history.get(slug);
      return old ? { landingId: old, kind: "history" } : null;
    },
    missingCategories: async (ids) => ids.filter((id) => id !== "cat-1"),
    missingBrands: async (ids) => ids.filter((id) => id !== "brand-1"),
    create: async (input) => {
      const row: SeoLandingRow = {
        id: `lp-${++n}`,
        ...input,
        filterDefinition: input.filter,
        createdAt: new Date("2026-10-12T20:00:00Z"),
        updatedAt: new Date("2026-10-12T20:00:00Z"),
      };
      rows.set(row.id, row);
      return row;
    },
    update: async (id, input, slugChange, write) => {
      if (slugChange) {
        if (history.get(input.slug) === id) history.delete(input.slug);
        history.set(slugChange.oldSlug, id);
      }
      const row = {
        ...rows.get(id)!,
        ...input,
        filterDefinition: input.filter,
      };
      rows.set(id, row);
      if (slugChange) await write(redirects);
      return row;
    },
  };
  return { service: new SeoLandingService(store), redirects, history };
}

const body = (over: Record<string, unknown> = {}) => ({
  slug: "led-vilagitas",
  title: "LED világítás",
  seoTitle: null,
  metaDescription: null,
  intro: null,
  filter: { storeCategoryIds: ["cat-1"], brandIds: [] },
  isPublished: true,
  ...over,
});

describe("SeoLandingService", () => {
  it("LANDING-CREATE: a page with a known category, its filter read back", async () => {
    const { service } = setup();
    const page = await service.create(body());
    assert.equal(page.slug, "led-vilagitas");
    assert.deepEqual(page.filter, {
      storeCategoryIds: ["cat-1"],
      brandIds: [],
      attributeFilters: [],
    });
  });

  it("LANDING-IDS: an unknown category or brand is refused, named", async () => {
    const { service } = setup();
    await assert.rejects(
      service.create(
        body({
          filter: { storeCategoryIds: ["cat-x"], brandIds: ["brand-y"] },
        }),
      ),
      (e: unknown) =>
        e instanceof BadRequestException &&
        /cat-x/.test(e.message) &&
        /brand-y/.test(e.message),
    );
  });

  it("LANDING-SLUG-SHAPE: a slug with capitals or spaces is refused", async () => {
    const { service } = setup();
    await assert.rejects(
      service.create(body({ slug: "LED vilagitas" })),
      BadRequestException,
    );
  });

  it("LANDING-RENAME: the old address 301s to the new, and is never given out again", async () => {
    const { service, redirects } = setup();
    const page = await service.create(body());
    await service.update(page.id, body({ slug: "led-lampak" }), "user-1");
    const rule = await redirects.findBySourceLower(
      "/hu/valogatas/led-vilagitas",
    );
    assert.equal(rule?.destinationPath, "/hu/valogatas/led-lampak");
    assert.equal(rule?.isActive, true);
    await assert.rejects(
      service.create(body({ slug: "led-vilagitas" })),
      (e: unknown) =>
        e instanceof ConflictException && /was used by/.test(e.message),
    );
  });

  it("LANDING-TAKE-BACK: a page may take back its own old slug", async () => {
    const { service, history } = setup();
    const page = await service.create(body());
    await service.update(page.id, body({ slug: "led-lampak" }), "user-1");
    const back = await service.update(page.id, body(), "user-1");
    assert.equal(back.slug, "led-vilagitas");
    assert.equal(history.get("led-vilagitas"), undefined);
  });

  it("LANDING-TAKEN: another live page's slug is refused", async () => {
    const { service } = setup();
    await service.create(body());
    const other = await service.create(body({ slug: "masik" }));
    await assert.rejects(
      service.update(other.id, body(), "user-1"),
      (e: unknown) =>
        e instanceof ConflictException && /belongs to/.test(e.message),
    );
  });

  it("LANDING-SAME-SLUG: an edit without a slug change writes no redirect", async () => {
    const { service, redirects } = setup();
    const page = await service.create(body());
    await service.update(page.id, body({ title: "Új cím" }), "user-1");
    assert.equal(
      await redirects.findBySourceLower("/hu/valogatas/led-vilagitas"),
      null,
    );
  });

  it("LANDING-FILTER: an empty filter and an attribute filter are refused", async () => {
    const { service } = setup();
    for (const filter of [
      { storeCategoryIds: [], brandIds: [] },
      {
        storeCategoryIds: ["cat-1"],
        brandIds: [],
        attributeFilters: [{ key: "flowRate", op: "gte", value: 1 }],
      },
    ])
      await assert.rejects(
        service.create(body({ filter })),
        BadRequestException,
      );
  });

  it("LANDING-404: an unknown page is 404 for read and write", async () => {
    const { service } = setup();
    await assert.rejects(service.detail("nincs"), NotFoundException);
    await assert.rejects(
      service.update("nincs", body(), "user-1"),
      NotFoundException,
    );
  });
});
