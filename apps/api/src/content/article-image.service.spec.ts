import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import sharp from "sharp";

import type { ArticleRepository } from "./article.repository.js";
import type { ArticleImageRepository } from "./article-image.repository.js";
import {
  ArticleImageMemory,
  articleImagePublicBase,
  ArticleImageService,
} from "./article-image.service.js";
import {
  ArticleImagePublicController,
  etagMatches,
} from "./article-image-public.controller.js";

/*
  THE ARTICLE IMAGES (acrobot, 2026-10-26, msg 36320). What turns these red:
  - an address handed out that the save would drop (no base, http, or a base
    whose host is not on RICH_TEXT_IMAGE_HOSTS);
  - an image added to an article that is past the reviewer;
  - a file that is not a PNG, JPEG or WebP stored, or a JPEG stored with its
    metadata;
  - the public route answering anything but one image by a well-formed id, or
    without the headers that keep a browser from reading it as something else.
*/
const ENV = {
  ARTICLE_IMAGE_PUBLIC_BASE_URL: "https://api-staging.acropora.hu/",
  RICH_TEXT_IMAGE_HOSTS: "api-staging.acropora.hu",
};
const ID = "c" + "a".repeat(24);

const image = (format: "png" | "jpeg" | "gif") =>
  sharp({
    create: {
      width: 4,
      height: 3,
      channels: 3,
      background: { r: 0, g: 80, b: 160 },
    },
  })
    [format]()
    .toBuffer();

function setup(
  env: NodeJS.ProcessEnv = ENV,
  {
    editable = true,
    existing = null,
  }: {
    editable?: boolean;
    existing?: { id: string; contentType: string } | null;
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const reads = { content: 0, meta: 0 };
  const images = {
    findBySha256: async () => existing,
    create: async (input: Record<string, unknown>) => {
      created.push(input);
      return { id: ID, contentType: String(input.contentType) };
    },
    content: async (id: string) => {
      reads.content += 1;
      return id === ID
        ? {
            contentType: "image/png",
            sha256: "abc",
            bytes: new Uint8Array([1, 2, 3]),
          }
        : null;
    },
    meta: async (id: string) => {
      reads.meta += 1;
      return id === ID ? { contentType: "image/png", sha256: "abc" } : null;
    },
  } as unknown as ArticleImageRepository;
  const articles = {
    editable: async () => editable,
  } as unknown as ArticleRepository;
  return {
    service: new ArticleImageService(images, articles, env),
    created,
    reads,
  };
}

describe("articleImagePublicBase", () => {
  it("is the https origin only when its host is also an allowed image host", () => {
    assert.equal(
      articleImagePublicBase(ENV),
      "https://api-staging.acropora.hu",
    );
    assert.equal(
      articleImagePublicBase({
        ...ENV,
        ARTICLE_IMAGE_PUBLIC_BASE_URL: "https://x.hu/api/",
      }),
      null,
    );
    assert.equal(
      articleImagePublicBase({
        ...ENV,
        RICH_TEXT_IMAGE_HOSTS: "x.hu,api-staging.acropora.hu",
      }),
      "https://api-staging.acropora.hu",
    );
    assert.equal(
      articleImagePublicBase({
        ...ENV,
        ARTICLE_IMAGE_PUBLIC_BASE_URL: "http://api-staging.acropora.hu",
      }),
      null,
    );
    assert.equal(
      articleImagePublicBase({
        RICH_TEXT_IMAGE_HOSTS: "api-staging.acropora.hu",
      }),
      null,
    );
  });
});

describe("ArticleImageService.upload -- metadata", () => {
  it("re-encodes a PNG and a WebP too, so no EXIF reaches the public", async () => {
    for (const format of ["png", "webp"] as const) {
      const { service, created } = setup();
      const withExif = await sharp({
        create: {
          width: 4,
          height: 3,
          channels: 3,
          background: { r: 1, g: 2, b: 3 },
        },
      })
        .withMetadata({ exif: { IFD0: { Copyright: "hely" } } })
        [format]()
        .toBuffer();
      assert.ok(
        (await sharp(withExif).metadata()).exif,
        `${format} fixture has EXIF`,
      );
      await service.upload("c1", { buffer: withExif }, null);
      const stored = created[0]?.bytes as Uint8Array;
      assert.equal(
        (await sharp(Buffer.from(stored)).metadata()).exif,
        undefined,
        format,
      );
      assert.equal(created[0]?.contentType, `image/${format}`);
    }
  });
});

describe("ArticleImageService.upload", () => {
  it("stores the image and hands out its public address", async () => {
    const { service, created } = setup();
    const answer = await service.upload(
      "c1",
      { buffer: await image("png") },
      "u-1",
    );
    assert.deepEqual(answer, {
      id: ID,
      url: `https://api-staging.acropora.hu/public/article-images/${ID}`,
    });
    assert.equal(created.length, 1);
    assert.equal(created[0]?.contentId, "c1");
    assert.equal(created[0]?.contentType, "image/png");
    assert.equal(created[0]?.uploadedById, "u-1");
  });

  it("gives the existing image for the same bytes, without a second row", async () => {
    const { service, created } = setup(ENV, {
      existing: { id: ID, contentType: "image/png" },
    });
    const answer = await service.upload(
      "c1",
      { buffer: await image("png") },
      "u-1",
    );
    assert.equal(answer.id, ID);
    assert.equal(created.length, 0);
  });

  it("refuses when the address would not survive the save (503)", async () => {
    for (const env of [
      {},
      { ...ENV, RICH_TEXT_IMAGE_HOSTS: "static.acropora.hu" },
      {
        ...ENV,
        ARTICLE_IMAGE_PUBLIC_BASE_URL: "http://api-staging.acropora.hu",
      },
    ]) {
      const { service, created } = setup(env);
      await assert.rejects(
        () => service.upload("c1", { buffer: Buffer.from([1]) }, null),
        ServiceUnavailableException,
      );
      assert.equal(created.length, 0);
    }
  });

  it("refuses an article that is past the reviewer (409)", async () => {
    const { service, created } = setup(ENV, { editable: false });
    await assert.rejects(
      async () => service.upload("c1", { buffer: await image("png") }, null),
      ConflictException,
    );
    assert.equal(created.length, 0);
  });

  it("stores only PNG, JPEG or WebP, by the bytes", async () => {
    const { service, created } = setup();
    await assert.rejects(
      async () => service.upload("c1", { buffer: await image("gif") }, null),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /Csak PNG, JPG vagy WebP/.test(error.message),
    );
    await assert.rejects(
      () =>
        service.upload("c1", { buffer: Buffer.from("<svg onload=x()>") }, null),
      BadRequestException,
    );
    assert.equal(created.length, 0);
  });

  it("re-encodes a JPEG, so its metadata does not reach the public", async () => {
    const { service, created } = setup();
    const withExif = await sharp(await image("jpeg"))
      .withMetadata({ exif: { IFD0: { Copyright: "hely" } } })
      .jpeg()
      .toBuffer();
    assert.ok((await sharp(withExif).metadata()).exif);
    await service.upload("c1", { buffer: withExif }, null);
    const stored = created[0]?.bytes as Uint8Array;
    assert.equal((await sharp(Buffer.from(stored)).metadata()).exif, undefined);
  });
});

let callers = 0;
/** a fresh caller address for each request series, so the shared limiter does not carry over */
const request = (headers: Record<string, string> = {}) => ({
  headers: {
    "x-forwarded-for": `10.0.${Math.floor(callers / 250)}.${callers++ % 250}`,
    ...headers,
  },
});
const response = () => {
  const out = { status: 200, headers: {} as Record<string, string> };
  return {
    out,
    res: {
      status(code: number) {
        out.status = code;
      },
      setHeader(name: string, value: string) {
        out.headers[name] = value;
      },
    },
  };
};

describe("ArticleImagePublicController", () => {
  it("serves one image by a well-formed id, with its ETag", async () => {
    const { service } = setup();
    const { out, res } = response();
    const file = await new ArticleImagePublicController(service).image(
      ID,
      request(),
      res,
    );
    const headers = file!.getHeaders();
    assert.equal(headers.type, "image/png");
    assert.equal(headers.length, 3);
    assert.equal(headers.disposition, "inline");
    assert.equal(out.headers.ETag, '"abc"');
  });

  it("answers the same 404 for an unknown and a malformed id", async () => {
    const { service } = setup();
    const controller = new ArticleImagePublicController(service);
    for (const id of ["c" + "b".repeat(24), "../etc/passwd", "", ID + "x"]) {
      await assert.rejects(
        () => controller.image(id, request(), response().res),
        NotFoundException,
      );
      await assert.rejects(
        () =>
          controller.image(
            id,
            request({ "if-none-match": '"abc"' }),
            response().res,
          ),
        NotFoundException,
      );
    }
  });

  /*
    THE LOAD IS BOUNDED (barracuda, #1897 CHANGES): a request never means more
    than one row, and usually none.
  */
  it("reads the bytes once, then from memory, whatever the query string", async () => {
    const { service, reads } = setup();
    const controller = new ArticleImagePublicController(service);
    for (let i = 0; i < 5; i += 1)
      await controller.image(ID, request(), response().res);
    assert.equal(reads.content, 1);
  });

  it("answers a still valid ETag with 304, without reading the bytes", async () => {
    const { service, reads } = setup();
    const { out, res } = response();
    const answer = await new ArticleImagePublicController(service).image(
      ID,
      request({ "if-none-match": 'W/"x", "abc"' }),
      res,
    );
    assert.equal(answer, undefined);
    assert.equal(out.status, 304);
    assert.equal(out.headers.ETag, '"abc"');
    assert.equal(reads.content, 0);
    assert.equal(reads.meta, 1);
  });

  it("sends the bytes again when the ETag is an old one", async () => {
    const { service } = setup();
    const { out, res } = response();
    const answer = await new ArticleImagePublicController(service).image(
      ID,
      request({ "if-none-match": '"regi"' }),
      res,
    );
    assert.ok(answer);
    assert.equal(out.status, 200);
  });

  it("refuses a caller past its limit with 429, and only that caller", async () => {
    const { service } = setup();
    const controller = new ArticleImagePublicController(service);
    const one = request();
    for (let i = 0; i < 300; i += 1)
      await controller.image(ID, one, response().res);
    await assert.rejects(
      () => controller.image(ID, one, response().res),
      (error: unknown) =>
        (error as { getStatus?: () => number }).getStatus?.() === 429,
    );
    assert.ok(await controller.image(ID, request(), response().res));
  });

  it("sets the headers that keep the file an image any origin may show", () => {
    const keys = Reflect.getMetadataKeys(
      ArticleImagePublicController.prototype.image,
    );
    const headers = Reflect.getMetadata(
      keys.find((key) => String(key).includes("headers")),
      ArticleImagePublicController.prototype.image,
    ) as { name: string; value: string }[];
    const byName = Object.fromEntries(headers.map((h) => [h.name, h.value]));
    assert.equal(byName["X-Content-Type-Options"], "nosniff");
    assert.match(byName["Cache-Control"] ?? "", /public/);
    assert.match(byName["Content-Security-Policy"] ?? "", /default-src 'none'/);
    assert.equal(byName["Cross-Origin-Resource-Policy"], "cross-origin");
  });
});

describe("etagMatches", () => {
  it("finds the tag in a list, weak or strong, or a star", () => {
    assert.equal(etagMatches('"a", "b"', '"b"'), true);
    assert.equal(etagMatches('W/"b"', '"b"'), true);
    assert.equal(etagMatches("*", '"b"'), true);
    assert.equal(etagMatches('"a"', '"b"'), false);
    assert.equal(etagMatches(undefined, '"b"'), false);
  });
});

describe("ArticleImageMemory", () => {
  const entry = (n: number) => ({
    contentType: "image/png",
    sha256: String(n),
    bytes: new Uint8Array(n),
  });

  it("drops the least recently used once the bytes pass the ceiling", () => {
    const memory = new ArticleImageMemory(10);
    memory.set("a", entry(4));
    memory.set("b", entry(4));
    memory.get("a");
    memory.set("c", entry(4));
    assert.ok(memory.get("a"));
    assert.equal(memory.get("b"), undefined);
    assert.ok(memory.get("c"));
  });

  it("does not keep an entry larger than the whole ceiling", () => {
    const memory = new ArticleImageMemory(10);
    memory.set("big", entry(11));
    assert.equal(memory.size, 0);
  });
});
