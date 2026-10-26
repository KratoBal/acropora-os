import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { ArticleBodyInput } from "@acropora/types";

import type {
  ArticleRepository,
  ArticleSaveOutcome,
} from "./article.repository.js";
import { ArticleService } from "./article.service.js";

/*
  THE ARTICLE BODY SERVICE. What turns these red: a body stored outside the
  full profile (script, on*, an image from a foreign host); a cover or og image
  from a host not on RICH_TEXT_IMAGE_HOSTS; a link to a product or a taxon that
  does not exist; an outcome of the store said wrongly (an approved article
  edited silently must be a 409, not a 200).
*/
const ENV = { RICH_TEXT_IMAGE_HOSTS: "static.acropora.hu" };

function setup(
  outcome: ArticleSaveOutcome = "ok",
  known: { products?: number; taxa?: string[] } = {},
) {
  const saved: ArticleBodyInput[] = [];
  const repository = {
    detail: async () => null,
    editable: async () => true,
    taxonOptions: async () => [
      { key: "ACROPORA", rank: "GENUS", label: "Acropora" },
    ],
    countProducts: async (ids: readonly string[]) =>
      known.products ?? ids.length,
    knownTaxonKeys: async (keys: readonly string[]) =>
      new Set(known.taxa ?? keys),
    save: async (_id: string, input: ArticleBodyInput) => {
      saved.push(input);
      return outcome;
    },
  } as unknown as ArticleRepository;
  return { service: new ArticleService(repository, ENV), saved };
}

const body = (over: Record<string, unknown> = {}) => ({
  slug: "zold-acropora",
  excerpt: "Bevezető",
  bodyHtml: "<p>Szöveg</p>",
  coverImageUrl: "https://static.acropora.hu/a.jpg",
  coverImageAlt: "Kép",
  channels: ["WEBSHOP_BLOG"],
  byline: null,
  seoTitle: null,
  metaDescription: null,
  ogImageUrl: null,
  noindex: false,
  productIds: ["clx0abc123"],
  taxonKeys: ["ACROPORA"],
  ...over,
});

/*
  WHAT THE EDITOR LOADS: the same image host list the save cleans with (a
  malformed entry dropped), and the taxon options, so the editor needs no
  knowledge.view. What turns this red: the editor offered a different list
  than the save uses, or the taxa missing from the answer.
*/
describe("ArticleService.get", () => {
  it("returns the body with the save's image hosts and the taxon options", async () => {
    const repository = {
      detail: async () => null,
      editable: async () => true,
      taxonOptions: async () => [
        { key: "ACROPORA", rank: "GENUS", label: "Acropora" },
      ],
    } as unknown as ArticleRepository;
    const service = new ArticleService(repository, {
      RICH_TEXT_IMAGE_HOSTS: "static.acropora.hu, nem hoszt",
    });
    assert.deepEqual(await service.get("c1"), {
      article: null,
      editable: true,
      imageHosts: ["static.acropora.hu"],
      taxonOptions: [{ key: "ACROPORA", rank: "GENUS", label: "Acropora" }],
    });
  });
});

describe("ArticleService.save", () => {
  it("stores the body through the full profile with the environment's image hosts", async () => {
    const { service, saved } = setup();
    await service.save(
      "c1",
      body({
        bodyHtml:
          '<h2 onclick="x()">Cím</h2><script>alert(1)</script><p><img src="https://static.acropora.hu/b.jpg"><img src="https://tracker.example/p.gif"></p><table><tbody><tr><td>t</td></tr></tbody></table>',
      }),
      "u-1",
    );
    assert.equal(
      saved[0]?.bodyHtml,
      '<h2>Cím</h2><p><img src="https://static.acropora.hu/b.jpg"></p><table><tbody><tr><td>t</td></tr></tbody></table>',
    );
  });

  it("refuses a cover or og image from a foreign host", async () => {
    const { service, saved } = setup();
    for (const field of ["coverImageUrl", "ogImageUrl"])
      await assert.rejects(
        service.save(
          "c1",
          body({ [field]: "https://tracker.example/a.jpg" }),
          "u-1",
        ),
        BadRequestException,
        field,
      );
    assert.equal(saved.length, 0);
  });

  it("refuses a missing product or an unknown taxon before the store", async () => {
    const missing = setup("ok", { products: 0 });
    await assert.rejects(
      missing.service.save("c1", body(), "u-1"),
      BadRequestException,
    );
    const unknown = setup("ok", { taxa: [] });
    await assert.rejects(unknown.service.save("c1", body(), "u-1"), /ACROPORA/);
    assert.equal(missing.saved.length + unknown.saved.length, 0);
  });

  it("refuses an invalid body before the store", async () => {
    const { service, saved } = setup();
    await assert.rejects(
      service.save("c1", body({ slug: "Rossz Slug" }), "u-1"),
      BadRequestException,
    );
    assert.equal(saved.length, 0);
  });

  it("says each refusal of the store in its own words", async () => {
    for (const [outcome, error] of [
      ["missing", NotFoundException],
      ["not-article", ConflictException],
      ["not-editable", ConflictException],
      ["slug-taken", ConflictException],
    ] as const) {
      const { service } = setup(outcome);
      await assert.rejects(service.save("c1", body(), "u-1"), error, outcome);
    }
  });
});
