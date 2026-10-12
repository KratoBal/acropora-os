import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SeoLandingRow } from "../../seo-landing/seo-landing.service.js";
import {
  landingRecord,
  projectLandingPages,
  type MedusaLandingPageRecord,
} from "./medusa-landing-projection.js";

/*
  THE LANDING PAGE PROJECTION (SEO P1-14). What turns these red: an OS
  category id going to the shop instead of its Medusa twin; a page with an
  unlinked category sent anyway (its filter would silently widen); a write
  when nothing changed; a dry run that writes.
*/
const row = (over: Partial<SeoLandingRow> = {}): SeoLandingRow => ({
  id: "lp-1",
  slug: "led-vilagitas",
  title: "LED világítás",
  seoTitle: null,
  metaDescription: "Válogatás.",
  intro: null,
  filterDefinition: {
    storeCategoryIds: ["cat-1"],
    brandIds: ["brand-1"],
    attributeFilters: [],
  },
  isPublished: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});
const links = new Map([["cat-1", "pcat_01"]]);

function client(current: MedusaLandingPageRecord | null) {
  const writes: MedusaLandingPageRecord[] = [];
  return {
    writes,
    client: {
      fetchLandingPage: async () => current,
      setLandingPage: async (_id: string, record: MedusaLandingPageRecord) => {
        writes.push(record);
        return record;
      },
    },
  };
}

describe("landing page projection", () => {
  it("LANDING-PROJ-RECORD: Medusa category ids, OS brand ids, the page fields", () => {
    const built = landingRecord(row(), links);
    assert.ok("record" in built);
    assert.deepEqual(built.record, {
      handle: "led-vilagitas",
      title: "LED világítás",
      seo_title: null,
      meta_description: "Válogatás.",
      intro: null,
      filter: {
        category_ids: ["pcat_01"],
        os_brand_ids: ["brand-1"],
        attribute_filters: [],
      },
      is_published: true,
    });
  });

  it("LANDING-PROJ-UNLINKED: a category without a shop twin holds the page back", async () => {
    const { client: c, writes } = client(null);
    const out = await projectLandingPages(
      c,
      {
        landingPages: async () => [
          row({
            filterDefinition: { storeCategoryIds: ["cat-2"], brandIds: [] },
          }),
        ],
        categoryLinks: async () => links,
      },
      true,
    );
    assert.equal(out[0]?.status, "refused");
    assert.match(out[0]?.status === "refused" ? out[0].reason : "", /cat-2/);
    assert.equal(writes.length, 0);
  });

  it("LANDING-PROJ-DIFF: written when new or changed, not when the same, not in a dry run", async () => {
    const source = {
      landingPages: async () => [row()],
      categoryLinks: async () => links,
    };
    const fresh = client(null);
    assert.equal(
      (await projectLandingPages(fresh.client, source, true))[0]?.status,
      "sent",
    );
    assert.equal(fresh.writes.length, 1);

    const same = client(fresh.writes[0]!);
    assert.equal(
      (await projectLandingPages(same.client, source, true))[0]?.status,
      "unchanged",
    );
    assert.equal(same.writes.length, 0);

    const dry = client({ ...fresh.writes[0]!, title: "régi" });
    assert.equal(
      (await projectLandingPages(dry.client, source, false))[0]?.status,
      "would-send",
    );
    assert.equal(dry.writes.length, 0);
  });
});
