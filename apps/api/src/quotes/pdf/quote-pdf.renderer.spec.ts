import assert from "node:assert/strict";
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
import { renderQuotePdf } from "./quote-pdf.renderer.js";

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
      assert.match(onPage, /AJ-2026-0042 v2/, `${page}. oldal`);
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
              l.text.includes("Ajánlat bruttó összege") ||
              l.text.includes("Opciók nélkül"),
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
        page("1. Technikai rendszer"),
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
            ["Opcionális tételek", "Első opció", "Negyedik opció"].some((n) =>
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
        block("TERMS", {
          title: "Általános feltételek",
          startOnNewPage: true,
          content: doc("Feltétel szövege"),
        }),
      ]),
    );
    assert.deepEqual(await pagesOf(pdf.bytes, "Rövid bevezető"), [1]);
    assert.deepEqual(await pagesOf(pdf.bytes, "Általános feltételek"), [2]);
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
    assert.match(text, /Előleg: 30%/);
    assert.match(text, /Átadáskor: 70%/);
  });
});
