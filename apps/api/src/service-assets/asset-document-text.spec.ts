import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";

import { belsosUser } from "../testing/scope-user.fixture.js";
import { PAGE_END_MARKER } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { SupplierInvoiceImportError } from "../purchasing/supplier-invoice-import/supplier-invoice-import.error.js";
import {
  AssetDocumentTextCache,
  isTextReadable,
  textFromLines,
} from "./asset-document-text.js";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";
import { ServiceAssetsService } from "./service-assets.service.js";
import type { ServiceAssetsRepository } from "./service-assets.repository.js";

const INTERNAL = belsosUser();

/**
 * A real PDF, written by hand: one page, two lines. The text endpoint must
 * work on actual bytes, not only on a stubbed reader, so this goes through
 * the same `pdfTextLines` as production.
 */
function onePagePdf(lines: string[]): Uint8Array {
  const stream = lines
    .map(
      (line, index) => `BT /F1 12 Tf 72 ${720 - index * 20} Td (${line}) Tj ET`,
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function serviceWith(
  document: {
    contentType: string;
    content: Uint8Array | null;
    sha256?: string;
  } | null,
) {
  let reads = 0;
  const repository = {
    document: async () => {
      reads += 1;
      return document
        ? { fileName: "alkatresz.pdf", storageKey: null, ...document }
        : null;
    },
  } as unknown as ServiceAssetsRepository;
  return {
    service: new ServiceAssetsService(repository, new InMemoryDocumentStore()),
    reads: () => reads,
  };
}

describe("an asset attachment as text", () => {
  it("reads the text of a real PDF, in lines, with the page count", async () => {
    const { service } = serviceWith({
      contentType: "application/pdf",
      content: onePagePdf(["72555 Impeller", "Pump body"]),
      sha256: "a",
    });

    const result = await service.documentText("asset-1", "doc-1", INTERNAL);

    assert.equal(result.documentId, "doc-1");
    assert.equal(result.fileName, "alkatresz.pdf");
    assert.equal(result.pageCount, 1);
    assert.equal(result.hasText, true);
    assert.equal(result.truncated, false);
    assert.equal(result.text, `72555 Impeller\nPump body\n${PAGE_END_MARKER}`);
  });

  /**
   * The gate is the download's: what the caller may not see is a 404 before
   * any byte is read, not an empty text.
   */
  it("is a 404 for a document outside the caller's scope", async () => {
    const { service } = serviceWith(null);

    await assert.rejects(
      () => service.documentText("asset-1", "doc-1", INTERNAL),
      NotFoundException,
    );
  });

  it("refuses a photo with 415, saying it is not a PDF", async () => {
    const { service } = serviceWith({
      contentType: "image/jpeg",
      content: Uint8Array.from([1, 2, 3]),
    });

    await assert.rejects(
      () => service.documentText("asset-1", "doc-1", INTERNAL),
      (error: { getStatus(): number; message: string }) =>
        error.getStatus() === 415 && /nem PDF/.test(error.message),
    );
  });

  it("answers 422 for bytes that are not a PDF at all", async () => {
    const { service } = serviceWith({
      contentType: "application/pdf",
      content: new TextEncoder().encode("not a pdf"),
    });

    await assert.rejects(
      () => service.documentText("asset-1", "doc-1", INTERNAL),
      (error: { getStatus(): number }) => error.getStatus() === 422,
    );
  });

  /**
   * The cache never skips the access check: a second ask resolves the
   * document in scope again (the repository is read twice), only the parse is
   * saved.
   */
  it("checks access on every ask, and parses the same content once", async () => {
    let parses = 0;
    const cache = new AssetDocumentTextCache(async () => {
      parses += 1;
      return ["x", PAGE_END_MARKER];
    });
    const { service, reads } = serviceWith({
      contentType: "application/pdf",
      content: Uint8Array.from([1]),
      sha256: "same",
    });
    (
      service as unknown as { documentTexts: AssetDocumentTextCache }
    ).documentTexts = cache;

    await service.documentText("asset-1", "doc-1", INTERNAL);
    await service.documentText("asset-1", "doc-1", INTERNAL);

    assert.equal(reads(), 2);
    assert.equal(parses, 1);
  });
});

describe("the text cache", () => {
  it("does not remember a failed read", async () => {
    let calls = 0;
    const cache = new AssetDocumentTextCache(async () => {
      calls += 1;
      if (calls === 1) throw new SupplierInvoiceImportError("PDF_INVALID");
      return ["ok", PAGE_END_MARKER];
    });
    const bytes = async () => Uint8Array.from([1]);

    await assert.rejects(() => cache.text("k", bytes));
    const second = await cache.text("k", bytes);

    assert.equal(second.text, `ok\n${PAGE_END_MARKER}`);
    assert.equal(calls, 2);
  });

  it("evicts the least recently used entry beyond its capacity", async () => {
    const parsed: string[] = [];
    const cache = new AssetDocumentTextCache(async (bytes) => {
      parsed.push(String(bytes[0]));
      return [String(bytes[0])];
    }, 2);
    const of = (n: number) => async () => Uint8Array.from([n]);

    await cache.text("1", of(1));
    await cache.text("2", of(2));
    await cache.text("1", of(1)); // 1 is now the most recent
    await cache.text("3", of(3)); // evicts 2
    await cache.text("1", of(1));
    await cache.text("2", of(2));

    assert.deepEqual(parsed, ["1", "2", "3", "2"]);
  });
});

describe("the text shape", () => {
  it("says a scan has no text instead of returning an error", () => {
    assert.deepEqual(textFromLines([PAGE_END_MARKER, PAGE_END_MARKER]), {
      pageCount: 2,
      hasText: false,
      truncated: false,
      text: `${PAGE_END_MARKER}\n${PAGE_END_MARKER}`,
    });
  });

  it("cuts at the limit and says so", () => {
    const result = textFromLines(["abcdef", PAGE_END_MARKER], 4);
    assert.equal(result.text, "abcd");
    assert.equal(result.truncated, true);
  });

  it("only a PDF is readable as text", () => {
    assert.equal(isTextReadable("application/pdf"), true);
    assert.equal(isTextReadable("image/jpeg"), false);
    assert.equal(isTextReadable("image/png"), false);
  });

  /**
   * The list marks the readable ones from the same function the endpoint
   * uses, so the flag and the 415 cannot drift apart.
   */
  it("the document list takes its flag from the same rule", () => {
    const source = readFileSync(
      "src/service-assets/service-assets.repository.ts",
      "utf8",
    );
    assert.match(
      source,
      /textReadable: isTextReadable\(document\.contentType\)/,
    );
  });
});
