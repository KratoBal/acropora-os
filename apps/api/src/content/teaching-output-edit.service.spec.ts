import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import PizZip from "pizzip";
import {
  buildTeachingOutput,
  buildTeachingSlides,
  teachingDeckText,
  type TeachingOutputBody,
  type TeachingOutputSource,
  type TeachingSlideText,
} from "@acropora/types";

import type {
  TeachingOutputEditRepository,
  TeachingOutputEditRow,
} from "./teaching-output-edit.repository.js";
import { TeachingOutputEditService } from "./teaching-output-edit.service.js";
import { renderTeachingPptx } from "./teaching-output-files.js";
import {
  readTeachingPptxText,
  TeachingPptxError,
} from "./teaching-pptx-text.js";

/*
  AN OUTPUT EDITED OUTSIDE THE SOURCE (T5.2). What turns these red: the
  text read back from our own deck not equal to what was generated (then
  every upload would "differ"); the slide order taken from the file names
  instead of the presentation; a file that is no deck read anyway; an edited
  PDF or narration compared half-way; a decision written twice.
*/

const AT = "2026-11-15T09:00:00.000Z";
const NOW = new Date(AT);
const PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const source: TeachingOutputSource = {
  title: "Az első hat hét",
  version: 2,
  subtitle: "Próba",
  author: "Akil",
  editor: null,
  audience: "INTERNAL",
  publicBasis: null,
  disclaimer: "Gyártói állítás.",
  parts: [
    {
      key: "a",
      title: "Indulás",
      text: "Várj 4 hetet. Mérd a sót.",
      subparts: [],
      checklist: ["Sótartalom"],
      speakerNote: null,
    },
  ],
  numbers: [],
};

describe("readTeachingPptxText", () => {
  it("reads our own deck back as exactly what was generated (footer aside)", async () => {
    const deck = buildTeachingSlides(source, AT);
    const read = readTeachingPptxText(await renderTeachingPptx(deck));
    const generated = teachingDeckText(deck);
    const cleaned = read.map((s) => ({
      title: s.title,
      points: s.points.filter((p) => p !== deck.stamp.footer),
    }));
    assert.deepEqual(cleaned, generated);
  });

  it("takes the order from the presentation, not from the file names", async () => {
    const zip = new PizZip(
      await renderTeachingPptx(buildTeachingSlides(source, AT)),
    );
    const path = "ppt/presentation.xml";
    const xml = zip.file(path)?.asText() ?? "";
    const ids = [...xml.matchAll(/<p:sldId [^>]*\/>/g)].map((m) => m[0]);
    assert.ok(ids.length >= 2);
    // the second slide moved to the front, as PowerPoint saves it
    const [first, second] = ids as [string, string];
    const swapped = xml
      .replace(first, "\u0000")
      .replace(second, first)
      .replace("\u0000", second);
    zip.file(path, swapped);
    const read = readTeachingPptxText(zip.generate({ type: "uint8array" }));
    assert.equal(read[0]?.title, "Indulás");
    assert.equal(read[1]?.title, "Az első hat hét");
  });

  it("stops inflating at the limit, even when the part's header lies about its size (barracuda on #2582)", async () => {
    const zip = new PizZip(
      await renderTeachingPptx(buildTeachingSlides(source, AT)),
    );
    const name = "ppt/slides/slide1.xml";
    // 25 MB of the same byte: a few kB once deflated, past the 20 MB limit inflated
    zip.file(name, " ".repeat(25_000_000));
    const bytes = Buffer.from(
      zip.generate({ type: "uint8array", compression: "DEFLATE" }),
    );
    // the header says 100 bytes: in the local header (offset 22) and in the
    // central directory (offset 24), both found by the part's name
    const nameBytes = Buffer.from(name, "latin1");
    for (
      let at = bytes.indexOf(nameBytes);
      at !== -1;
      at = bytes.indexOf(nameBytes, at + 1)
    ) {
      if (bytes.readUInt32LE(at - 30) === 0x04034b50)
        bytes.writeUInt32LE(100, at - 30 + 22);
      if (bytes.readUInt32LE(at - 46) === 0x02014b50)
        bytes.writeUInt32LE(100, at - 46 + 24);
    }
    assert.throws(
      () => readTeachingPptxText(bytes),
      (error: unknown) =>
        error instanceof TeachingPptxError && /túl nagy/.test(error.message),
    );
  });

  it("refuses what is no deck", () => {
    assert.throws(
      () => readTeachingPptxText(new TextEncoder().encode("nem zip")),
      TeachingPptxError,
    );
    const zip = new PizZip();
    zip.file("word/document.xml", "<w:document/>");
    assert.throws(
      () => readTeachingPptxText(zip.generate({ type: "uint8array" })),
      TeachingPptxError,
    );
  });
});

function setup(
  kind: TeachingOutputBody["kind"] = "SLIDES",
  rows: TeachingOutputEditRow[] = [],
  decides = true,
) {
  const body = buildTeachingOutput(kind, source, AT);
  const created: { slides: TeachingSlideText[]; sha256: string }[] = [];
  const decided: unknown[] = [];
  const repository = {
    output: async (_c: string, id: string) =>
      id === "o1" ? { kind, body } : null,
    create: async (input: { slides: TeachingSlideText[]; sha256: string }) => {
      created.push(input);
      rows.push({
        id: `e-new-${rows.length + 1}`,
        outputId: "o1",
        fileName: "diasor.pptx",
        sizeBytes: 1,
        sha256: input.sha256,
        slides: input.slides,
        uploadedById: "u1",
        uploadedAt: NOW,
        toSource: null,
        decisionNote: null,
        decidedById: null,
        decidedAt: null,
      });
      return `e-new-${rows.length}`;
    },
    list: async () => rows,
    get: async (_o: string, id: string) =>
      rows.find((r) => r.id === id) ?? null,
    decide: async (input: unknown) => {
      decided.push(input);
      return decides;
    },
  } as unknown as TeachingOutputEditRepository;
  return {
    service: new TeachingOutputEditService(repository, () => NOW),
    created,
    decided,
    body,
  };
}

const upload = (buffer: Buffer, name = "diasor.pptx", mimetype = PPTX) => ({
  originalname: name,
  mimetype,
  buffer,
});

describe("TeachingOutputEditService", () => {
  it("an unedited deck differs in nothing; an edited one names the slide", async () => {
    const { service, body } = setup();
    const deck = body as ReturnType<typeof buildTeachingSlides>;
    const same = await service.upload(
      "c1",
      "o1",
      upload(await renderTeachingPptx(deck)),
      "u1",
    );
    assert.equal(same.diff.changed, 0);

    const edited = {
      ...deck,
      slides: deck.slides.map((s) =>
        s.kind === "CONTENT"
          ? { ...s, points: ["Várj 6 hetet.", "Mérd a sót."] }
          : s,
      ),
    };
    const changed = await service.upload(
      "c1",
      "o1",
      upload(await renderTeachingPptx(edited)),
      "u1",
    );
    assert.equal(changed.diff.changed, 1);
    const slide = changed.diff.slides.find((d) => d.change === "CHANGED");
    assert.deepEqual(slide?.removedPoints, ["Várj 4 hetet."]);
    assert.deepEqual(slide?.addedPoints, ["Várj 6 hetet."]);
  });

  it("compares a slide deck only, and only a .pptx", async () => {
    await assert.rejects(
      setup("PRINTABLE").service.upload(
        "c1",
        "o1",
        upload(Buffer.from("x")),
        "u1",
      ),
      ConflictException,
    );
    const { service, created } = setup();
    await assert.rejects(
      service.upload("c1", "o1", upload(Buffer.from("x"), "diasor.pdf"), "u1"),
      BadRequestException,
    );
    await assert.rejects(
      service.upload(
        "c1",
        "o1",
        upload(Buffer.from("x"), "diasor.pptx", "text/plain"),
        "u1",
      ),
      BadRequestException,
    );
    await assert.rejects(
      service.upload("c1", "o1", upload(Buffer.from("nem zip")), "u1"),
      BadRequestException,
    );
    await assert.rejects(
      service.upload("c1", "nincs", upload(Buffer.from("x")), "u1"),
      NotFoundException,
    );
    assert.equal(created.length, 0);
  });

  it("decides once; a second decision, or a lost race, is a conflict", async () => {
    const { service, decided, body } = setup();
    await service.upload(
      "c1",
      "o1",
      upload(
        await renderTeachingPptx(
          body as ReturnType<typeof buildTeachingSlides>,
        ),
      ),
      "u1",
    );
    await service.decide(
      "c1",
      "o1",
      "e-new-1",
      { toSource: true, note: "átvezetni" },
      "u2",
    );
    assert.equal(decided.length, 1);
    await assert.rejects(
      service.decide("c1", "o1", "e-new-1", { toSource: "igen" }, "u2"),
      BadRequestException,
    );

    const done = setup("SLIDES", [
      {
        id: "e1",
        outputId: "o1",
        fileName: "x.pptx",
        sizeBytes: 1,
        sha256: "h",
        slides: [],
        uploadedById: "u1",
        uploadedAt: NOW,
        toSource: false,
        decisionNote: null,
        decidedById: "u2",
        decidedAt: NOW,
      },
    ]);
    await assert.rejects(
      done.service.decide("c1", "o1", "e1", { toSource: true }, "u2"),
      ConflictException,
    );
    assert.equal(done.decided.length, 0);

    const race = setup(
      "SLIDES",
      [
        {
          id: "e1",
          outputId: "o1",
          fileName: "x.pptx",
          sizeBytes: 1,
          sha256: "h",
          slides: [],
          uploadedById: "u1",
          uploadedAt: NOW,
          toSource: null,
          decisionNote: null,
          decidedById: null,
          decidedAt: null,
        },
      ],
      false,
    );
    await assert.rejects(
      race.service.decide("c1", "o1", "e1", { toSource: true }, "u2"),
      ConflictException,
    );
  });
});
