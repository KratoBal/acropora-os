import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HomepageContentInput } from "@acropora/types";

import {
  homepageRecord,
  homepageRecordDiffers,
  projectHomepageContent,
  projectHomepageContentInRound,
  type MedusaHomepageContentRecord,
} from "./medusa-homepage-projection.js";

/*
  THE HOME PAGE PROJECTION. What turns these red: the slides sent camel-cased
  (the shop's validator is strict and snake-cased); null slides sent as an
  empty list (the shop would show no hero); a write when nothing changed; a
  dry run that writes; nothing stored yet written anyway (an empty record would
  claim every text as the OS's own); the round on by default.
*/
const content = (
  over: Partial<HomepageContentInput> = {},
): HomepageContentInput => ({
  texts: { "mit.cim": "Mit keresel?" },
  slides: null,
  ...over,
});
const slide = {
  eyebrow: "e",
  title: "t",
  text: "x",
  cta: "c",
  ctaHref: "/store",
  cta2: "",
  cta2Href: null,
  caption: "a",
  caption2: "b",
  imageUrl: "https://shop.example/static/a.jpg",
  imageAlt: "alt",
};

function fakeClient(current: MedusaHomepageContentRecord | null) {
  const writes: MedusaHomepageContentRecord[] = [];
  return {
    writes,
    client: {
      fetchHomepageContent: async () => current,
      setHomepageContent: async (r: MedusaHomepageContentRecord) => {
        writes.push(r);
        return r;
      },
    },
  };
}

describe("homepageRecord", () => {
  it("snake-cases the slides and keeps null as null", () => {
    const rec = homepageRecord(content({ slides: [slide] }));
    assert.deepEqual(rec.slides?.[0], {
      eyebrow: "e",
      title: "t",
      text: "x",
      cta: "c",
      cta_href: "/store",
      cta2: "",
      cta2_href: null,
      caption: "a",
      caption2: "b",
      image_url: "https://shop.example/static/a.jpg",
      image_alt: "alt",
    });
    assert.equal(homepageRecord(content()).slides, null);
    assert.deepEqual(homepageRecord(content({ slides: [] })).slides, []);
  });
});

describe("homepageRecordDiffers", () => {
  it("ignores key order, sees a changed text, null versus an empty list, and no record", () => {
    const a = homepageRecord(content({ texts: { a: "1", b: "2" } }));
    const sameOtherOrder = { texts: { b: "2", a: "1" }, slides: null };
    assert.equal(homepageRecordDiffers(sameOtherOrder, a), false);
    assert.equal(
      homepageRecordDiffers({ texts: { a: "1", b: "3" }, slides: null }, a),
      true,
    );
    assert.equal(
      homepageRecordDiffers({ texts: a.texts, slides: [] }, a),
      true,
    );
    assert.equal(homepageRecordDiffers(null, a), true);
  });
});

describe("projectHomepageContent", () => {
  it("writes when the shop differs, once", async () => {
    const { client, writes } = fakeClient(null);
    const out = await projectHomepageContent(
      client,
      { content: async () => content(), switchedOn: async () => true },
      true,
    );
    assert.equal(out.status, "sent");
    assert.equal(writes.length, 1);
  });

  it("does not write when nothing changed, or on a dry run", async () => {
    const same = fakeClient(homepageRecord(content()));
    assert.equal(
      (
        await projectHomepageContent(
          same.client,
          { content: async () => content(), switchedOn: async () => true },
          true,
        )
      ).status,
      "unchanged",
    );
    assert.equal(same.writes.length, 0);
    const dry = fakeClient(null);
    assert.equal(
      (
        await projectHomepageContent(
          dry.client,
          { content: async () => content(), switchedOn: async () => true },
          false,
        )
      ).status,
      "would-send",
    );
    assert.equal(dry.writes.length, 0);
  });

  it("sends nothing when nothing is stored", async () => {
    const { client, writes } = fakeClient(null);
    const out = await projectHomepageContent(
      client,
      { content: async () => null, switchedOn: async () => true },
      true,
    );
    assert.equal(out.status, "nothing");
    assert.equal(writes.length, 0);
  });
});

describe("projectHomepageContentInRound", () => {
  const source = (on: boolean) => ({ switchedOn: async () => on });

  it("is off unless the variable is exactly true or the administrator's switch is on", async () => {
    assert.equal(await projectHomepageContentInRound({}, source(false)), false);
    assert.equal(
      await projectHomepageContentInRound(
        { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "false" },
        source(false),
      ),
      false,
    );
    assert.equal(
      await projectHomepageContentInRound(
        { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "1" },
        source(false),
      ),
      false,
    );
    assert.equal(
      await projectHomepageContentInRound(
        { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "true" },
        source(false),
      ),
      true,
    );
  });

  it("the administrator's switch alone turns it on, with no variable at all", async () => {
    assert.equal(await projectHomepageContentInRound({}, source(true)), true);
  });
});
