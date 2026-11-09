import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HttpException,
  NotFoundException,
  StreamableFile,
} from "@nestjs/common";

import { WebshopInvoiceController } from "./webshop-invoice.controller.js";
import { signLinkRequest } from "./webshop-invoice.token.js";
import { WebshopInvoiceService } from "./webshop-invoice.service.js";

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

  it("the download limit is per address and counts only AUTHENTIC tokens: the 21st authentic request of one address is refused with 429, another address is not", async () => {
    // the stub plays the service: an authentic token calls the counter, then finds nothing
    const service = controller({
      download: async (_token, _now, onAuthentic) => {
        onAuthentic?.();
        return null;
      },
    });
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

  it("garbage never reaches the counter: a thousand forged tokens and link requests leave the limits untouched (the REAL service verifies first)", async () => {
    const real = new WebshopInvoiceService(
      {} as never,
      {} as never,
      {
        WEBSHOP_INVOICE_SECRET: "k".repeat(40),
        WEBSHOP_INVOICE_PUBLIC_BASE_URL: "https://api.example.test",
      } as NodeJS.ProcessEnv,
    );
    const service = new WebshopInvoiceController(real);
    const attacker = callerOf("10.0.3.1");
    for (let i = 0; i < 1000; i += 1) {
      await assert.rejects(
        service.download(`forged-${i}`, attacker),
        NotFoundException,
      );
      await assert.rejects(
        service.link(
          { order_id: "o", ts: Math.floor(Date.now() / 1000), sig: "AAAA" },
          attacker,
        ),
        NotFoundException,
      );
    }
    // the same address still gets the plain 404 (not 429), and the shared ceiling is intact for another caller
    await assert.rejects(
      service.download("forged", attacker),
      NotFoundException,
    );
    assert.equal(WebshopInvoiceController.downloads.hit("10.0.3.9"), true);
    assert.equal(WebshopInvoiceController.links.hit("10.0.3.9"), true);
  });

  it("an AUTHENTIC link request does count (the REAL service calls the counter): the 121st from one address is a 429", async () => {
    const secret = "k".repeat(40);
    const real = new WebshopInvoiceService(
      {
        candidatesOf: async () => [],
        stornoedAmong: async () => new Set(),
      } as never,
      {} as never,
      {
        WEBSHOP_INVOICE_SECRET: secret,
        WEBSHOP_INVOICE_PUBLIC_BASE_URL: "https://api.example.test",
      } as NodeJS.ProcessEnv,
    );
    const service = new WebshopInvoiceController(real);
    const commerce = callerOf("10.0.4.1");
    const signed = () => {
      const ts = Math.floor(Date.now() / 1000);
      return {
        order_id: "order_1",
        ts,
        sig: signLinkRequest(secret, "order_1", ts),
      };
    };
    for (let i = 0; i < 120; i += 1)
      assert.deepEqual(await service.link(signed(), commerce), {
        documents: [],
      });
    await assert.rejects(
      service.link(signed(), commerce),
      (error: unknown) =>
        error instanceof HttpException && error.getStatus() === 429,
    );
  });
});
