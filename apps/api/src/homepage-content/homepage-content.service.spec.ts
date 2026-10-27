import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HomepageContentInput } from "@acropora/types";

import {
  HOMEPAGE_FEATURED_MAX,
  homepageStorefrontUrl,
  HomepageContentService,
  toHomepageContent,
  type HomepageContentRow,
  type HomepageContentStore,
} from "./homepage-content.service.js";

/*
  THE HOME PAGE CONTENT SERVICE. What turns these red: an invalid record
  stored; a save that skips the projection, or one that fails because the
  projection failed (the save must be kept); an empty store answering anything
  but "nothing set" (empty texts, null slides); a null slides list turning into
  an empty list on the way out (that would mean "no hero" in the shop).
*/
/** The test OS: the environment allows writing to the shop. */
const ALLOWED: NodeJS.ProcessEnv = { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "true" };

function setup(
  projection: () => Promise<"sent" | "unchanged">,
  options: { switchedOn?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  let row: HomepageContentRow | null =
    options.switchedOn === false
      ? null
      : {
          key: "main",
          texts: {},
          slides: null,
          blocks: null,
          footer: null,
          newsletter: null,
          projectionEnabled: true,
          updatedAt: new Date("2026-10-20T11:00:00Z"),
        };
  const saved: { input: HomepageContentInput; userId: string }[] = [];
  const marked = new Set<string>();
  const store: HomepageContentStore = {
    find: async () => row,
    save: async (key, input, userId) => {
      saved.push({ input, userId });
      row = {
        key,
        texts: input.texts,
        slides: input.slides,
        // like the repository: an absent field is not written
        blocks:
          input.blocks !== undefined ? input.blocks : (row?.blocks ?? null),
        footer:
          input.footer !== undefined ? input.footer : (row?.footer ?? null),
        newsletter:
          input.newsletter !== undefined
            ? input.newsletter
            : (row?.newsletter ?? null),
        projectionEnabled: row?.projectionEnabled ?? false,
        updatedAt: new Date("2026-10-20T12:00:00Z"),
      };
      return row;
    },
    featuredList: async () =>
      [...marked].map((productId, i) => ({
        productId,
        name: `Termék ${productId}`,
        sortOrder: i,
        imageUrl: null,
        grossPrice: null,
      })),
    orderFeatured: async (productIds) => {
      if (
        productIds.length !== marked.size ||
        productIds.some((id) => !marked.has(id))
      )
        return "mismatch";
      marked.clear();
      for (const id of productIds) marked.add(id);
      return "ok";
    },
    setFeatured: async (productId, featured, _userId, max) => {
      if (productId === "nincs") return "unknown-product";
      if (!featured) {
        marked.delete(productId);
        return "ok";
      }
      if (!marked.has(productId) && marked.size >= max) return "full";
      marked.add(productId);
      return "ok";
    },
    setProjection: async (key, enabled) => {
      row = {
        key,
        texts: row?.texts ?? {},
        slides: row?.slides ?? null,
        blocks: row?.blocks ?? null,
        footer: row?.footer ?? null,
        newsletter: row?.newsletter ?? null,
        projectionEnabled: enabled,
        updatedAt: new Date("2026-10-20T12:00:00Z"),
      };
      return row;
    },
  };
  const uploads: { fileName: string; contentType: string }[] = [];
  const service = new HomepageContentService(
    store,
    projection,
    async (image) => {
      uploads.push({
        fileName: image.fileName,
        contentType: image.contentType,
      });
      return { url: `https://shop.example/static/${image.fileName}` };
    },
    options.env ?? ALLOWED,
  );
  return { service, saved, uploads };
}

describe("HomepageContentService", () => {
  it("answers 'nothing set, switch off' before the first save", async () => {
    const { service } = setup(async () => "sent", { switchedOn: false });
    assert.deepEqual(await service.get(), {
      texts: {},
      slides: null,
      blocks: null,
      footer: null,
      newsletter: null,
      imageHosts: [],
      storefrontUrl: null,
      updatedAt: null,
      projectionEnabled: false,
      projectionAllowed: true,
    });
  });

  it("stores a valid record with the user and asks for one projection when the switch is on", async () => {
    let asked = 0;
    const { service, saved } = setup(async () => {
      asked++;
      return "sent";
    });
    const out = await service.save(
      { texts: { "mit.cim": "Új" }, slides: null },
      "u-1",
    );
    assert.equal(out.projection, "sent");
    assert.equal(asked, 1);
    assert.deepEqual(saved, [
      { input: { texts: { "mit.cim": "Új" }, slides: null }, userId: "u-1" },
    ]);
    assert.equal(out.content.slides, null);
    assert.equal((await service.get()).texts["mit.cim"], "Új");
  });

  it("does not project, and says off, when neither the switch nor the variable is on", async () => {
    let asked = 0;
    const { service, saved } = setup(
      async () => {
        asked++;
        return "sent";
      },
      { switchedOn: false },
    );
    const out = await service.save({ texts: {}, slides: [] }, "u-1");
    assert.equal(out.projection, "off");
    assert.equal(asked, 0);
    assert.equal(saved.length, 1);
  });

  it("is an AND: the switch without the environment's permission sends nothing (acrobot 33495)", async () => {
    let asked = 0;
    const projection = async () => {
      asked++;
      return "sent" as const;
    };
    for (const env of [
      {},
      { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "false" },
      { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "1" },
    ]) {
      const production = setup(projection, { env });
      const out = await production.service.save(
        { texts: {}, slides: null },
        "u",
      );
      assert.equal(out.projection, "off");
      assert.equal(out.content.projectionEnabled, true);
      assert.equal(out.content.projectionAllowed, false);
    }
    // the permission without the switch sends nothing either
    const permissionOnly = setup(projection, { switchedOn: false });
    assert.equal(
      (await permissionOnly.service.save({ texts: {}, slides: null }, "u"))
        .projection,
      "off",
    );
    assert.equal(asked, 0);
    // both: it sends
    const both = setup(projection);
    assert.equal(
      (await both.service.save({ texts: {}, slides: null }, "u")).projection,
      "sent",
    );
    assert.equal(asked, 1);
  });

  it("the switch cannot be turned ON where the environment does not allow it, but can be turned off", async () => {
    const { service } = setup(async () => "sent", {
      switchedOn: false,
      env: {},
    });
    await assert.rejects(
      service.setProjection(true, "admin"),
      ConflictException,
    );
    assert.deepEqual(await service.setProjection(false, "admin"), {
      projectionEnabled: false,
    });
  });

  it("keeps the save when the projection fails", async () => {
    const { service, saved } = setup(async () => {
      throw new Error("shop down");
    });
    const out = await service.save({ texts: {}, slides: [] }, "u-1");
    assert.equal(out.projection, "failed");
    assert.equal(saved.length, 1);
    assert.deepEqual(out.content.slides, []);
  });

  it("refuses an invalid record before it reaches the store or the projection", async () => {
    let asked = 0;
    const { service, saved } = setup(async () => {
      asked++;
      return "sent";
    });
    for (const bad of [
      { texts: { "nincs.ilyen": "x" }, slides: null },
      { texts: { "mit.1.l1.link": "javascript:alert(1)" }, slides: null },
      { texts: {} },
    ])
      await assert.rejects(service.save(bad, "u-1"), BadRequestException);
    assert.equal(saved.length, 0);
    assert.equal(asked, 0);
  });

  it("the administrator's switch is its own write and keeps the content", async () => {
    const { service } = setup(async () => "sent", { switchedOn: false });
    await service.save({ texts: { "mit.cim": "Új" }, slides: null }, "u-1");
    assert.deepEqual(await service.setProjection(true, "admin"), {
      projectionEnabled: true,
    });
    const content = await service.get();
    assert.equal(content.projectionEnabled, true);
    assert.equal(content.texts["mit.cim"], "Új");
    await assert.rejects(
      service.setProjection("igen", "admin"),
      BadRequestException,
    );
  });
});

/*
  THE BLOCKS AND THE FOOTER (2026-10-26). What turns these red: a save without
  the field wiping a stored list (today's editor does not send it); a footer
  intro stored with script or an event attribute (the storefront draws it as
  HTML on every page); a hand-edited row that lost a block hiding it.
*/
describe("HomepageContentService: blocks and footer", () => {
  const blocks = [
    { key: "boltunk", visible: true },
    { key: "hero", visible: true },
    { key: "mit-keresel", visible: false },
    { key: "kezdo-es-halado", visible: true },
    { key: "egyedi-korallok", visible: true },
    { key: "szolgaltatasok", visible: true },
    { key: "markak", visible: true },
    { key: "velemenyek", visible: true },
  ];
  const footer = (intro: string) => ({
    intro,
    columns: [
      { title: "Oldaltérkép", links: [{ label: "Termékek", href: "/store" }] },
    ],
    social: {
      facebook: "https://facebook.com/acropora",
      instagram: null,
      youtube: null,
    },
    bottomText: "© Acropora Kft.",
  });

  it("stores the blocks, and a later save without them keeps them", async () => {
    const { service } = setup(async () => "sent");
    await service.save({ texts: {}, slides: null, blocks }, "u-1");
    const out = await service.save(
      { texts: { "mit.cim": "Új" }, slides: null },
      "u-1",
    );
    assert.deepEqual(out.content.blocks, blocks);
    const reset = await service.save(
      { texts: {}, slides: null, blocks: null },
      "u-1",
    );
    assert.equal(reset.content.blocks, null);
  });

  it("stores the footer intro through the sanitizer: script, iframe and on* go", async () => {
    const { service, saved } = setup(async () => "sent");
    const out = await service.save(
      {
        texts: {},
        slides: null,
        footer: footer(
          '<p onclick="x()">Zátony<script>alert(1)</script></p><iframe srcdoc="x"></iframe><table><tbody><tr><td><p>H-P</p></td></tr></tbody></table>',
        ),
      },
      "u-1",
    );
    // the short profile: the table goes, its paragraph stays
    const clean = "<p>Zátony</p><p>H-P</p>";
    assert.equal(saved[0]?.input.footer?.intro, clean);
    assert.equal(out.content.footer?.intro, clean);
    assert.equal(out.content.footer?.columns[0]?.links[0]?.href, "/store");
  });

  it("stores the footer intro in the short profile: no image, no table; the editor still gets the host list", async () => {
    const { service } = setup(async () => "sent", {
      env: {
        ...ALLOWED,
        RICH_TEXT_IMAGE_HOSTS:
          " Static.Acropora.hu, nem host, static.acropora.hu ",
      },
    });
    const out = await service.save(
      {
        texts: {},
        slides: null,
        footer: footer(
          '<p><strong>a</strong> <a href="/store">bolt</a><img src="https://static.acropora.hu/a.jpg"></p><table><tbody><tr><td>t</td></tr></tbody></table><h2>c</h2>',
        ),
      },
      "u-1",
    );
    assert.equal(
      out.content.footer?.intro,
      '<p><strong>a</strong> <a href="/store">bolt</a></p>tc',
    );
    assert.deepEqual(out.content.imageHosts, ["static.acropora.hu"]);
  });

  it("measures the intro limit after cleaning, so a stored footer always reads back", async () => {
    const { service, saved } = setup(async () => "sent");
    await assert.rejects(
      service.save(
        {
          texts: {},
          slides: null,
          footer: footer(`<p>${"<".repeat(3990)}</p>`),
        },
        "u-1",
      ),
      BadRequestException,
    );
    assert.equal(saved.length, 0);
  });

  it("sanitizes a hand-written stored intro again on read", () => {
    const content = toHomepageContent(
      {
        key: "main",
        texts: {},
        slides: null,
        blocks: null,
        footer: footer('<p onclick="x()">a<script>1</script></p>'),
        newsletter: null,
        projectionEnabled: false,
        updatedAt: new Date("2026-10-26T09:00:00Z"),
      },
      false,
      [],
    );
    assert.equal(content.footer?.intro, "<p>a</p>");
  });

  it("refuses an incomplete block list before the store", async () => {
    const { service, saved } = setup(async () => "sent");
    await assert.rejects(
      service.save({ texts: {}, slides: null, blocks: blocks.slice(1) }, "u-1"),
      BadRequestException,
    );
    assert.equal(saved.length, 0);
  });

  it("reads a hand-edited row that lost a block, or a broken footer, as not set", () => {
    const row = {
      key: "main",
      texts: {},
      slides: null,
      blocks: blocks.slice(1),
      footer: { intro: 5 },
      newsletter: { enabled: "igen" },
      projectionEnabled: false,
      updatedAt: new Date("2026-10-26T09:00:00Z"),
    } as unknown as HomepageContentRow;
    const content = toHomepageContent(row);
    assert.equal(content.blocks, null);
    assert.equal(content.footer, null);
    assert.equal(content.newsletter, null);
  });

  it("reads a stored newsletter row back, and keeps it on a save that does not carry it", async () => {
    const { service } = setup(async () => "sent");
    const row = {
      enabled: false,
      title: "Hírlevél",
      text: "Iratkozz fel!",
      consentText: "Hozzájárulok.",
      button: "Feliratkozás",
    };
    await service.save({ texts: {}, slides: null, newsletter: row }, "u-1");
    const out = await service.save({ texts: {}, slides: null }, "u-1");
    assert.deepEqual(out.content.newsletter, row);
  });
});

describe("toHomepageContent", () => {
  it("reads a hand-edited row defensively", () => {
    const row = {
      key: "main",
      texts: { "mit.cim": "ok", "mit.alcim": 5 },
      slides: "nem lista",
      projectionEnabled: "igen",
      updatedAt: new Date("2026-10-20T12:00:00Z"),
    } as unknown as HomepageContentRow;
    const content = toHomepageContent(row);
    assert.deepEqual(content.texts, { "mit.cim": "ok" });
    assert.equal(content.slides, null);
    assert.equal(content.projectionEnabled, false);
  });
});

describe("HomepageContentService.uploadImage", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
  ]);
  const gif = Buffer.from("GIF89a....");
  const html = Buffer.from("<html><script>alert(1)</script></html>");

  it("names the file after what it IS and never after the client's name", async () => {
    const { service, uploads } = setup(async () => "sent");
    await service.uploadImage({ originalname: "hero.png", buffer: jpeg });
    await service.uploadImage({ originalname: "kep.jpg", buffer: png });
    assert.match(uploads[0]?.fileName ?? "", /^kezdolap-[0-9a-f-]{36}\.jpg$/);
    assert.equal(uploads[0]?.contentType, "image/jpeg");
    assert.match(uploads[1]?.fileName ?? "", /^kezdolap-[0-9a-f-]{36}\.png$/);
    assert.notEqual(uploads[0]?.fileName, uploads[1]?.fileName);
  });

  it("takes nothing of a hostile client name into the shop's file name (barracuda, #1721)", async () => {
    const { service, uploads } = setup(async () => "sent");
    for (const originalname of [
      "../../x.png",
      "a\\b.png",
      ".htaccess",
      "a/b/c.webp",
      "..\\..\\y.jpg",
    ])
      await service.uploadImage({ originalname, buffer: jpeg });
    assert.equal(uploads.length, 5);
    for (const upload of uploads) {
      assert.doesNotMatch(upload.fileName, /[/\\]/);
      assert.ok(!upload.fileName.startsWith("."));
      assert.match(upload.fileName, /^[A-Za-z0-9._-]+$/);
    }
  });

  it("refuses what is not a JPEG, PNG or WebP image, before the shop sees it", async () => {
    const { service, uploads } = setup(async () => "sent");
    for (const buffer of [html, gif, Buffer.alloc(0), Buffer.from("x")])
      await assert.rejects(
        service.uploadImage({ originalname: "kep.jpg", buffer }),
        BadRequestException,
      );
    assert.equal(uploads.length, 0);
  });

  it("refuses an image over 8 MB", async () => {
    const { service, uploads } = setup(async () => "sent");
    const big = Buffer.concat([jpeg, Buffer.alloc(8 * 1024 * 1024)]);
    await assert.rejects(
      service.uploadImage({ originalname: "nagy.jpg", buffer: big }),
      BadRequestException,
    );
    assert.equal(uploads.length, 0);
  });

  it("an upload is a write to the shop too: no environment permission, no upload", async () => {
    const { service, uploads } = setup(async () => "sent", { env: {} });
    await assert.rejects(
      service.uploadImage({ originalname: "kep.jpg", buffer: jpeg }),
      ServiceUnavailableException,
    );
    assert.equal(uploads.length, 0);
  });

  it("says so when the shop is switched off, instead of pretending", async () => {
    const { service, uploads } = setup(async () => "sent", {
      switchedOn: false,
    });
    await assert.rejects(
      service.uploadImage({ originalname: "kep.jpg", buffer: jpeg }),
      ServiceUnavailableException,
    );
    assert.equal(uploads.length, 0);
  });
});

describe("HomepageContentService featured marker", () => {
  it("marks, lists in order, unmarks, and asks for one projection where it is on", async () => {
    let asked = 0;
    const { service } = setup(async () => {
      asked++;
      return "sent";
    });
    const a = await service.setFeatured("p1", true, "u");
    assert.equal(a.projection, "sent");
    await service.setFeatured("p2", true, "u");
    assert.deepEqual(
      (await service.featured()).map((r) => r.productId),
      ["p1", "p2"],
    );
    const gone = await service.setFeatured("p1", false, "u");
    assert.deepEqual(
      gone.list.map((r) => r.productId),
      ["p2"],
    );
    assert.equal(asked, 3);
  });

  it("does not project where it is off, and says so", async () => {
    let asked = 0;
    const { service } = setup(
      async () => {
        asked++;
        return "sent";
      },
      { env: {} },
    );
    assert.equal(
      (await service.setFeatured("p1", true, "u")).projection,
      "off",
    );
    assert.equal(asked, 0);
  });

  it("keeps the marker when the projection fails", async () => {
    const { service } = setup(async () => {
      throw new Error("shop down");
    });
    const out = await service.setFeatured("p1", true, "u");
    assert.equal(out.projection, "failed");
    assert.equal(out.list.length, 1);
  });

  it("refuses a bad body, an unknown product and a thirteenth marked product", async () => {
    const { service } = setup(async () => "sent");
    await assert.rejects(
      service.setFeatured("", true, "u"),
      BadRequestException,
    );
    await assert.rejects(
      service.setFeatured("p1", "igen", "u"),
      BadRequestException,
    );
    await assert.rejects(
      service.setFeatured("nincs", true, "u"),
      NotFoundException,
    );
    for (let i = 0; i < 12; i++) await service.setFeatured(`m${i}`, true, "u");
    await assert.rejects(
      service.setFeatured("m12", true, "u"),
      ConflictException,
    );
    // an already marked product is never "full", and unmarking always works
    await service.setFeatured("m0", true, "u");
    await service.setFeatured("m1", false, "u");
    await service.setFeatured("m12", true, "u");
    assert.equal((await service.featured()).length, 12);
    assert.equal(HOMEPAGE_FEATURED_MAX, 12);
  });
});

/*
  THE TEST STOREFRONT'S ADDRESS. What turns these red: the address handed to
  the editor where the environment does not allow writing to the shop (the
  production OS would preview against the live shop), an http or malformed
  address passed on, a path kept (the preview needs the origin only).
*/
describe("homepageStorefrontUrl", () => {
  it("is the https origin, only where writing to the shop is allowed", () => {
    assert.equal(
      homepageStorefrontUrl({
        ...ALLOWED,
        HOMEPAGE_PREVIEW_ALLOWED: "true",
        HOMEPAGE_STOREFRONT_URL: " https://teszt.acropora.hu/hu/store ",
      }),
      "https://teszt.acropora.hu",
    );
    assert.equal(
      homepageStorefrontUrl({
        HOMEPAGE_STOREFRONT_URL: "https://teszt.acropora.hu",
      }),
      null,
    );
    for (const bad of [
      "http://teszt.acropora.hu",
      "teszt.acropora.hu",
      "",
      "javascript:alert(1)",
    ])
      assert.equal(
        homepageStorefrontUrl({
          ...ALLOWED,
          HOMEPAGE_PREVIEW_ALLOWED: "true",
          HOMEPAGE_STOREFRONT_URL: bad,
        }),
        null,
        bad,
      );
  });

  it("needs its own switch: projection allowed and an address are not enough", () => {
    for (const allowed of [undefined, "false", "1", "TRUE"])
      assert.equal(
        homepageStorefrontUrl({
          ...ALLOWED,
          HOMEPAGE_PREVIEW_ALLOWED: allowed,
          HOMEPAGE_STOREFRONT_URL: "https://shop.acropora.hu",
        }),
        null,
        String(allowed),
      );
  });

  it("reaches the editor with the content", async () => {
    const { service } = setup(async () => "sent", {
      env: {
        ...ALLOWED,
        HOMEPAGE_PREVIEW_ALLOWED: "true",
        HOMEPAGE_STOREFRONT_URL: "https://teszt.acropora.hu",
      },
    });
    assert.equal(
      (await service.get()).storefrontUrl,
      "https://teszt.acropora.hu",
    );
  });
});

/*
  THE BAND'S ORDER (2b-2). What turns these red: a reorder that drops or adds
  a product (the list must be exactly the marked ones), a duplicate or a
  thirteenth id accepted, a reorder that does not ask for the projection where
  it is on, or one whose projection failure fails the order.
*/
describe("HomepageContentService.orderFeatured", () => {
  it("puts the band in the given order and asks for one projection where it is on", async () => {
    let asked = 0;
    const { service } = setup(async () => {
      asked++;
      return "sent";
    });
    for (const id of ["a", "b", "c"])
      await service.setFeatured(id, true, "u-1");
    asked = 0;
    const out = await service.orderFeatured(["c", "a", "b"], "u-1");
    assert.deepEqual(
      out.list.map((row) => row.productId),
      ["c", "a", "b"],
    );
    assert.equal(out.projection, "sent");
    assert.equal(asked, 1);
  });

  it("refuses a list that is not exactly the marked products, a duplicate, too many or no list", async () => {
    const { service } = setup(async () => "sent");
    for (const id of ["a", "b"]) await service.setFeatured(id, true, "u-1");
    await assert.rejects(
      service.orderFeatured(["a"], "u-1"),
      ConflictException,
    );
    await assert.rejects(
      service.orderFeatured(["a", "b", "x"], "u-1"),
      ConflictException,
    );
    for (const bad of [
      ["a", "a"],
      "a,b",
      [1, 2],
      Array.from({ length: 13 }, (_, i) => `p${i}`),
    ])
      await assert.rejects(
        service.orderFeatured(bad, "u-1"),
        BadRequestException,
        JSON.stringify(bad),
      );
  });

  it("keeps the order when the projection fails", async () => {
    const { service } = setup(async () => {
      throw new Error("a bolt nem válaszol");
    });
    for (const id of ["a", "b"]) await service.setFeatured(id, true, "u-1");
    const out = await service.orderFeatured(["b", "a"], "u-1");
    assert.equal(out.projection, "failed");
    assert.deepEqual(
      out.list.map((row) => row.productId),
      ["b", "a"],
    );
  });
});

/*
  THE FORMATTED SHORT TEXTS (2b-3; commerce #571): the storefront draws them as
  HTML, so the stored form is the boundary. What turns these red: script or a
  table stored at a short place or in a slide's text; a plain text escaped
  (the storefront would show "&lt;"); a place that is not short cleaned; a
  value over the shop's cap after cleaning stored (the shop would refuse the
  whole record).
*/
describe("HomepageContentService: the formatted short texts", () => {
  const slide = {
    eyebrow: "",
    title: "t",
    text: '<p onclick="x()">Akció <strong>most</strong><script>alert(1)</script></p><table><tbody><tr><td>x</td></tr></tbody></table>',
    cta: "",
    ctaHref: null,
    cta2: "",
    cta2Href: null,
    caption: "",
    caption2: "",
    imageUrl: null,
    imageAlt: "",
  };

  it("cleans a short place and a slide's text in the short profile, and leaves the rest", async () => {
    const { service, saved } = setup(async () => "sent");
    const out = await service.save(
      {
        texts: {
          "kezdo.szoveg":
            '<p>Első <em>lépés</em><img src="https://x.hu/a.png"></p>',
          "kezdo.1.szoveg": "a < b és c > d",
          "kezdo.cim": "<b>nem formázott hely</b>",
        },
        slides: [slide],
      },
      "u-1",
    );
    const texts = saved[0]?.input.texts ?? {};
    assert.equal(texts["kezdo.szoveg"], "<p>Első <em>lépés</em></p>");
    // plain text stays plain: cleaning would escape it
    assert.equal(texts["kezdo.1.szoveg"], "a < b és c > d");
    // a plain-text place is not a formatted one: the storefront shows it as text
    assert.equal(texts["kezdo.cim"], "<b>nem formázott hely</b>");
    assert.equal(
      saved[0]?.input.slides?.[0]?.text,
      // the removed table's cell text stays, as text
      "<p>Akció <strong>most</strong></p>x",
    );
    assert.equal(
      out.content.texts["kezdo.szoveg"],
      "<p>Első <em>lépés</em></p>",
    );
  });

  it("refuses a formatted text over the shop's cap after cleaning", async () => {
    const { service, saved } = setup(async () => "sent");
    // under 2000 characters arrive; each lone "<" grows to "&lt;" in the cleaning
    const long = `<p>${"x <".repeat(660)}</p>`;
    await assert.rejects(
      () =>
        service.save({ texts: { "kezdo.szoveg": long }, slides: null }, "u-1"),
      /kezdo\.szoveg: a formázott szöveg a tisztítás után legfeljebb 2000/,
    );
    assert.equal(saved.length, 0);
  });
});
