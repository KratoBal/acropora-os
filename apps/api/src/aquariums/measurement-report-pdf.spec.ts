import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  ACROPORA_SERVICE_CONTACT,
  type AquariumMeasurementOccasion,
  type MeasurementRecommendationSegment,
} from "@acropora/types";

import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";
import {
  deviationCount,
  icpRows,
  measuredRows,
  previousValues,
} from "./measurement-report.js";
import {
  renderMeasurementReportPdf,
  type MeasurementReportPdfInput,
} from "./measurement-report-pdf.js";

const occasion = (
  measuredAt: string,
  values: Array<[string, number]>,
): AquariumMeasurementOccasion =>
  ({
    id: measuredAt,
    measuredAt,
    values: values.map(([parameterCode, value]) => ({ parameterCode, value })),
  }) as AquariumMeasurementOccasion;

const current = occasion("2026-10-08T08:45:00.000Z", [
  ["HOMERSEKLET", 25.2],
  ["PH", 7.94],
  ["FOSZFAT", 0.21],
]);
const earlier = occasion("2026-10-01T08:00:00.000Z", [
  ["HOMERSEKLET", 25.5],
  ["PH", 7.8],
  ["FOSZFAT", 0.16],
]);

function marine(over: Partial<MeasurementReportPdfInput> = {}) {
  const rows = measuredRows(
    current,
    previousValues([current, earlier], current),
    "TENGERI",
    [],
  );
  return {
    partner: "Minta Kft. · Korall medence",
    volumeAndMoment: "190 liter · 2026. október 8. 10:45",
    examination: "Helyszíni mérés",
    rows,
    icp: null,
    deviations: deviationCount(rows),
    notes: "A foszfát magas, 7 nap múlva kontrollmérés.",
    ...over,
  } satisfies MeasurementReportPdfInput;
}

/**
 * The link annotations of the PDF, as a viewer reads them (pdfjs): the URI and
 * the clickable box, in the top-origin page box of `readPdfTextLines`.
 */
async function linksOf(
  bytes: Uint8Array,
): Promise<
  { url: string; x: number; right: number; top: number; bottom: number }[]
> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
  });
  try {
    const doc = await task.promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const height = page.view[3] ?? 842;
      for (const a of await page.getAnnotations())
        if (a.subtype === "Link") {
          const [x1, y1, x2, y2] = a.rect as number[];
          out.push({
            url: a.url as string,
            x: x1!,
            right: x2!,
            top: height - y2!,
            bottom: height - y1!,
          });
        }
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/** The link box stands on the text line, over the product's name and not the whole line. */
async function linkOnLine(
  bytes: Uint8Array,
  line: string,
  nameAtStart: boolean,
) {
  const found = (await readPdfTextLines(bytes)).find((l) => l.text === line);
  assert.ok(found, `no line ${JSON.stringify(line)}`);
  const lineBottom = found.top! + found.height!;
  const on = (await linksOf(bytes)).filter(
    (l) => l.top < lineBottom && l.bottom > found.top!,
  );
  assert.equal(
    on.length,
    1,
    `links on ${JSON.stringify(line)}: ${JSON.stringify(on)}`,
  );
  const link = on[0]!;
  assert.ok(link.right - link.x > 20, "an empty link box");
  assert.ok(
    link.right <= found.x! + found.width! + 1,
    "the box runs past the line",
  );
  if (!nameAtStart)
    assert.ok(
      link.x > found.x! + 2,
      "the box starts at the line, not at the name",
    );
  return link;
}

async function textOf(input: MeasurementReportPdfInput): Promise<string> {
  const bytes = await renderMeasurementReportPdf(input);
  return (await readPdfTextLines(bytes)).map((l) => l.text).join(" | ");
}

describe("the measurement report PDF (Figma 06, 2:470)", () => {
  it("a marine occasion: the rows, the previous values, the marks and the count", async () => {
    const text = await textOf(marine());
    assert.match(text, /MÉRÉSI EREDMÉNYEK/);
    assert.doesNotMatch(text, /ICP ELEMZÉS/);
    assert.match(text, /2 ELTÉRÉS/);
    assert.match(text, /Hőmérséklet/);
    assert.match(text, /7,94/);
    assert.match(text, /7,8/);
    assert.match(text, /rendben · stabil/);
    assert.match(text, /alacsony · javul/);
    assert.match(text, /magas · romlik/);
    assert.match(text, /JAVASOLT INTÉZKEDÉSEK/);
    assert.match(text, /7 nap múlva kontrollmérés/);
  });

  /**
   * THE APPROVED RECOMMENDATION (2b3983e1): its text with the product's name
   * in it, and the product as a line under it. Without one, no block.
   */
  it("REPORT-RECOMMENDATION: the approved block, with the product named", async () => {
    const withBlock = await textOf(
      marine({
        recommendation: [
          { kind: "text", text: "A KH alacsony: " },
          {
            kind: "product",
            productId: "p1",
            name: "Kitalált KH puffer",
            url: "https://bolt.example.invalid/kh",
          },
          { kind: "text", text: " segít." },
        ],
      }),
    );
    assert.match(withBlock, /VÉLEMÉNY – JAVASLAT – AJÁNLOTT TERMÉKEK/);
    assert.match(withBlock, /A KH alacsony: Kitalált KH puffer segít\./);
    assert.match(withBlock, /• Kitalált KH puffer/);
    assert.doesNotMatch(await textOf(marine()), /AJÁNLOTT TERMÉKEK/);
  });

  /**
   * A TAGOLT SZÖVEG (Balázs, 2026-10-14). MI PIROSÍT: ha a szöveg saját
   * fejlécei nem fejlécként állnak, ha a közös cím mellettük is megjelenik, ha
   * a lista tétele nem pontozott sor, vagy a termék neve nem link a lapjára.
   */
  it("REPORT-RECOMMENDATION-SECTIONS: the text's own headings, a list, the name linked in the line", async () => {
    const recommendation: MeasurementRecommendationSegment[] = [
      {
        kind: "text",
        text: "Vélemény:\nA KH alacsony.\n\nJavaslat:\nEmelje lassan.\n\nAjánlott termékek:\n- ",
      },
      {
        kind: "product",
        productId: "p1",
        name: "Kitalált KH puffer",
        url: "https://bolt.example.invalid/kh",
      },
      { kind: "text", text: ": a KH emeléséhez" },
    ];
    const pdf = await renderMeasurementReportPdf(marine({ recommendation }));
    const text = await textOf(marine({ recommendation }));
    assert.match(
      text,
      /VÉLEMÉNY\s[\s\S]*A KH alacsony\.[\s\S]*JAVASLAT\s[\s\S]*Emelje lassan\.[\s\S]*AJÁNLOTT TERMÉKEK/,
    );
    assert.doesNotMatch(text, /VÉLEMÉNY – JAVASLAT/);
    assert.match(text, /• Kitalált KH puffer: a KH emeléséhez/);
    const link = await linkOnLine(
      pdf,
      "• Kitalált KH puffer: a KH emeléséhez",
      false,
    );
    assert.equal(link.url, "https://bolt.example.invalid/kh");
    assert.equal((await linksOf(pdf)).length, 1);
  });

  /**
   * A KATTINTHATÓ NÉV (Balázs, 2026-10-14 09:42 UTC: „a kattinthatóságot nem látom
   * a pdfben”). MI PIROSÍT: ha a kész PDF-ben a név nem link-annotáció a termék
   * lapjára (egy megjelenítő ezt olvassa, nem az URL bájtjait), ha a doboz nem a
   * név során, a néven áll, ha a régi, tagolatlan szövegben a sorban álló név nem
   * link, vagy ha egy URL nélküli termék mégis linket kap.
   */
  /**
   * A TÖRT NÉV (barracuda, #1694): a sor végén átnyúló név minden darabja
   * kattintható, a saját során. MI PIROSÍT: ha a töréskor csak egy doboz marad,
   * ha a második sor doboza a név után álló szóra is ráfut, vagy egy doboz más
   * sorra kerül.
   */
  it("REPORT-RECOMMENDATION-LINK-WRAP: a name broken over two lines is a link box on each, over the name only", async () => {
    const url = "https://bolt.example.invalid/kh";
    const pdf = await renderMeasurementReportPdf(
      marine({
        recommendation: [
          {
            kind: "text",
            text: "Ajánlott termékek:\n- A KH és a kalcium együtt alacsony, ezért ezt érdemes adagolni: ",
          },
          {
            kind: "product",
            productId: "p1",
            name: "Kitalált nagyon hosszú nevű kalcium- és magnézium-pótló kétkomponensű oldat 5000 ml utántöltő kiszerelésben",
            url,
          },
          { kind: "text", text: " naponta." },
        ],
      }),
    );
    const lines = await readPdfTextLines(pdf);
    const first = lines.find((l) => l.text.endsWith("kalcium- és magnézium-"));
    const second = lines.find((l) => l.text.endsWith("kiszerelésben naponta."));
    assert.ok(first && second, JSON.stringify(lines.map((l) => l.text)));
    const links = await linksOf(pdf);
    const on = (line: typeof first) =>
      links.filter(
        (l) => l.top < line!.top! + line!.height! && l.bottom > line!.top!,
      );
    const [a, b] = [on(first), on(second)];
    assert.deepEqual(
      [links.length, a.length, b.length, a[0]?.url, b[0]?.url],
      [2, 1, 1, url, url],
    );
    // the first box starts at the name, the second ends before " naponta."
    assert.ok(
      a[0]!.x > first.x! + 100,
      "the first box starts at the line, not at the name",
    );
    assert.ok(
      Math.abs(b[0]!.x - second.x!) < 1,
      "the second box does not start at the line",
    );
    assert.ok(
      b[0]!.right < second.x! + second.width! - 20,
      "the second box runs over the word after the name",
    );
  });

  it("REPORT-RECOMMENDATION-LINKS: the name is a URI annotation on itself; without a url, plain text", async () => {
    const url = "https://bolt.example.invalid/kh";
    const old = await renderMeasurementReportPdf(
      marine({
        recommendation: [
          { kind: "text", text: "A KH alacsony: " },
          { kind: "product", productId: "p1", name: "Kitalált KH puffer", url },
          { kind: "text", text: " segít." },
        ],
      }),
    );
    const inline = await linkOnLine(
      old,
      "A KH alacsony: Kitalált KH puffer segít.",
      false,
    );
    const listed = await linkOnLine(old, "• Kitalált KH puffer", true);
    assert.deepEqual(
      [inline.url, listed.url, (await linksOf(old)).length],
      [url, url, 2],
    );

    const noUrl = await renderMeasurementReportPdf(
      marine({
        recommendation: [
          { kind: "text", text: "Ajánlott termékek:\n- " },
          {
            kind: "product",
            productId: "p2",
            name: "Kitalált Mg oldat",
            url: null,
          },
          { kind: "text", text: "\nA KH alacsony: " },
          {
            kind: "product",
            productId: "p3",
            name: "Kitalált KH por",
            url: null,
          },
        ],
      }),
    );
    assert.deepEqual(await linksOf(noUrl), []);
    const text = (await readPdfTextLines(noUrl)).map((l) => l.text);
    assert.ok(text.includes("• Kitalált Mg oldat"), JSON.stringify(text));
    assert.ok(
      text.includes("A KH alacsony: Kitalált KH por"),
      JSON.stringify(text),
    );
  });

  /**
   * THE OFFICE FOOTER (#1639, Balázs 2026-10-08): the measurement report is
   * not a service document, so it carries the office's number, never the
   * service number of the worksheet.
   */
  it("REPORT-OFFICE-PHONE: the footer has the office's number", async () => {
    const text = await textOf(marine());
    assert.match(text, /\+36-20-2676801/);
    assert.ok(!text.includes(ACROPORA_SERVICE_CONTACT.phone));
  });

  /**
   * THE MARKS ARE REAL CHARACTERS (DejaVu): Noto Sans has no ✓ ↓ ↑, and a
   * missing glyph is an empty box that reads back as nothing. Each mark
   * stands on its word's row (the two fonts sit a little apart in height).
   */
  it("each mark is drawn, on the row of its words", async () => {
    const lines = await readPdfTextLines(
      await renderMeasurementReportPdf(marine()),
    );
    for (const [mark, words] of [
      ["✓", "rendben · stabil"],
      ["↓", "alacsony · javul"],
      ["↑", "magas · romlik"],
    ] as const) {
      const word = lines.find((l) => l.text.includes(words));
      assert.ok(word, words);
      assert.ok(
        lines.some(
          (l) =>
            l.text.includes(mark) &&
            l.pageNumber === word.pageNumber &&
            Math.abs((l.top ?? 0) - (word.top ?? 0)) < 3,
        ),
        `${mark} nincs a(z) ${words} soraban`,
      );
    }
  });

  it("with an ICP report, the title says so and the elements are listed", async () => {
    const icp = {
      title: "ICP eredmények · Fauna Marin",
      rows: icpRows([
        {
          elementCode: "Stroncium (Sr)",
          value: 9.1,
          unit: "mg/l",
          minimum: 7,
          maximum: 9,
          trend: null,
        },
      ]),
    };
    const text = await textOf(marine({ icp }));
    assert.match(text, /MÉRÉSI EREDMÉNYEK ÉS ICP ELEMZÉS/);
    assert.match(text, /ICP EREDMÉNYEK · FAUNA MARIN/);
    assert.match(text, /Stroncium \(Sr\)/);
  });

  it("D5: without any target range there is no badge, and without notes no actions", async () => {
    const fresh = occasion("2026-10-08T15:20:00.000Z", [["PH", 7.1]]);
    const rows = measuredRows(fresh, new Map(), "EDESVIZI", []);
    const text = await textOf(
      marine({ rows, deviations: deviationCount(rows), notes: null }),
    );
    assert.doesNotMatch(text, /ELTÉRÉS/);
    assert.doesNotMatch(text, /JAVASOLT INTÉZKEDÉSEK/);
    assert.match(text, /7,1/);
  });

  it("a marked occasion with nothing out of range says no deviation", async () => {
    const fine = occasion("2026-10-08T08:45:00.000Z", [["HOMERSEKLET", 25]]);
    const rows = measuredRows(fine, new Map(), "TENGERI", []);
    const text = await textOf(marine({ rows, deviations: 0 }));
    assert.match(text, /NINCS ELTÉRÉS/);
  });

  it("embeds Noto Sans for the text and DejaVu for the marks", async () => {
    const raw = (await renderMeasurementReportPdf(marine())).toString("latin1");
    assert.match(raw, /NotoSans-Regular/);
    assert.match(raw, /NotoSans-Bold/);
    assert.match(raw, /DejaVuSans/);
  });
});
