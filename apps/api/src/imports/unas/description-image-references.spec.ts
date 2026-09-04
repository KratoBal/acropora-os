import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  descriptionImageReferences,
  ownImageReferenceHosts,
} from "./description-image-references.js";
describe("leírásbeli képhivatkozások", () => {
  it("a konfigurált saját hostot és relatív utat sajátnak jelöli", () => {
    assert.deepEqual(
      descriptionImageReferences(
        '<img src="https://shop.acropora.hu/a.png"><img src="/b.png">',
        ownImageReferenceHosts("shop.acropora.hu"),
      ),
      [
        {
          url: "https://shop.acropora.hu/a.png",
          host: "shop.acropora.hu",
          isOwn: true,
        },
        { url: "/b.png", host: null, isOwn: true },
      ],
    );
  });
  it("a régi UNAS hostot idegenként rögzíti", () => {
    assert.deepEqual(
      descriptionImageReferences(
        '<img src="https://shop.unas.hu/kep.jpg">',
        ownImageReferenceHosts("shop.acropora.hu"),
      ),
      [
        {
          url: "https://shop.unas.hu/kep.jpg",
          host: "shop.unas.hu",
          isOwn: false,
        },
      ],
    );
  });
  it("a protokoll nélküli idegen host nem relatív út", () => {
    assert.equal(
      descriptionImageReferences(
        '<img src="//shop.unas.hu/kep.jpg">',
        ownImageReferenceHosts("shop.acropora.hu"),
      )[0]?.isOwn,
      false,
    );
  });
  it("a perjel nélküli relatív út saját", () => {
    assert.equal(
      descriptionImageReferences(
        '<img src="kepek/kep.jpg">',
        ownImageReferenceHosts("shop.acropora.hu"),
      )[0]?.isOwn,
      true,
    );
  });
});
