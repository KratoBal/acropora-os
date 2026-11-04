import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HttpException,
  NotFoundException,
  StreamableFile,
} from "@nestjs/common";

import { WebshopInvoiceController } from "./webshop-invoice.controller.js";
import type { WebshopInvoiceService } from "./webshop-invoice.service.js";

/**
 * A SZÁMLA-LETÖLTÉS VÉGPONTJAI. MI PIROSÍT: ha egy hiba nem EGYFORMA 404 (a végpont megmondaná, mi létezik); ha a PDF nem
 * csatolmányként, no-store fejlécekkel megy; ha a kérésszám-korlát nem véd (címenként); ha a link-végpont a kérés tartalmát
 * kivétellel fogadja (nem objektum törzs).
 */
const callerOf = (ip: string) => ({ headers: {}, ip });

const controller = (service: Partial<WebshopInvoiceService>) =>
  new WebshopInvoiceController(service as WebshopInvoiceService);

describe("WebshopInvoiceController", () => {
  it("link: a null is a 404, a non-object body does not throw, a result is passed through", async () => {
    const none = controller({ link: async () => null });
    await assert.rejects(
      none.link("x", callerOf("10.0.0.1")),
      NotFoundException,
    );
    await assert.rejects(
      none.link(null, callerOf("10.0.0.1")),
      NotFoundException,
    );
    const some = controller({ link: async () => ({ documents: [] }) });
    assert.deepEqual(await some.link({}, callerOf("10.0.0.2")), {
      documents: [],
    });
  });

  it("download: every miss is the same 404, a hit is an attachment PDF", async () => {
    const miss = controller({ download: async () => null });
    for (const token of ["bad", "expired", "used"])
      await assert.rejects(
        miss.download(token, callerOf("10.0.1.1")),
        (error: unknown) =>
          error instanceof NotFoundException &&
          error.message === new NotFoundException().message,
      );
    const hit = controller({
      download: async () => ({
        bytes: new Uint8Array([1, 2]),
        filename: "szamla-X.pdf",
      }),
    });
    const file = await hit.download("t", callerOf("10.0.1.2"));
    assert.ok(file instanceof StreamableFile);
    const headers = file.getHeaders();
    assert.equal(headers.type, "application/pdf");
    assert.match(
      String(headers.disposition),
      /attachment; filename="szamla-X\.pdf"/,
    );
  });

  it("the responses are marked no-store, nosniff, sandboxed (decorators on the download route)", () => {
    const keys = Reflect.getMetadataKeys(
      WebshopInvoiceController.prototype.download,
    );
    assert.ok(keys.length > 0);
    const headers = Reflect.getMetadata(
      "__headers__",
      WebshopInvoiceController.prototype.download,
    ) as Array<{ name: string; value: string }>;
    const byName = Object.fromEntries(headers.map((h) => [h.name, h.value]));
    assert.equal(byName["Cache-Control"], "no-store");
    assert.equal(byName["X-Content-Type-Options"], "nosniff");
    assert.match(byName["Content-Security-Policy"] ?? "", /sandbox/);
  });

  it("the download limit is per address: the 21st request of one address is refused with 429, another address is not", async () => {
    const service = controller({ download: async () => null });
    const flood = callerOf("10.0.2.1");
    for (let i = 0; i < 20; i += 1)
      await assert.rejects(service.download("t", flood), NotFoundException);
    await assert.rejects(
      service.download("t", flood),
      (error: unknown) =>
        error instanceof HttpException && error.getStatus() === 429,
    );
    await assert.rejects(
      service.download("t", callerOf("10.0.2.2")),
      NotFoundException,
    );
  });
});
