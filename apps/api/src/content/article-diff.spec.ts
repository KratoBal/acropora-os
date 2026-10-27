import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import {
  articleDiff,
  blockDiff,
  bodyBlocks,
  sequenceDiff,
  type ArticleSnapshot,
} from "./article-diff.js";
import type { ArticleRepository } from "./article.repository.js";
import { ArticleService } from "./article.service.js";

/*
  TWO VERSIONS OF AN ARTICLE COMPARED (research plan v4, 9.2 S5). What turns
  these red: a changed paragraph shown as unchanged, or as unrelated removed and
  added text; the words of a change that do not give back both texts; a field
  change left out; a revision of another article compared; a comparison of a
  version with itself.
*/
const snapshot = (over: Partial<ArticleSnapshot> = {}): ArticleSnapshot => ({
  title: "Foszfát",
  excerpt: "Bevezető",
  bodyHtml: "<p>Első bekezdés.</p><p>Második bekezdés.</p>",
  byline: null,
  seoTitle: null,
  metaDescription: null,
  coverImageUrl: null,
  coverImageAlt: null,
  ogImageUrl: null,
  channels: ["WEBSHOP_BLOG"],
  noindex: false,
  ...over,
});

const joined = (
  segments: { kind: string; text: string }[],
  keep: "removed" | "added",
) =>
  segments
    .filter((s) => s.kind === "same" || s.kind === keep)
    .map((s) => s.text)
    .join("");

describe("sequenceDiff", () => {
  it("keeps the common part and orders removed before added", () => {
    assert.deepEqual(
      sequenceDiff(["a", "b", "c"], ["a", "x", "c"]).map(
        (o) => `${o.kind}:${o.value}`,
      ),
      ["same:a", "removed:b", "added:x", "same:c"],
    );
  });
});

describe("blockDiff", () => {
  it("shows an edited paragraph as one changed block whose words give back both texts", () => {
    const before = "A foszfát 0,05 mg/l mellett csökkentette a kalcifikációt.";
    const after = "A foszfát 0,1 mg/l mellett csökkentette a kalcifikációt.";
    const [block] = blockDiff([before], [after]);
    assert.equal(block?.kind, "changed");
    const segments = block?.kind === "changed" ? block.segments : [];
    assert.equal(joined(segments, "removed"), before);
    assert.equal(joined(segments, "added"), after);
    assert.deepEqual(
      segments
        .filter((s) => s.kind !== "same")
        .map((s) => `${s.kind}:${s.text}`),
      ["removed:0,05", "added:0,1"],
    );
  });

  it("keeps an unpaired paragraph removed or added", () => {
    assert.deepEqual(
      blockDiff(["egy", "kettő"], ["egy", "három", "négy"]).map((b) => b.kind),
      ["same", "changed", "added"],
    );
    assert.deepEqual(
      blockDiff(["egy", "kettő"], ["egy"]).map((b) => b.kind),
      ["same", "removed"],
    );
  });
});

describe("the comparison's cell budget", () => {
  it("is shared by every table of one comparison: past it, a changed paragraph reads as replaced whole", () => {
    // 2x2 paragraph cells, then 5x5 word cells per pair: room for the first pair only
    const budget = { cells: 4 + 25 };
    const blocks = blockDiff(["a b c", "d e f"], ["a x c", "d y f"], budget);
    assert.deepEqual(
      blocks.map((b) =>
        b.kind === "changed"
          ? b.segments.map((s) => `${s.kind}:${s.text}`).join("|")
          : b.kind,
      ),
      ["same:a |removed:b|added:x|same: c", "removed:d e f|added:d y f"],
    );
    assert.equal(budget.cells, 0);
  });

  it("spends nothing on a table it refuses", () => {
    const budget = { cells: 3 };
    assert.deepEqual(
      sequenceDiff(["a", "b"], ["a", "b"], budget).map((o) => o.kind),
      ["removed", "removed", "added", "added"],
    );
    assert.equal(budget.cells, 3);
  });
});

describe("articleDiff", () => {
  it("is identical for the same snapshot, and markup alone is no change", () => {
    assert.equal(articleDiff(snapshot(), snapshot()).identical, true);
    assert.equal(
      articleDiff(
        snapshot(),
        snapshot({
          bodyHtml:
            "<p><strong>Első</strong> bekezdés.</p><p>Második bekezdés.</p>",
        }),
      ).identical,
      true,
    );
  });

  it("names the public fields that differ", () => {
    const d = articleDiff(
      snapshot(),
      snapshot({
        title: "Foszfát SPS-ben",
        noindex: true,
        channels: ["WEBSHOP_BLOG", "REEFCLUB"],
      }),
    );
    assert.deepEqual(
      d.fields.map((f) => `${f.field}:${f.before}>${f.after}`),
      [
        "title:Foszfát>Foszfát SPS-ben",
        "channels:WEBSHOP_BLOG>REEFCLUB, WEBSHOP_BLOG",
        "noindex:nem>igen",
      ],
    );
    assert.equal(d.identical, false);
  });

  it("reads the body as plain paragraphs", () => {
    assert.deepEqual(
      bodyBlocks("<h2>Cím</h2><p>Egy.</p><ul><li><p>a</p></li></ul>"),
      ["Cím", "Egy.", "- a"],
    );
  });
});

describe("ArticleService.diff", () => {
  const service = (
    snapshots: Record<string, ArticleSnapshot | undefined>,
    asked: string[] = [],
  ) =>
    new ArticleService(
      {
        snapshot: async (_contentId: string, ref: string) => {
          asked.push(ref);
          const s = snapshots[ref];
          return s
            ? {
                side:
                  ref === "current"
                    ? {
                        kind: "current" as const,
                        updatedAt: "2026-10-27T00:00:00.000Z",
                      }
                    : {
                        kind: "revision" as const,
                        id: ref,
                        approvedAt: "2026-10-26T00:00:00.000Z",
                      },
                snapshot: s,
              }
            : null;
        },
      } as unknown as ArticleRepository,
      {},
    );

  it("compares a revision with the body being edited by default", async () => {
    const d = await service({
      r1: snapshot(),
      current: snapshot({ excerpt: "Új bevezető" }),
    }).diff("a1", "r1");
    assert.equal(d.from.kind, "revision");
    assert.equal(d.to.kind, "current");
    assert.deepEqual(
      d.fields.map((f) => f.field),
      ["excerpt"],
    );
  });

  it("refuses a missing side, the same version twice, and an empty reference", async () => {
    await assert.rejects(
      service({ current: snapshot() }).diff("a1", "rX"),
      NotFoundException,
    );
    const asked: string[] = [];
    await assert.rejects(
      service({ r1: snapshot() }, asked).diff("a1", "r1", "r1"),
      BadRequestException,
    );
    await assert.rejects(
      service({}, asked).diff("a1", undefined),
      BadRequestException,
    );
    assert.deepEqual(asked, [], "a refused request does not read the store");
  });
});
