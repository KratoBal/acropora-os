import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";
import type { QuoteRichText } from "@acropora/types";

import { readPdfTextLines } from "../../documents/pdf/pdf-text-readback.js";
import {
  formatQuoteMoney,
  quoteTotals,
  richTextParagraphs,
  type QuotePdfBlock,
  type QuotePdfInput,
  type QuotePdfItem,
} from "./quote-pdf-layout.js";
import { coverLayout, renderQuotePdf } from "./quote-pdf.renderer.js";

const d = (v: string) => new Prisma.Decimal(v);
const doc = (...texts: string[]): QuoteRichText => ({
  type: "doc",
  content: texts.map((t) => ({
    type: "paragraph" as const,
    content: [{ type: "text" as const, text: t }],
  })),
});
const item = (
  name: string,
  over: Partial<QuotePdfItem> = {},
): QuotePdfItem => ({
  name,
  description: null,
  quantity: d("1"),
  unit: "db",
  unitNetPrice: d("100000"),
  vatRatePercent: d("27"),
  isOptional: false,
  ...over,
});
const block = (
  kind: string,
  over: Partial<QuotePdfBlock> = {},
): QuotePdfBlock => ({
  kind,
  title: null,
  content: null,
  keepWithNext: false,
  startOnNewPage: false,
  items: [],
  ...over,
});
const input = (
  blocks: QuotePdfBlock[],
  over: Partial<QuotePdfInput> = {},
): QuotePdfInput => ({
  quoteNumber: "AJ-2026-0042",
  title: "Irodai bemutató akvárium",
  versionNumber: 2,
  validUntil: "2026-11-06",
  currency: "HUF",
  priceDisplay: "GROSS",
  customer: {
    name: "Blue Office Kft.",
    lines: ["1106 Budapest, Teszt utca 1."],
  },
  blocks,
  milestones: [],
  creationDate: new Date("2026-10-08T10:00:00Z"),
  ...over,
});
const filler = (lines: number) =>
  block("TEXT", {
    content: doc(
      ...Array.from({ length: lines }, (_, i) => `Kitöltő sor ${i + 1}`),
    ),
  });

async function pagesOf(bytes: Buffer, needle: string): Promise<number[]> {
  const hit = (await readPdfTextLines(bytes))
    .filter((l) => l.text.includes(needle))
    .map((l) => l.pageNumber);
  assert.ok(hit.length, `nem találom: ${needle}`);
  return hit;
}

describe("quote PDF content", () => {
  it("totals: the offered lines net and gross, the optional ones apart", () => {
    const t = quoteTotals([
      block("SECTION", {
        items: [
          item("A", { quantity: d("2") }),
          item("B", { isOptional: true, unitNetPrice: d("10") }),
        ],
      }),
    ]);
    assert.equal(t.net.toString(), "200000");
    assert.equal(t.gross.toString(), "254000");
    assert.equal(t.optionalNet.toString(), "10");
  });

  it("money: forint whole and grouped from four digits, other currencies to two places", () => {
    assert.equal(formatQuoteMoney(d("4800.5"), "HUF"), "4 801 Ft");
    assert.equal(formatQuoteMoney(d("3850000"), "HUF"), "3 850 000 Ft");
    assert.equal(formatQuoteMoney(d("1234.5"), "EUR"), "1 234,50 EUR");
  });

  it("rich text: paragraphs, numbers and bullets, hard breaks kept", () => {
    const paragraphs = richTextParagraphs({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Egy" },
            { type: "hardBreak" },
            { type: "text", text: "kettő" },
          ],
        },
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "első" }],
                },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "pont" }],
                },
              ],
            },
          ],
        },
      ],
    });
    assert.deepEqual(paragraphs, [
      { text: "Egy\nkettő", marker: null },
      { text: "első", marker: "1. " },
      { text: "pont", marker: "• " },
    ]);
  });
});

describe("the first page's header", () => {
  /**
   * The Figma header (3:2) sets the tagline, the title and the number BESIDE
   * the logo, so they cannot run into it (Balázs, stage 2026-10-08, when they
   * stood below it). What must still hold: the lines follow each other, and
   * the rule is below both the logo and the number.
   */
  it("the text column follows itself, and the rule is below the logo and the number", () => {
    // the logo's own aspect, read from the SVG it is drawn from
    const svg = readFileSync(
      new URL("../../../assets/branding/acropora-logo.svg", import.meta.url),
      "utf8",
    );
    const [, , w, h] = /viewBox="([^"]+)"/
      .exec(svg)![1]!
      .split(/\s+/)
      .map(Number);
    const top = 42;
    const logoBottom = top + (71 * h!) / w!;
    const at = coverLayout(top, 71);
    assert.ok(at.title >= at.tagline + 8 * 1.5);
    assert.ok(at.number >= at.title + 18 * 1.3);
    assert.ok(
      at.rule > at.number && at.rule > logoBottom + 4,
      `rule ${at.rule}`,
    );
  });
});

describe("quote PDF rendering (Figma 579:2898 rules)", () => {
  const sample = () =>
    input([
      block("TEXT", { content: doc("Köszönjük megtisztelő érdeklődésüket.") }),
      block("SECTION", {
        title: "Akvárium és bútor",
        items: [
          item("Egyedi gyártású akvárium", {
            description: doc("180 × 70 × 70 cm · extra clear üveg"),
          }),
        ],
      }),
      block("OPTIONS", {
        items: [item("Automatikus vízcsere rendszer", { isOptional: true })],
      }),
    ]);

  it("the same version renders the same bytes; another creation time does not", async () => {
    const a = await renderQuotePdf(sample());
    const b = await renderQuotePdf(sample());
    assert.equal(a.sha256, b.sha256);
    const other = await renderQuotePdf({
      ...sample(),
      creationDate: new Date("2026-10-09T10:00:00Z"),
    });
    assert.notEqual(other.sha256, a.sha256);
  });

  it("every page carries the quote number, the version and its page number", async () => {
    const pdf = await renderQuotePdf(input([filler(120)]));
    assert.ok(pdf.pageCount >= 3, `csak ${pdf.pageCount} oldal`);
    const lines = await readPdfTextLines(pdf.bytes);
    for (let page = 1; page <= pdf.pageCount; page += 1) {
      const onPage = lines
        .filter((l) => l.pageNumber === page)
        .map((l) => l.text)
        .join(" | ");
      // the Figma footer (3:13): the company line, the contact line, the
      // quote number and version, each page
      for (const needle of [
        "Acropora Kft. · TENGERI AKVÁRIUMOK · TERVEZÉS · KIVITELEZÉS",
        "1106 Budapest, Pesti Gábor utca 35 · +36-20-2676801 · www.acropora.hu · info@acropora.hu",
        "AJ-2026-0042 · v2",
      ])
        assert.ok(
          lines.some((l) => l.pageNumber === page && l.text.includes(needle)),
          `${page}. oldal, ${needle}: ${onPage}`,
        );
      assert.match(
        onPage,
        new RegExp(`${page} / ${pdf.pageCount}`),
        `${page}. oldal`,
      );
    }
  });

  it("keeps the Hungarian accents", async () => {
    const pdf = await renderQuotePdf(
      input([block("TEXT", { content: doc("Árvíztűrő tükörfúrógép ŐŰ") })]),
    );
    const lines = await readPdfTextLines(pdf.bytes);
    assert.ok(lines.some((l) => l.text.includes("Árvíztűrő tükörfúrógép ŐŰ")));
  });

  /**
   * THE SWEEP: 1 to 60 filler lines walk every following element down across
   * the first page bottom, so at least one fill puts it exactly there. A rule
   * that only holds away from the bottom is not measured by one sample.
   */
  const FILLS = Array.from({ length: 60 }, (_, i) => i + 1);
  /** No content line may reach into the footer band (the footer is below 780). */
  const contentInBody = (lines: Awaited<ReturnType<typeof readPdfTextLines>>) =>
    lines
      .filter((l) => (l.top ?? 0) < 780)
      .every((l) => (l.top ?? 0) + (l.height ?? 0) <= 772);

  it("the summary never breaks, and nothing runs into the footer", async () => {
    for (const fill of FILLS) {
      const pdf = await renderQuotePdf(
        input([
          filler(fill),
          block("SECTION", { title: "Rendszer", items: [item("Tétel")] }),
        ]),
      );
      const lines = await readPdfTextLines(pdf.bytes);
      const pages = new Set(
        lines
          .filter(
            (l) =>
              l.text.includes("ÖSSZESÍTÉS") ||
              l.text.includes("BRUTTÓ VÉGÖSSZEG"),
          )
          .map((l) => l.pageNumber),
      );
      assert.equal(pages.size, 1, `összesítő kettétörve (${fill})`);
      assert.ok(contentInBody(lines), `a láblécbe lóg (${fill})`);
    }
  });

  it("a section title moves with its first item, a name with its price", async () => {
    for (const fill of FILLS) {
      const pdf = await renderQuotePdf(
        input([
          filler(fill),
          block("SECTION", {
            title: "Technikai rendszer",
            items: [
              item("Komplett technikai rendszer"),
              item("Második tétel", { unitNetPrice: d("200000") }),
              item("Harmadik tétel", { unitNetPrice: d("300000") }),
            ],
          }),
        ]),
      );
      const lines = await readPdfTextLines(pdf.bytes);
      const page = (needle: string) =>
        lines.find((l) => l.text.includes(needle))?.pageNumber;
      // the price stands on the name's baseline (the readback may merge the two)
      const name = lines.find((l) =>
        l.text.includes("Komplett technikai rendszer"),
      )!;
      const priceBeside = lines.some(
        (l) =>
          l.pageNumber === name.pageNumber &&
          Math.abs((l.top ?? 0) - (name.top ?? 0)) < 4 &&
          l.text.includes("127 000 Ft"),
      );
      assert.equal(
        page("TECHNIKAI RENDSZER"),
        name.pageNumber,
        `cím (${fill})`,
      );
      assert.ok(priceBeside, `ár (${fill})`);
      // the later items, each with its own price on its line
      for (const [itemName, price] of [
        ["Második tétel", "254 000 Ft"],
        ["Harmadik tétel", "381 000 Ft"],
      ] as const) {
        const line = lines.find((l) => l.text.includes(itemName))!;
        assert.ok(
          lines.some(
            (l) =>
              l.pageNumber === line.pageNumber &&
              Math.abs((l.top ?? 0) - (line.top ?? 0)) < 4 &&
              l.text.includes(price),
          ),
          `${itemName} ára (${fill})`,
        );
      }
      assert.ok(contentInBody(lines), `a láblécbe lóg (${fill})`);
    }
  });

  it("an options block that fits on a page stays together", async () => {
    for (const fill of FILLS) {
      const pdf = await renderQuotePdf(
        input([
          filler(fill),
          block("OPTIONS", {
            items: [
              "Első opció",
              "Második opció",
              "Harmadik opció",
              "Negyedik opció",
            ].map((n) => item(n, { isOptional: true })),
          }),
        ]),
      );
      const lines = await readPdfTextLines(pdf.bytes);
      const pages = new Set(
        lines
          .filter((l) =>
            ["OPCIONÁLIS TÉTELEK", "Első opció", "Negyedik opció"].some((n) =>
              l.text.includes(n),
            ),
          )
          .map((l) => l.pageNumber),
      );
      assert.equal(pages.size, 1, `opciók kettétörve (${fill})`);
    }
  });

  it("a block marked startOnNewPage begins a page", async () => {
    const pdf = await renderQuotePdf(
      input([
        block("TEXT", { content: doc("Rövid bevezető") }),
        block("TEXT", {
          title: "Külön oldalra",
          startOnNewPage: true,
          content: doc("Szöveg"),
        }),
      ]),
    );
    assert.deepEqual(await pagesOf(pdf.bytes, "Rövid bevezető"), [1]);
    assert.deepEqual(await pagesOf(pdf.bytes, "KÜLÖN OLDALRA"), [2]);
  });

  /**
   * BALÁZS, 2026-10-08 15:13 UTC: the terms continue on the last page when
   * they fit there whole, even when marked startOnNewPage; when they do not
   * fit, they start a new page together (title and every paragraph).
   */
  it("the terms stay on the last page when they fit there, and move whole when not", async () => {
    const terms = (lines: number) =>
      block("TERMS", {
        title: "Általános feltételek",
        startOnNewPage: true,
        content: doc(
          ...Array.from({ length: lines }, (_, i) => `Feltétel ${i + 1}.`),
        ),
      });
    const short = await renderQuotePdf(
      input([block("TEXT", { content: doc("Rövid bevezető") }), terms(3)]),
    );
    assert.deepEqual(await pagesOf(short.bytes, "ÁLTALÁNOS FELTÉTELEK"), [1]);

    for (const fill of FILLS) {
      const pdf = await renderQuotePdf(input([filler(fill), terms(8)]));
      const title = (await pagesOf(pdf.bytes, "ÁLTALÁNOS FELTÉTELEK"))[0]!;
      for (const n of [1, 8])
        assert.deepEqual(
          await pagesOf(pdf.bytes, `Feltétel ${n}.`),
          [title],
          `kettétörve (${fill})`,
        );
    }
  });

  it("the payment schedule comes from the milestones", async () => {
    const pdf = await renderQuotePdf(
      input([block("SECTION", { title: "A", items: [item("X")] })], {
        milestones: [
          { label: "Előleg", percent: d("30") },
          { label: "Átadáskor", percent: d("70") },
        ],
      }),
    );
    const text = (await readPdfTextLines(pdf.bytes))
      .map((l) => l.text)
      .join(" | ");
    // each milestone with its share of the gross total (Figma 18:29)
    assert.match(text, /Előleg 30% \| 38 100 Ft|Előleg 30% 38 100 Ft/);
    assert.match(text, /Átadáskor 70% \| 88 900 Ft|Átadáskor 70% 88 900 Ft/);
    // and right after the summary, not at the end of the document
    assert.ok(
      text.indexOf("FIZETÉSI ÜTEMEZÉS") > text.indexOf("BRUTTÓ VÉGÖSSZEG"),
    );
  });

  it("with a summary block, the schedule follows it, before the terms", async () => {
    const pdf = await renderQuotePdf(
      input(
        [
          block("SECTION", { title: "A", items: [item("X")] }),
          block("SUMMARY", { title: "Összesítés" }),
          block("TERMS", { title: "Feltételek", content: doc("Szöveg") }),
        ],
        { milestones: [{ label: "Előleg", percent: d("100") }] },
      ),
    );
    const text = (await readPdfTextLines(pdf.bytes))
      .map((l) => l.text)
      .join(" | ");
    const at = (needle: string) => {
      const i = text.indexOf(needle);
      assert.ok(i >= 0, `nem találom: ${needle}`);
      return i;
    };
    assert.ok(at("BRUTTÓ VÉGÖSSZEG") < at("FIZETÉSI ÜTEMEZÉS"));
    assert.ok(at("FIZETÉSI ÜTEMEZÉS") < at("FELTÉTELEK"));
  });

  /**
   * A DESCRIPTION THAT RUNS ON: the next item follows it at the usual
   * distance (measured 2026-10-08: the amount column's height was compared
   * with the next page's position and left a gap of a third of a page).
   */
  it("after a description that runs onto the next page, the next item follows closely", async () => {
    const long = Array.from(
      { length: 6 },
      (_, i) => `Hosszú leírás ${i + 1}. sora, hogy átfolyjon.`,
    );
    let ranOn = 0;
    for (const fill of FILLS) {
      const pdf = await renderQuotePdf(
        input([
          filler(fill),
          block("SECTION", {
            title: "A",
            items: [
              item("Hosszú tétel", {
                quantity: d("2"),
                description: doc(...long),
              }),
              item("Következő tétel"),
            ],
          }),
        ]),
      );
      const lines = await readPdfTextLines(pdf.bytes);
      const name = lines.find((l) => l.text.includes("Hosszú tétel"))!;
      const last = lines.find((l) => l.text.includes("Hosszú leírás 6."))!;
      const next = lines.find((l) => l.text.includes("Következő tétel"))!;
      if (
        last.pageNumber === name.pageNumber ||
        next.pageNumber !== last.pageNumber
      )
        continue;
      ranOn += 1;
      assert.ok(
        (next.top ?? 0) - (last.top ?? 0) < 45,
        `rés ${(next.top ?? 0) - (last.top ?? 0)} (${fill})`,
      );
    }
    // known positive control: the sweep did put a description across a page
    assert.ok(ranOn > 0, "egyik kitöltésnél sem folyt át a leírás");
  });

  /** The brief (2026-10-08): only the VAT rates that occur, and "without options" only with options. */
  it("the summary lists only the VAT rates that occur, and says without options only when there are some", async () => {
    const lines = async (blocks: QuotePdfBlock[]) =>
      (await readPdfTextLines((await renderQuotePdf(input(blocks))).bytes))
        .map((l) => l.text)
        .join(" | ");
    const plain = await lines([
      block("SECTION", { title: "A", items: [item("X")] }),
    ]);
    assert.match(plain, /ÁFA 27%/);
    assert.doesNotMatch(plain, /ÁFA 5%/);
    assert.doesNotMatch(plain, /OPCIÓK NÉLKÜL/);
    const mixed = await lines([
      block("SECTION", {
        title: "A",
        items: [item("X"), item("Y", { vatRatePercent: d("5") })],
      }),
      block("OPTIONS", { items: [item("Z", { isOptional: true })] }),
    ]);
    assert.match(mixed, /ÁFA 27%/);
    assert.match(mixed, /ÁFA 5%/);
    assert.match(mixed, /BRUTTÓ VÉGÖSSZEG · OPCIÓK NÉLKÜL/);
  });

  /** The brief: the total in bold, and below it the multiplication when the quantity is not 1. */
  it("an item shows its total, and the multiplication only when the quantity is not 1", async () => {
    const text = (
      await readPdfTextLines(
        (
          await renderQuotePdf(
            input([
              block("SECTION", {
                title: "A",
                items: [
                  item("Egy darab"),
                  item("Két darab", { quantity: d("2") }),
                ],
              }),
            ]),
          )
        ).bytes,
      )
    )
      .map((l) => l.text)
      .join(" | ");
    assert.match(text, /1 db/);
    assert.doesNotMatch(text, /1 db ×/);
    assert.match(text, /254 000 Ft/);
    assert.match(text, /2 db × 127 000 Ft/);
  });

  it("with both prices, an item and an option show the net and the gross", async () => {
    const text = (
      await readPdfTextLines(
        (
          await renderQuotePdf(
            input(
              [
                block("SECTION", { title: "A", items: [item("Tétel")] }),
                block("OPTIONS", {
                  items: [item("Opció", { isOptional: true })],
                }),
              ],
              { priceDisplay: "BOTH" },
            ),
          )
        ).bytes,
      )
    )
      .map((l) => l.text)
      .join(" | ");
    assert.equal(text.match(/nettó 100 000 Ft/g)?.length, 2, text);
    assert.equal(text.match(/bruttó 127 000 Ft/g)?.length, 2, text);
  });

  it("an English quote has the English tagline, labels, options band and footer", async () => {
    const text = (
      await readPdfTextLines(
        (
          await renderQuotePdf(
            input(
              [
                block("OPTIONS", {
                  items: [item("Option", { isOptional: true })],
                }),
              ],
              { language: "en" },
            ),
          )
        ).bytes,
      )
    )
      .map((l) => l.text)
      .join(" | ");
    for (const needle of [
      "MARINE AQUARIUMS · DESIGN · INSTALLATION",
      "QUOTATION",
      "Prepared for",
      "Valid until: 6 November 2026",
      "OPTIONAL ITEMS",
      "Not included in the total.",
      "Acropora Kft. · MARINE AQUARIUMS · DESIGN · INSTALLATION",
    ])
      assert.ok(text.includes(needle), `${needle}: ${text}`);
    assert.doesNotMatch(text, /ÁRAJÁNLAT|Érvényes|Nem részei/);
  });

  it("the money is in Ft, and the design's Noto Sans pair is embedded", async () => {
    const pdf = await renderQuotePdf(
      input([block("SECTION", { title: "A", items: [item("X")] })]),
    );
    const raw = pdf.bytes.toString("latin1");
    assert.match(raw, /NotoSans-Regular/);
    assert.match(raw, /NotoSans-Bold/);
    const text = (await readPdfTextLines(pdf.bytes))
      .map((l) => l.text)
      .join(" | ");
    assert.match(text, /127 000 Ft/);
    assert.doesNotMatch(text, /HUF/);
  });
});
