import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HOMEPAGE_BLOCK_KEYS,
  HOMEPAGE_LIMITS,
  HOMEPAGE_NEWSLETTER_DEFAULT,
  HOMEPAGE_TEXT_FIELDS,
  isShopHref,
  isShortTextKey,
  looksLikeShortHtml,
  normalizeShopHref,
  parseHomepageContentInput,
} from "./homepage-content.js";

/*
  THE HOME PAGE CONTENT INPUT. What turns these red: a key that is not in the
  catalogue accepted (a typo would reach the shop and show nowhere); a link or
  an image that leaves the shop or runs script (including the backslash form,
  barracuda #551); a sixth slide; an unknown slide field; null slides mixed up
  with an empty list; a catalogue with a duplicate key or a bad key shape (the
  shop's validator would answer 400 and the editor could not save).
*/
const slide = (over: Record<string, unknown> = {}) => ({
  eyebrow: "Új szállítmány",
  title: "Friss korallok",
  text: "Szöveg.",
  cta: "Korallok",
  ctaHref: "/store",
  cta2: "",
  cta2Href: null,
  caption: "A fotón",
  caption2: "Példány",
  imageUrl: "https://shop.example/static/a.jpg",
  imageAlt: "Egy korall",
  ...over,
});
const ok = (body: unknown) => parseHomepageContentInput(body).ok;
const input = (over: Record<string, unknown> = {}) => ({
  texts: { "mit.cim": "Mit keresel?" },
  slides: [slide()],
  ...over,
});

describe("the home page catalogue", () => {
  it("has unique keys in the shop's key shape, within the shop's limits", () => {
    const keys = HOMEPAGE_TEXT_FIELDS.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.length > 100);
    assert.ok(keys.length <= HOMEPAGE_LIMITS.textKeys);
    for (const f of HOMEPAGE_TEXT_FIELDS) {
      assert.match(f.key, /^[a-z0-9][a-z0-9_.-]{0,79}$/);
      assert.ok(f.default.length <= HOMEPAGE_LIMITS.textValue);
      if (f.type !== "text")
        assert.ok(
          ok({ texts: { [f.key]: f.default }, slides: null }),
          `${f.key} default is a safe address`,
        );
    }
  });
});

describe("the starting link targets", () => {
  it("point only at routes the shop is known to have (commerce #554)", () => {
    const known = new Set(["", "/store", "/hamarosan/szolgaltatasok"]);
    for (const f of HOMEPAGE_TEXT_FIELDS)
      if (f.type === "link")
        assert.ok(known.has(f.default), `${f.key}: ${f.default}`);
  });

  it("marks the invented facts as samples, the plain titles and buttons not", () => {
    const sample = new Set(
      HOMEPAGE_TEXT_FIELDS.filter((f) => f.sample).map((f) => f.key),
    );
    for (const key of [
      "hero.tenyek.3.cim",
      "velemenyek.1.idezet",
      "markak.1",
      "bolt.cim_ertek",
      "bolt.nyitva_ertek",
      "halado.1.szoveg",
      "halado.3.szoveg",
    ])
      assert.ok(sample.has(key), key);
    for (const key of ["mit.cim", "kezdo.cim", "bolt.gomb.felirat"])
      assert.ok(!sample.has(key), key);
  });
});

describe("parseHomepageContentInput", () => {
  it("takes the editor's record: texts, none, null or up to five slides", () => {
    assert.ok(ok(input()));
    assert.ok(ok(input({ slides: null })));
    assert.ok(ok(input({ slides: [] })));
    assert.ok(ok(input({ slides: Array.from({ length: 5 }, () => slide()) })));
    assert.ok(ok(input({ texts: {} })));
    // an empty string is a decision (the editor cleared the text)
    assert.ok(ok(input({ texts: { "mit.cim": "" } })));
  });

  it("keeps null and an empty list apart", () => {
    const none = parseHomepageContentInput(input({ slides: null }));
    const empty = parseHomepageContentInput(input({ slides: [] }));
    assert.ok(none.ok && none.value.slides === null);
    assert.ok(empty.ok && Array.isArray(empty.value.slides));
  });

  it("refuses a sixth slide, an unknown field, a missing key", () => {
    assert.ok(!ok(input({ slides: Array.from({ length: 6 }, () => slide()) })));
    assert.ok(!ok(input({ extra: 1 })));
    assert.ok(!ok(input({ slides: [slide({ extra: 1 })] })));
    assert.ok(!ok({ texts: {} }));
    assert.ok(!ok(input({ slides: "[]" })));
    assert.ok(!ok(input({ texts: [] })));
    const { imageAlt: _alt, ...noAlt } = slide();
    assert.ok(!ok(input({ slides: [noAlt] })));
  });

  it("refuses a key the catalogue does not know, and a wrong value", () => {
    assert.ok(!ok(input({ texts: { "mit.cimm": "x" } })));
    assert.ok(!ok(input({ texts: { "mit.cim": 5 } })));
    assert.ok(!ok(input({ texts: { "mit.cim": "x".repeat(2001) } })));
  });

  it("refuses a link or an image that leaves the shop or runs script", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//evil.example/x",
      "/\\evil.example",
      "/\\/evil.example",
      "/a\\b",
      "/a b",
      "ftp://x/y",
      "hu/store",
    ]) {
      assert.ok(!ok(input({ texts: { "mit.1.l1.link": bad } })), `link ${bad}`);
      assert.ok(!ok(input({ texts: { "mit.1.kep": bad } })), `image ${bad}`);
      assert.ok(
        !ok(input({ slides: [slide({ ctaHref: bad })] })),
        `cta ${bad}`,
      );
      assert.ok(
        !ok(input({ slides: [slide({ imageUrl: bad })] })),
        `slide image ${bad}`,
      );
    }
    // an external address is fine for a field, never for a slide button
    assert.ok(
      ok(input({ texts: { "bolt.gomb.link": "https://maps.example/x" } })),
    );
    assert.ok(
      !ok(input({ slides: [slide({ ctaHref: "https://maps.example/x" })] })),
    );
    assert.ok(ok(input({ texts: { "mit.1.l1.link": "" } })));
  });

  it("a plain text key takes any text, even one that looks like an address", () => {
    assert.ok(ok(input({ texts: { "mit.cim": "javascript:alert(1)" } })));
  });
});

/*
  THE BLOCKS AND THE FOOTER (Balázs, 2026-10-26 07:50 and 07:52 UTC). What turns
  these red: an editor that does not send the field wiping it (absent must stay
  absent); a block listed twice or left out (the storefront would draw it twice
  or lose it); an unknown block; a footer link that leaves the shop through a
  backslash or runs script; a social link that is a shop path.
*/
describe("parseHomepageContentInput: blocks and footer", () => {
  const blocks = (over: Record<number, unknown> = {}) =>
    HOMEPAGE_BLOCK_KEYS.map((key, i) =>
      i in over ? over[i] : { key, visible: i !== 2 },
    );
  const footer = (over: Record<string, unknown> = {}) => ({
    intro: "<p>Tengeri akvarisztika <strong>2004</strong> óta.</p>",
    columns: [
      {
        title: "Oldaltérkép",
        links: [
          { label: "Termékek", href: "/store" },
          { label: "Blog", href: "https://acropora.hu/blog" },
        ],
      },
    ],
    social: {
      facebook: "https://facebook.com/acropora",
      instagram: null,
      youtube: "",
    },
    bottomText: "© Acropora Kft.",
    ...over,
  });
  const parse = (extra: Record<string, unknown>) =>
    parseHomepageContentInput({ texts: {}, slides: null, ...extra });

  it("an absent field stays absent, null and a full list are kept", () => {
    const absent = parse({});
    assert.ok(absent.ok);
    assert.equal("blocks" in absent.value, false);
    assert.equal("footer" in absent.value, false);
    const nulls = parse({ blocks: null, footer: null });
    assert.ok(nulls.ok);
    assert.equal(nulls.value.blocks, null);
    assert.equal(nulls.value.footer, null);
    const full = parse({ blocks: [...blocks()].reverse(), footer: footer() });
    assert.ok(full.ok);
    assert.deepEqual(
      full.value.blocks?.map((b) => b.key),
      [...HOMEPAGE_BLOCK_KEYS].reverse(),
    );
    assert.equal(
      full.value.blocks?.find((b) => b.key === "kezdo-es-halado")?.visible,
      false,
    );
    assert.deepEqual(full.value.footer?.social, {
      facebook: "https://facebook.com/acropora",
      instagram: null,
      youtube: null,
    });
  });

  it("refuses a missing, a doubled, an unknown block and a bad field", () => {
    for (const bad of [
      blocks().slice(1),
      [...blocks(), { key: "hero", visible: true }],
      blocks({ 0: { key: "sajat-1", visible: true } }),
      blocks({ 0: { key: "hero", visible: "igen" } }),
      blocks({ 0: { key: "hero", visible: true, body: "<p>x</p>" } }),
      "hero",
    ])
      assert.equal(parse({ blocks: bad }).ok, false, JSON.stringify(bad));
  });

  it("refuses a footer link or social link that leaves the shop or runs script", () => {
    for (const href of [
      "javascript:alert(1)",
      "/\\evil.example",
      "//evil.example",
      "",
      "data:text/html,x",
    ])
      assert.equal(
        parse({
          footer: footer({
            columns: [{ title: "A", links: [{ label: "x", href }] }],
          }),
        }).ok,
        false,
        href,
      );
    for (const facebook of ["/store", "javascript:alert(1)", 7])
      assert.equal(
        parse({
          footer: footer({
            social: { facebook, instagram: null, youtube: null },
          }),
        }).ok,
        false,
        String(facebook),
      );
  });

  it("refuses a footer over its limits or with an unknown field", () => {
    const column = { title: "A", links: [] };
    for (const bad of [
      footer({ intro: "x".repeat(HOMEPAGE_LIMITS.footerIntro + 1) }),
      footer({
        columns: Array.from(
          { length: HOMEPAGE_LIMITS.footerColumns + 1 },
          () => column,
        ),
      }),
      footer({
        columns: [
          {
            title: "A",
            links: Array.from(
              { length: HOMEPAGE_LIMITS.footerLinks + 1 },
              () => ({
                label: "x",
                href: "/store",
              }),
            ),
          },
        ],
      }),
      footer({ contact: { address: "x" } }),
      footer({
        columns: [{ title: "A", links: [{ label: " ", href: "/store" }] }],
      }),
      // the commerce validator asks for a title (#564): an empty one is refused here first
      footer({ columns: [{ title: "", links: [] }] }),
      footer({ columns: [{ title: "  ", links: [] }] }),
    ])
      assert.equal(parse({ footer: bad }).ok, false);
  });
});

/*
  A SLIDE BUTTON'S TARGET (Balázs, 2026-10-26, msg 1564310966211055778;
  acrobot 36371). The stored form stays the shop's rule (a shop path, the same
  on both sides); the editor brings what people type to it, and the save names
  the slide and the field in Hungarian. What turns these red: a full address
  on the shop's own host refused, another site's address let through, or an
  English, field-less message in the save's alert.
*/
/*
  THE NEWSLETTER ROW (kirakat-lablec-kep). What turns these red: an absent row
  read as a decision; a row without its switch or with an unknown field; an
  empty consent text or button (the shop refuses both, commerce #577); the
  consent text stored with the spaces the shop would trim away.
*/
describe("parseHomepageContentInput: the newsletter row", () => {
  const parse = (extra: Record<string, unknown>) =>
    parseHomepageContentInput({ texts: {}, slides: null, ...extra });

  it("absent stays absent, null and a whole row are kept", () => {
    const absent = parse({});
    assert.ok(absent.ok);
    assert.equal("newsletter" in absent.value, false);
    const cleared = parse({ newsletter: null });
    assert.ok(cleared.ok);
    assert.equal(cleared.value.newsletter, null);
    const off = parse({
      newsletter: { ...HOMEPAGE_NEWSLETTER_DEFAULT, enabled: false },
    });
    assert.ok(off.ok);
    assert.deepEqual(off.value.newsletter, {
      ...HOMEPAGE_NEWSLETTER_DEFAULT,
      enabled: false,
    });
  });

  it("the consent text and the button are required and stored trimmed", () => {
    for (const bad of [
      { consentText: "  " },
      { button: "" },
      { enabled: "igen" },
      { extra: 1 },
      { title: "x".repeat(HOMEPAGE_LIMITS.newsletterTitle + 1) },
    ]) {
      const parsed = parse({
        newsletter: { ...HOMEPAGE_NEWSLETTER_DEFAULT, ...bad },
      });
      assert.equal(parsed.ok, false, JSON.stringify(bad));
    }
    const trimmed = parse({
      newsletter: {
        ...HOMEPAGE_NEWSLETTER_DEFAULT,
        consentText: "  Hozzájárulok.  ",
        button: " Kérem ",
        title: "",
      },
    });
    assert.ok(trimmed.ok);
    assert.equal(trimmed.value.newsletter?.consentText, "Hozzájárulok.");
    assert.equal(trimmed.value.newsletter?.button, "Kérem");
    assert.equal(trimmed.value.newsletter?.title, "");
  });
});

describe("a slide button's target", () => {
  const SHOP = ["teszt.acropora.hu"];

  it("turns the shop's own full address into its path", () => {
    assert.equal(
      normalizeShopHref(
        "https://teszt.acropora.hu/hu/categories/sps?x=1#a",
        SHOP,
      ),
      "/hu/categories/sps?x=1#a",
    );
    assert.equal(normalizeShopHref(" https://TESZT.acropora.hu ", SHOP), "/");
  });

  it("gives a path typed without its slash one", () => {
    assert.equal(
      normalizeShopHref("hu/categories/sps", SHOP),
      "/hu/categories/sps",
    );
    assert.equal(normalizeShopHref("/hu/store", SHOP), "/hu/store");
    assert.equal(normalizeShopHref("", SHOP), "");
  });

  it("leaves another site, a scheme or a host-like text alone, so the check refuses it", () => {
    for (const other of [
      "https://maps.example/x",
      "javascript:alert(1)",
      "www.acropora.hu/hu/store",
      "//evil.example",
    ]) {
      const kept = normalizeShopHref(other, SHOP);
      assert.ok(!isShopHref(kept), `${other} -> ${kept}`);
    }
    assert.ok(isShopHref(""));
    assert.ok(isShopHref("/hu/categories/sps"));
  });

  it("names the slide and the field in Hungarian when the save refuses", () => {
    const parsed = parseHomepageContentInput(
      input({
        slides: [slide(), slide({ cta2Href: "https://maps.example/x" })],
      }),
    );
    assert.equal(parsed.ok, false);
    assert.match(
      (parsed as { message: string }).message,
      /^2\. dia, második gomb célja: csak a webshop egy oldala lehet/,
    );
  });
});

/*
  THE FORMATTED SHORT TEXTS (2b-3; commerce #571). What turns these red: a
  formatted value refused as "not an address", a key the storefront draws as
  HTML not marked short (or a plain one marked), or the HTML test differing
  from the storefront's.
*/
describe("the formatted short texts", () => {
  it("marks exactly the four places the storefront draws as HTML", () => {
    assert.deepEqual(
      HOMEPAGE_TEXT_FIELDS.filter((f) => f.type === "short").map((f) => f.key),
      ["kezdo.szoveg", "kezdo.1.szoveg", "kezdo.2.szoveg", "kezdo.3.szoveg"],
    );
    assert.ok(isShortTextKey("kezdo.szoveg"));
    assert.ok(!isShortTextKey("kezdo.cim"));
  });

  it("takes a formatted value at a short place, and is not checked as an address", () => {
    assert.ok(
      ok(
        input({
          texts: { "kezdo.szoveg": "<p>Egy <strong>lépés</strong></p>" },
        }),
      ),
    );
  });

  it("tells short-profile HTML from plain text as the storefront does", () => {
    assert.ok(looksLikeShortHtml("<p>x</p>"));
    assert.ok(looksLikeShortHtml("a<br>b"));
    assert.ok(looksLikeShortHtml('<a href="/hu/store">x</a>'));
    assert.ok(!looksLikeShortHtml("a < b és c > d"));
    assert.ok(!looksLikeShortHtml("<script>x</script>"));
  });
});
