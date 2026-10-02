import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DocumentKey } from "../../service-assets/document-store/document-store.js";
import {
  EbizClient,
  EbizError,
  type EbizInvoiceListItem,
} from "./ebiz.client.js";
import { ebizItem } from "./ebiz-invoice.spec.js";
import {
  EbizSyncService,
  type EbizSyncCounts,
  type EbizSyncStore,
} from "./ebiz-sync.service.js";

/** A client double: the list in pages, details and PDFs by id. */
class FakeClient {
  readonly listCalls: number[] = [];
  constructor(
    private readonly invoices: EbizInvoiceListItem[],
    private readonly opts: {
      configured?: boolean;
      perOffset?: "pages" | "items";
      failDetail?: Set<number>;
      failPdf?: Set<number>;
      failList?: boolean;
    } = {},
  ) {}
  configured() {
    return this.opts.configured ?? true;
  }
  async listInvoices(offset: number) {
    this.listCalls.push(offset);
    if (this.opts.failList) throw new EbizError("EBIZ_AUTH_FAILED");
    const start = this.opts.perOffset === "items" ? offset : offset * 50;
    return {
      data: this.invoices.slice(start, start + 50),
      pager: { total: this.invoices.length, limit: 50, offset },
    };
  }
  async getInvoice(id: number) {
    if (this.opts.failDetail?.has(id)) throw new EbizError("EBIZ_HTTP_500");
    return { id, invoiceNumber: `TEST${id}`, items: [] };
  }
  async downloadInvoicePdf(id: number) {
    if (this.opts.failPdf?.has(id)) throw new EbizError("EBIZ_NOT_PDF");
    return new TextEncoder().encode(`%PDF-${id}`);
  }
}

type Row = {
  id: string;
  pdfStorageKey: string | null;
  pdfMissingReason?: string | null;
  cancelled: boolean;
  externalPaymentStatus: string | null;
  grossAmount: string;
  data?: Record<string, unknown>;
};

class FakeStore implements EbizSyncStore {
  readonly rows = new Map<string, Row>();
  readonly runs: {
    id: string;
    status: string;
    counts?: EbizSyncCounts;
    errorCode?: string;
  }[] = [];
  readonly updates: string[] = [];
  async startRun() {
    const id = `run-${this.runs.length + 1}`;
    this.runs.push({ id, status: "RUNNING" });
    return id;
  }
  async finishRun(id: string, counts: EbizSyncCounts) {
    Object.assign(
      this.runs.find((r) => r.id === id)!,
      { status: "APPLIED", counts },
    );
  }
  async failRun(id: string, counts: EbizSyncCounts, errorCode: string) {
    Object.assign(
      this.runs.find((r) => r.id === id)!,
      { status: "FAILED", counts, errorCode },
    );
  }
  async existing(externalIds: string[]) {
    return new Map(
      externalIds
        .filter((id) => this.rows.has(id))
        .map((id) => [id, this.rows.get(id)!]),
    );
  }
  async create(data: {
    externalId: string;
    cancelled: boolean;
    externalPaymentStatus: string | null;
    grossAmount: string;
  }) {
    const row: Row = {
      id: `row-${data.externalId}`,
      pdfStorageKey: null,
      cancelled: data.cancelled,
      externalPaymentStatus: data.externalPaymentStatus,
      grossAmount: data.grossAmount,
      data,
    };
    this.rows.set(data.externalId, row);
    return { id: row.id };
  }
  async update(id: string, data: Record<string, unknown>) {
    this.updates.push(id);
    const row = [...this.rows.values()].find((r) => r.id === id)!;
    Object.assign(row, data);
  }
  async setPdf(id: string, key: string | null, reason: string | null) {
    const row = [...this.rows.values()].find((r) => r.id === id)!;
    row.pdfStorageKey = key;
    row.pdfMissingReason = reason;
  }
}

class FakeDocuments {
  readonly put: (key: DocumentKey, bytes: Uint8Array) => Promise<void>;
  readonly stored = new Map<string, Uint8Array>();
  constructor() {
    this.put = async (key, bytes) => {
      this.stored.set(`${key.owner}/${key.ownerId}/${key.documentId}`, bytes);
    };
  }
}

const STORE_ON = { DOCUMENT_STORE_ROOT: "/kitalalt/tar" };

function service(
  client: FakeClient,
  store: FakeStore,
  documents = new FakeDocuments(),
  env: NodeJS.ProcessEnv = STORE_ON,
) {
  return new EbizSyncService(
    client as unknown as EbizClient,
    store,
    documents as never,
    env,
  );
}

const many = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    ebizItem({
      id: i + 1,
      invoiceNumber: `TEST${String(i + 1).padStart(6, "0")}`,
    }),
  );

describe("az eBIZ napi szinkronja", () => {
  it("kulcs nélkül nem fut, és futás-sort sem ír", async () => {
    const store = new FakeStore();
    const client = new FakeClient(many(3), { configured: false });
    assert.deepEqual(await service(client, store).run("SCHEDULED"), {
      state: "NOT_CONFIGURED",
    });
    assert.equal(store.runs.length, 0);
    assert.equal(client.listCalls.length, 0);
  });

  it("az új számla létrejön, a PDF-je eltárolódik, a futás összesít", async () => {
    const store = new FakeStore();
    const documents = new FakeDocuments();
    const result = await service(new FakeClient(many(3)), store, documents).run(
      "SCHEDULED",
    );
    assert.equal(result.state, "APPLIED");
    assert.equal(store.rows.size, 3);
    assert.equal(documents.stored.size, 3);
    assert.equal(
      store.rows.get("1")!.pdfStorageKey,
      "external-invoices/row-1/ebiz.pdf",
    );
    assert.deepEqual(store.runs[0]!.counts, {
      fetchedCount: 3,
      createdCount: 3,
      updatedCount: 0,
      pdfStoredCount: 3,
      failedCount: 0,
    });
  });

  it("a második futás csak a változást írja, és a meglévő PDF-et nem tölti újra", async () => {
    const store = new FakeStore();
    const documents = new FakeDocuments();
    const invoices = many(2);
    await service(new FakeClient(invoices), store, documents).run("SCHEDULED");
    const paid = [{ ...invoices[0]!, paymentStatus: "PAID" }, invoices[1]!];
    const second = await service(new FakeClient(paid), store, documents).run(
      "SCHEDULED",
    );
    assert.equal(second.state === "APPLIED" && second.updatedCount, 1);
    assert.equal(second.state === "APPLIED" && second.pdfStoredCount, 0);
    assert.equal(store.updates.length, 1);
    assert.equal(store.rows.get("1")!.externalPaymentStatus, "PAID");
  });

  it("a hiányzó részlet vagy PDF nem állítja meg a futást, és nem esik ki", async () => {
    const store = new FakeStore();
    const result = await service(
      new FakeClient(many(3), {
        failDetail: new Set([1]),
        failPdf: new Set([2]),
      }),
      store,
    ).run("SCHEDULED");
    assert.equal(result.state === "APPLIED" && result.createdCount, 3);
    assert.equal(result.state === "APPLIED" && result.failedCount, 2);
    assert.equal(store.rows.get("2")!.pdfStorageKey, null);
    assert.equal(store.rows.get("2")!.pdfMissingReason, "EBIZ_NOT_PDF");
    // the row without its detail is kept, and its PDF still came
    assert.ok(store.rows.get("1")!.pdfStorageKey);
  });

  it("dokumentumtár nélkül a PDF-et le sem kéri, okkal jelöli, és később pótolja", async () => {
    const store = new FakeStore();
    const documents = new FakeDocuments();
    await service(new FakeClient(many(1)), store, documents, {}).run(
      "SCHEDULED",
    );
    assert.equal(
      store.rows.get("1")!.pdfMissingReason,
      "DOCUMENT_STORE_NOT_CONFIGURED",
    );
    assert.equal(documents.stored.size, 0);
    await service(new FakeClient(many(1)), store, documents).run("SCHEDULED");
    assert.ok(store.rows.get("1")!.pdfStorageKey);
  });

  it("a lista hibája FAILED futás a hibakóddal, és a hibát továbbadja", async () => {
    const store = new FakeStore();
    await assert.rejects(() =>
      service(new FakeClient(many(1), { failList: true }), store).run(
        "SCHEDULED",
      ),
    );
    assert.equal(store.runs[0]!.status, "FAILED");
    assert.equal(store.runs[0]!.errorCode, "EBIZ_AUTH_FAILED");
  });

  it("minden számlát behúz, akár lapot, akár tételt számol az offset", async () => {
    for (const perOffset of ["pages", "items"] as const) {
      const store = new FakeStore();
      const client = new FakeClient(many(824), { perOffset });
      const result = await service(client, store).run("SCHEDULED");
      assert.equal(
        result.state === "APPLIED" && result.fetchedCount,
        824,
        perOffset,
      );
      assert.equal(store.rows.size, 824, perOffset);
      // pages: 0..16; items: 0, 1, 50, 100, ... 800
      assert.ok(
        client.listCalls.length <= 19,
        `${perOffset}: ${client.listCalls.length} calls`,
      );
    }
  });
});
