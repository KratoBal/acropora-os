import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HomepageContentInput } from "@acropora/types";

import {
  homepageRecord,
  homepageRecordDiffers,
  projectHomepageContent,
  projectHomepageContentInRound,
  shopFeaturedHandles,
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

function fakeClient(
  current: MedusaHomepageContentRecord | null,
  handles: Record<string, string | null> = {},
) {
  const writes: MedusaHomepageContentRecord[] = [];
  return {
    writes,
    client: {
      fetchProductHandle: async (id: string) => handles[id] ?? null,
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

  /*
    THE BLOCKS AND THE FOOTER (2026-10-26, acrobot 36394/36397: the test
    backend runs commerce #564/#567). What turns this red: the footer sent
    camel-cased (the shop's validator is strict), or a missing field sent as
    absent instead of null (the shop would keep its old value).
  */
  it("sends the blocks and the footer, snake-cased, and null where the OS has none", () => {
    const blocks = [
      { key: "hero", visible: false },
      { key: "mit-keresel", visible: true },
    ] as HomepageContentInput["blocks"];
    const rec = homepageRecord(
      content({
        blocks,
        footer: {
          intro: "<p>x</p>",
          columns: [
            {
              title: "Bolt",
              links: [{ label: "Korallok", href: "/hu/store" }],
            },
          ],
          social: {
            facebook: "https://fb.example/a",
            instagram: null,
            youtube: null,
          },
          bottomText: "© Acropora",
        },
      }),
    );
    assert.deepEqual(rec.blocks, blocks);
    assert.deepEqual(rec.footer, {
      intro: "<p>x</p>",
      columns: [
        { title: "Bolt", links: [{ label: "Korallok", href: "/hu/store" }] },
      ],
      social: {
        facebook: "https://fb.example/a",
        instagram: null,
        youtube: null,
      },
      bottom_text: "© Acropora",
    });
    const none = homepageRecord(content());
    assert.ok("blocks" in none && none.blocks === null);
    assert.ok("footer" in none && none.footer === null);
  });
});

/*
  THE NEWSLETTER ROW (kirakat-lablec-kep). What turns this red: the key sent
  while the OS has no row (a shop without commerce #577 refuses the whole
  record for an unknown key); the row not snake-cased; the shop's `null`
  answer for an unset row taken as a difference (every round would write).
*/
describe("homepageRecord: the newsletter row", () => {
  const row = {
    enabled: false,
    title: "Hírlevél",
    text: "Iratkozz fel!",
    consentText: "Hozzájárulok.",
    button: "Feliratkozás",
  };

  it("sends the row only when the OS has one, snake-cased", () => {
    assert.equal("newsletter" in homepageRecord(content()), false);
    assert.equal(
      "newsletter" in homepageRecord(content({ newsletter: null })),
      false,
    );
    assert.deepEqual(homepageRecord(content({ newsletter: row })).newsletter, {
      enabled: false,
      title: "Hírlevél",
      text: "Iratkozz fel!",
      consent_text: "Hozzájárulok.",
      button: "Feliratkozás",
    });
  });

  it("takes the shop's null for an unset row as the same, and sees a changed row", () => {
    const plain = homepageRecord(content());
    assert.equal(
      homepageRecordDiffers({ ...plain, newsletter: null } as never, plain),
      false,
    );
    const withRow = homepageRecord(content({ newsletter: row }));
    assert.equal(homepageRecordDiffers(plain, withRow), true);
    const changed = homepageRecord(
      content({ newsletter: { ...row, enabled: true } }),
    );
    assert.equal(homepageRecordDiffers(withRow, changed), true);
    assert.equal(homepageRecordDiffers(withRow, withRow), false);
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

  /*
    THE SHOP'S OWN KEY ORDER (barracuda, #1900): the shop answers from jsonb,
    which reorders an object's keys (shorter first). The same record must not
    look different then, or every round writes again. Measured on the test
    shop's answer, 2026-10-26: a slide came back as cta, cta2, text, title, ...
  */
  it("takes the shop's reordered keys as the same record, and still sees a real change", () => {
    const wanted = homepageRecord(
      content({
        slides: [slide],
        footer: {
          intro: "<p>x</p>",
          columns: [
            { title: "Bolt", links: [{ label: "A", href: "/hu/store" }] },
          ],
          social: { facebook: null, instagram: null, youtube: null },
          bottomText: "©",
        },
      }),
    );
    const reorder = (o: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(o).sort(
          ([a], [b]) => a.length - b.length || (a < b ? -1 : 1),
        ),
      );
    const asJsonb = {
      ...wanted,
      slides: wanted.slides!.map((s) => reorder(s as never)),
      footer: reorder({
        ...wanted.footer!,
        social: reorder(wanted.footer!.social as never),
      } as never),
    } as unknown as MedusaHomepageContentRecord;
    assert.notEqual(JSON.stringify(asJsonb), JSON.stringify(wanted));
    assert.equal(homepageRecordDiffers(asJsonb, wanted), false);
    const changed = {
      ...asJsonb,
      footer: { ...wanted.footer!, bottom_text: "más" },
    };
    assert.equal(homepageRecordDiffers(changed, wanted), true);
    // an array's order is content: a swapped column list differs
    const twoSlides = homepageRecord(
      content({ slides: [slide, { ...slide, title: "2" }] }),
    );
    const swapped = { ...twoSlides, slides: [...twoSlides.slides!].reverse() };
    assert.equal(homepageRecordDiffers(swapped, twoSlides), true);
  });

  it("sees a changed block order or footer, and takes a never-sent one as not set", () => {
    const withBlocks = homepageRecord(
      content({ blocks: [{ key: "hero", visible: true }] as never }),
    );
    const plain = homepageRecord(content());
    assert.equal(homepageRecordDiffers(plain, withBlocks), true);
    // the shop's answer before #564 had no such keys: the same as null
    const { blocks: _b, footer: _f, ...older } = plain;
    assert.equal(homepageRecordDiffers(older, plain), false);
  });
});

describe("projectHomepageContent", () => {
  it("writes when the shop differs, once", async () => {
    const { client, writes } = fakeClient(null);
    const out = await projectHomepageContent(
      client,
      {
        content: async () => content(),
        switchedOn: async () => true,
        featured: async () => [],
        brands: async () => null,
      },
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
          {
            content: async () => content(),
            switchedOn: async () => true,
            featured: async () => [],
            brands: async () => null,
          },
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
          {
            content: async () => content(),
            switchedOn: async () => true,
            featured: async () => [],
            brands: async () => null,
          },
          false,
        )
      ).status,
      "would-send",
    );
    assert.equal(dry.writes.length, 0);
  });

  /*
    A ROW CLEARED THROUGH THE API (barracuda, #1913). What turns this red: the
    shop's row never cleared (absent keeps it) and every round writing again;
    a `null` sent to a shop that never answered the key (one without #577).
  */
  it("clears the shop's newsletter row when the OS holds null, once, and never sends the key to a shop without it", async () => {
    const source = {
      content: async () => content({ newsletter: null }),
      switchedOn: async () => true,
      featured: async () => [],
      brands: async () => null,
    };
    const shopRow = {
      enabled: true,
      title: "Hírlevél",
      text: "Iratkozz fel!",
      consent_text: "Hozzájárulok.",
      button: "Feliratkozás",
    };
    const held = fakeClient({
      ...homepageRecord(content()),
      newsletter: shopRow,
    });
    assert.equal(
      (await projectHomepageContent(held.client, source, true)).status,
      "sent",
    );
    assert.equal(held.writes[0]?.newsletter, null);
    // the next round: the shop answers null, nothing to write
    const cleared = fakeClient(held.writes[0]!);
    assert.equal(
      (await projectHomepageContent(cleared.client, source, true)).status,
      "unchanged",
    );
    // a shop that never answered the key gets no key
    const older = fakeClient(null);
    await projectHomepageContent(older.client, source, true);
    assert.equal("newsletter" in older.writes[0]!, false);
  });

  it("sends nothing when nothing is stored", async () => {
    const { client, writes } = fakeClient(null);
    const out = await projectHomepageContent(
      client,
      {
        content: async () => null,
        switchedOn: async () => true,
        featured: async () => [],
        brands: async () => null,
      },
      true,
    );
    assert.equal(out.status, "nothing");
    assert.equal(writes.length, 0);
  });
});

describe("the featured band", () => {
  const source = (
    ids: string[],
    stored: HomepageContentInput | null = content(),
  ) => ({
    content: async () => stored,
    switchedOn: async () => true,
    featured: async () => ids,
    brands: async () => null,
  });

  it("sends the shop's own handles of the marked products, in order, and leaves out a product the shop lost", async () => {
    const { client, writes } = fakeClient(null, { m1: "k-1", m3: "k-3" });
    const out = await projectHomepageContent(
      client,
      source(["m1", "m2", "m3"]),
      true,
    );
    assert.equal(out.status, "sent");
    assert.deepEqual(writes[0]?.featured_handles, ["k-1", "k-3"]);
  });

  it("sends only handles the shop's validator accepts: pattern, unique, at most twelve; the rest is named, never sent (barracuda, #1723)", async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `k-${i}`);
    const raw = [
      "Nagy-Betu",
      "k-0",
      "k-0",
      "a..b",
      "a/b",
      "-x",
      ...twelve.slice(1),
      "k-extra",
      "ekezetes-é",
    ];
    const handles = Object.fromEntries(raw.map((h, i) => [`m${i}`, h]));
    const { client, writes } = fakeClient(null, handles);
    const out = await projectHomepageContent(
      client,
      source(Object.keys(handles)),
      true,
    );
    assert.equal(out.status, "sent");
    assert.deepEqual(writes[0]?.featured_handles, twelve);
    assert.equal(new Set(writes[0]?.featured_handles).size, 12);
    for (const h of writes[0]?.featured_handles ?? [])
      assert.match(h, /^[a-z0-9][a-z0-9._-]*$/);
    assert.ok("skippedHandles" in out);
    assert.deepEqual("skippedHandles" in out ? out.skippedHandles : [], [
      "Nagy-Betu",
      "k-0",
      "a..b",
      "a/b",
      "-x",
      "k-extra",
      "ekezetes-é",
    ]);
  });

  it("shopFeaturedHandles keeps the order and drops nothing valid below the limit", () => {
    assert.deepEqual(shopFeaturedHandles(["b", "a", "c-1"]), {
      handles: ["b", "a", "c-1"],
      skipped: [],
    });
    assert.deepEqual(shopFeaturedHandles([]), { handles: [], skipped: [] });
  });

  it("marked products with nothing stored still send (texts empty, slides not set)", async () => {
    const { client, writes } = fakeClient(null, { m1: "k-1" });
    const out = await projectHomepageContent(
      client,
      source(["m1"], null),
      true,
    );
    assert.equal(out.status, "sent");
    assert.deepEqual(writes[0], {
      texts: {},
      slides: null,
      featured_handles: ["k-1"],
      blocks: null,
      footer: null,
    });
  });

  it("nothing stored and nothing marked sends nothing", async () => {
    const { client, writes } = fakeClient(null);
    assert.equal(
      (await projectHomepageContent(client, source([], null), true)).status,
      "nothing",
    );
    assert.equal(writes.length, 0);
  });

  it("a changed band is a difference, an unchanged one is not, and none equals an empty list", async () => {
    const base = homepageRecord(content(), ["k-1"]);
    const { client, writes } = fakeClient(base, { m1: "k-1", m2: "k-2" });
    assert.equal(
      (await projectHomepageContent(client, source(["m1"]), true)).status,
      "unchanged",
    );
    assert.equal(
      (await projectHomepageContent(client, source(["m1", "m2"]), true)).status,
      "sent",
    );
    assert.deepEqual(writes[0]?.featured_handles, ["k-1", "k-2"]);
    assert.equal(
      homepageRecordDiffers(
        { texts: {}, slides: null, featured_handles: null },
        homepageRecord({ texts: {}, slides: null }),
      ),
      false,
    );
    assert.equal(
      homepageRecordDiffers(
        { texts: {}, slides: null },
        homepageRecord({ texts: {}, slides: null }, ["x"]),
      ),
      true,
    );
  });
});

describe("projectHomepageContentInRound", () => {
  const source = (on: boolean) => ({ switchedOn: async () => on });
  const allowed = { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "true" };

  it("is an AND: the variable exactly true AND the administrator's switch", async () => {
    assert.equal(
      await projectHomepageContentInRound(allowed, source(true)),
      true,
    );
    assert.equal(
      await projectHomepageContentInRound(allowed, source(false)),
      false,
    );
  });

  it("the switch alone never turns it on, whatever the variable says (acrobot 33495)", async () => {
    for (const env of [
      {},
      { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "false" },
      { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "1" },
      { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "TRUE" },
    ])
      assert.equal(
        await projectHomepageContentInRound(env, source(true)),
        false,
      );
  });
});

/*
  THE LOGO STRIP'S BRANDS (Balázs, 2026-10-27; commerce #575). What turns these
  red: the key sent while the OS never set a list (a shop without #575 would
  refuse the whole record); the order not kept; a set list not compared, so a
  changed strip never reaches the shop; an emptied list not sent.
*/
describe("the logo strip's brands", () => {
  const source = (brands: string[] | null) => ({
    content: async () => content(),
    switchedOn: async () => true,
    featured: async () => [],
    brands: async () => brands,
  });

  it("a list never set is not sent at all", async () => {
    assert.equal("featured_brand_handles" in homepageRecord(content()), false);
    const { client, writes } = fakeClient(null);
    await projectHomepageContent(client, source(null), true);
    assert.equal("featured_brand_handles" in (writes[0] ?? {}), false);
  });

  it("a set list is sent in order, and a change of order or an emptied list is a difference", async () => {
    const { client, writes } = fakeClient(null);
    await projectHomepageContent(client, source(["triton", "d-d"]), true);
    assert.deepEqual(writes[0]?.featured_brand_handles, ["triton", "d-d"]);
    const sent = homepageRecord(content(), [], ["triton", "d-d"]);
    assert.equal(
      homepageRecordDiffers(
        sent,
        homepageRecord(content(), [], ["d-d", "triton"]),
      ),
      true,
    );
    assert.equal(
      homepageRecordDiffers(sent, homepageRecord(content(), [], [])),
      true,
    );
    assert.equal(
      homepageRecordDiffers(
        sent,
        homepageRecord(content(), [], ["triton", "d-d"]),
      ),
      false,
    );
    // the shop never had the list: a set one is a difference
    assert.equal(homepageRecordDiffers(homepageRecord(content()), sent), true);
  });

  it("an unchanged strip is not written again", async () => {
    const same = fakeClient(homepageRecord(content(), [], ["triton"]));
    const out = await projectHomepageContent(
      same.client,
      source(["triton"]),
      true,
    );
    assert.equal(out.status, "unchanged");
    assert.equal(same.writes.length, 0);
  });
});
