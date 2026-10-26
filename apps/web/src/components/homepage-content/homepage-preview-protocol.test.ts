import { describe, expect, it } from "vitest";

import {
  PREVIEW_MESSAGE,
  previewRecord,
  readPreviewMessage,
} from "./homepage-preview-protocol";

/*
  THE PREVIEW PROTOCOL, OS SIDE. What turns these red: a camel-cased slide or
  footer field (the storefront validator is snake-cased, like the projection);
  null slides sent as an empty list (no hero instead of the default slides); a
  message without the protocol version accepted; a foreign shape read as one
  of ours.
*/
describe("previewRecord", () => {
  it("is the commerce shape, snake_case, null kept as null", () => {
    const record = previewRecord({
      texts: { "mit.cim": "Új" },
      slides: [
        {
          eyebrow: "e",
          title: "t",
          text: "x",
          cta: "c",
          ctaHref: "/store",
          cta2: "",
          cta2Href: null,
          caption: "",
          caption2: "",
          imageUrl: null,
          imageAlt: "a",
        },
      ],
      blocks: [{ key: "hero", visible: false }],
      footer: {
        intro: "<p>x</p>",
        columns: [],
        social: { facebook: null, instagram: null, youtube: null },
        bottomText: "©",
      },
    });
    expect(record.slides?.[0]).toMatchObject({
      cta_href: "/store",
      image_alt: "a",
    });
    expect(record.footer).toEqual({
      intro: "<p>x</p>",
      columns: [],
      social: { facebook: null, instagram: null, youtube: null },
      bottom_text: "©",
    });
    expect(Object.keys(record).sort()).toEqual([
      "blocks",
      "footer",
      "slides",
      "texts",
    ]);
    expect(
      previewRecord({ texts: {}, slides: null, blocks: null, footer: null })
        .slides,
    ).toBeNull();
  });
});

describe("readPreviewMessage", () => {
  it("takes only the versioned messages of the protocol", () => {
    expect(
      readPreviewMessage({ type: PREVIEW_MESSAGE.ready, version: 1 }),
    ).toEqual({
      type: "ready",
    });
    expect(
      readPreviewMessage({
        type: PREVIEW_MESSAGE.selected,
        version: 1,
        block: "markak",
      }),
    ).toEqual({ type: "selected", block: "markak" });
    expect(readPreviewMessage({ type: PREVIEW_MESSAGE.ready })).toBeNull();
    expect(
      readPreviewMessage({ type: PREVIEW_MESSAGE.ready, version: 2 }),
    ).toBeNull();
    expect(readPreviewMessage("ready")).toBeNull();
    expect(
      readPreviewMessage({
        type: PREVIEW_MESSAGE.selected,
        version: 1,
        block: 5,
      }),
    ).toBeNull();
  });
});

// A target the shop would refuse goes to the preview as "no button" (acrobot 36371)
describe("previewRecord -- a refused button target", () => {
  it("sends null instead of a target the shop would refuse", () => {
    const record = previewRecord({
      texts: {},
      slides: [
        {
          eyebrow: "",
          title: "t",
          text: "",
          cta: "c",
          ctaHref: "https://maps.example/x",
          cta2: "d",
          cta2Href: "/hu/store",
          caption: "",
          caption2: "",
          imageUrl: null,
          imageAlt: "",
        },
      ],
      blocks: null,
      footer: null,
    });
    expect(record.slides?.[0]).toMatchObject({
      cta_href: null,
      cta2_href: "/hu/store",
    });
  });
});
