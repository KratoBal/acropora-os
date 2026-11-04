import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DocumentStore } from "../../service-assets/document-store/document-store.js";
import { WebshopInvoiceService } from "./webshop-invoice.service.js";
import type { WebshopInvoiceRepository } from "./webshop-invoice.repository.js";
import type { InvoiceCandidate } from "./webshop-invoice.rules.js";
import {
  mintDownloadToken,
  signLinkRequest,
  verifyDownloadToken,
} from "./webshop-invoice.token.js";

/**
 * A VENDÉG SZÁMLA-LETÖLTÉSE, memóriabeli tárolóval. MI PIROSÍT: ha egy hamis vagy lejárt kérésre hivatkozás jön; ha titok vagy
 * publikus cím nélkül bármi működik; ha a hivatkozás tokenje nem a rendelés ÉS a számla szerinti, vagy nem egyszer használatos;
 * ha egy másik rendelés számláját le lehet tölteni; ha a hiányzó PDF elégeti a tokent; ha a sztornózott számla letölthető marad.
 */
const SECRET = "s".repeat(40);
const BASE = "https://api.example.test/api";
const ENV = {
  WEBSHOP_INVOICE_SECRET: SECRET,
  WEBSHOP_INVOICE_PUBLIC_BASE_URL: `${BASE}/`,
} as NodeJS.ProcessEnv;
const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;

const invoice = (
  id: string,
  over: Partial<InvoiceCandidate> = {},
): InvoiceCandidate => ({
  id,
  direction: "OUTBOUND",
  status: "ISSUED",
  documentType: "INVOICE",
  pdfStorageKey: "k",
  invoiceNumber: `SZ/2026-${id}`,
  issueDate: new Date("2026-11-01T10:00:00.000Z"),
  ...over,
});

function world(
  invoices: Record<string, InvoiceCandidate[]>,
  options: {
    stornoed?: string[];
    pdfs?: string[];
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const redeemed = new Set<string>();
  const stornoed = new Set(options.stornoed ?? []);
  const repository = {
    candidatesOf: async (orderId: string) => invoices[orderId] ?? [],
    candidate: async (invoiceId: string, orderId: string) =>
      (invoices[orderId] ?? []).find((row) => row.id === invoiceId) ?? null,
    stornoedAmong: async (ids: readonly string[]) =>
      new Set(ids.filter((id) => stornoed.has(id))),
    redeem: async (jti: string) => {
      if (redeemed.has(jti)) return false;
      redeemed.add(jti);
      return true;
    },
  } as unknown as WebshopInvoiceRepository;
  const pdfs = new Set(
    options.pdfs ??
      Object.values(invoices)
        .flat()
        .map((i) => i.id),
  );
  const store = {
    get: async (key: { ownerId: string }) =>
      pdfs.has(key.ownerId) ? new Uint8Array([37, 80, 68, 70]) : null,
  } as unknown as DocumentStore;
  return {
    service: new WebshopInvoiceService(repository, store, options.env ?? ENV),
    redeemed,
  };
}

const request = (orderId = "order_1", ts = NOW) => ({
  order_id: orderId,
  ts,
  sig: signLinkRequest(SECRET, orderId, ts),
});

const tokenOf = (url: string) => url.split("/download/")[1]!;

describe("WebshopInvoiceService.link", () => {
  it("gives one link per invoice of the order, with claims for THAT order and invoice, a fresh jti and a short life", async () => {
    const w = world({
      order_1: [invoice("a"), invoice("b")],
      order_2: [invoice("z")],
    });
    const result = await w.service.link(request(), NOW_MS);
    assert.equal(result!.documents.length, 2);
    const claims = result!.documents.map((d) =>
      verifyDownloadToken(SECRET, tokenOf(d.url), NOW),
    );
    assert.deepEqual(
      claims.map((c) => [c!.orderId, c!.invoiceId]),
      [
        ["order_1", "a"],
        ["order_1", "b"],
      ],
    );
    assert.notEqual(claims[0]!.jti, claims[1]!.jti);
    assert.ok(claims[0]!.exp - NOW <= 14 * 60);
    assert.match(
      result!.documents[0]!.url,
      new RegExp(`^${BASE}/integrations/webshop-invoice/download/`),
    );
    assert.equal(result!.documents[0]!.invoice_number, "SZ/2026-a");
  });

  it("an order without an invoice gets an empty list, not a refusal", async () => {
    const w = world({ order_1: [] });
    assert.deepEqual(await w.service.link(request(), NOW_MS), {
      documents: [],
    });
  });

  it("refuses (null) a wrong or stale signature, another order's signature, and a missing secret or address", async () => {
    const w = world({ order_1: [invoice("a")] });
    assert.equal(
      await w.service.link({ ...request(), sig: "AAAA" }, NOW_MS),
      null,
    );
    assert.equal(
      await w.service.link(request("order_1", NOW - 61), NOW_MS),
      null,
    );
    assert.equal(
      await w.service.link(
        { ...request("order_2"), order_id: "order_1" },
        NOW_MS,
      ),
      null,
    );
    const noSecret = world(
      { order_1: [invoice("a")] },
      { env: { ...ENV, WEBSHOP_INVOICE_SECRET: "" } },
    );
    assert.equal(await noSecret.service.link(request(), NOW_MS), null);
    const shortSecret = world(
      { order_1: [invoice("a")] },
      { env: { ...ENV, WEBSHOP_INVOICE_SECRET: "short" } },
    );
    assert.equal(await shortSecret.service.link(request(), NOW_MS), null);
    const noBase = world(
      { order_1: [invoice("a")] },
      { env: { ...ENV, WEBSHOP_INVOICE_PUBLIC_BASE_URL: "" } },
    );
    assert.equal(await noBase.service.link(request(), NOW_MS), null);
  });

  it("leaves a stornoed invoice out", async () => {
    const w = world(
      { order_1: [invoice("a"), invoice("b")] },
      { stornoed: ["a"] },
    );
    const result = await w.service.link(request(), NOW_MS);
    assert.deepEqual(
      result!.documents.map((d) => d.invoice_number),
      ["SZ/2026-b"],
    );
  });
});

describe("WebshopInvoiceService.download", () => {
  const linked = async (w: ReturnType<typeof world>) =>
    tokenOf((await w.service.link(request(), NOW_MS))!.documents[0]!.url);

  it("gives the PDF once, and the second use is the same null", async () => {
    const w = world({ order_1: [invoice("a")] });
    const token = await linked(w);
    const first = await w.service.download(token, NOW_MS);
    assert.deepEqual([...first!.bytes], [37, 80, 68, 70]);
    assert.equal(first!.filename, "szamla-SZ_2026-a.pdf");
    assert.equal(await w.service.download(token, NOW_MS), null);
  });

  it("refuses an expired token, another secret's token and garbage", async () => {
    const w = world({ order_1: [invoice("a")] });
    const token = await linked(w);
    assert.equal(
      await w.service.download(token, NOW_MS + 15 * 60 * 1000),
      null,
    );
    const forged = mintDownloadToken("t".repeat(40), {
      orderId: "order_1",
      invoiceId: "a",
      jti: "j",
      exp: NOW + 60,
    });
    assert.equal(await w.service.download(forged, NOW_MS), null);
    assert.equal(await w.service.download("garbage", NOW_MS), null);
    assert.equal(await w.service.download(undefined, NOW_MS), null);
  });

  it("a token for an invoice of ANOTHER order gives nothing (the claims name the order)", async () => {
    const w = world({ order_1: [invoice("a")], order_2: [invoice("z")] });
    const crossed = mintDownloadToken(SECRET, {
      orderId: "order_1",
      invoiceId: "z",
      jti: "j-cross",
      exp: NOW + 60,
    });
    assert.equal(await w.service.download(crossed, NOW_MS), null);
    assert.equal(w.redeemed.size, 0);
  });

  it("a missing PDF does not burn the token; an invoice stornoed since the link is refused", async () => {
    const missing = world({ order_1: [invoice("a")] }, { pdfs: [] });
    const token = await linked(missing);
    assert.equal(await missing.service.download(token, NOW_MS), null);
    assert.equal(missing.redeemed.size, 0);

    // the link was given before the storno; the download comes after it
    const later = world({ order_1: [invoice("a")] }, { stornoed: ["a"] });
    const forged = mintDownloadToken(SECRET, {
      orderId: "order_1",
      invoiceId: "a",
      jti: "j-late",
      exp: NOW + 60,
    });
    assert.equal(await later.service.download(forged, NOW_MS), null);
    assert.equal(later.redeemed.size, 0);
  });
});
