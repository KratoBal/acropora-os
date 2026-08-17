import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

import type { ProductBarcodeRepository } from "./product-barcode.repository.js";
import { ProductBarcodeService } from "./product-barcode.service.js";

const repository = (overrides: Record<string, unknown> = {}) =>
  ({
    variantExists: async () => ({ id: "variant-1" }),
    list: async () => [],
    owner: async () => null,
    find: async () => ({
      id: "barcode-1",
      code: "5901234123457",
      isPrimary: true,
    }),
    add: async (variantId: string, code: string, isPrimary?: boolean) => ({
      id: "barcode-new",
      code,
      isPrimary: isPrimary ?? true,
    }),
    setPrimary: async () => [],
    remove: async () => [],
    ...overrides,
  }) as unknown as ProductBarcodeRepository;

const service = (overrides: Record<string, unknown> = {}) =>
  new ProductBarcodeService(repository(overrides));

describe("ProductBarcodeService", () => {
  it("normalises the code before storing it", async () => {
    let stored: string | undefined;
    await service({
      add: async (_variantId: string, code: string) => {
        stored = code;
        return { id: "barcode-new", code, isPrimary: true };
      },
    }).add("variant-1", { code: "  5901234123457 \n" });
    assert.equal(stored, "5901234123457");
  });

  it("refuses an EAN-shaped code whose own check digit disagrees", async () =>
    // Seven fabricated codes are already known in the catalogue; this field is
    // typed into by hand daily, so the check belongs here too, not only in the
    // one-off import.
    assert.rejects(
      () => service().add("variant-1", { code: "5901234123458" }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("ellenőrző számjegye"),
    ));

  it("still accepts a code that is not EAN-shaped at all", async () => {
    // The shop's internal numbering is not EAN and never claimed to be. The
    // rule above keys on "wrong" (false), never on "not applicable" (null),
    // which is what keeps these codes usable.
    const internal = await service().add("variant-1", { code: "ACRO12345" });
    assert.equal(internal.code, "ACRO12345");
  });

  it("rejects a code that is not storable at all", async () =>
    assert.rejects(
      () => service().add("variant-1", { code: "59/8" }),
      BadRequestException,
    ));

  it("names the owning SKU when the code is taken by another variant", async () => {
    await assert.rejects(
      () =>
        service({
          owner: async () => ({ variantId: "variant-2", sku: "ACR-114" }),
        }).add("variant-1", { code: "5901234123457" }),
      (error: unknown) =>
        error instanceof ConflictException && error.message.includes("ACR-114"),
    );
  });

  it("says so plainly when the code is already on this variant", async () =>
    assert.rejects(
      () =>
        service({
          owner: async () => ({ variantId: "variant-1", sku: "ACR-113" }),
        }).add("variant-1", { code: "5901234123457" }),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes("ennél a változatnál"),
    ));

  it("reports an unknown variant as missing", async () =>
    assert.rejects(
      () =>
        service({ variantExists: async () => null }).add("nope", {
          code: "5901234123457",
        }),
      NotFoundException,
    ));

  it("does not act on a barcode belonging to another variant", async () =>
    assert.rejects(
      () => service({ find: async () => null }).remove("variant-1", "other"),
      NotFoundException,
    ));

  it("passes the caller's primary choice through untouched", async () => {
    let received: boolean | undefined = true;
    await service({
      add: async (_v: string, code: string, isPrimary?: boolean) => {
        received = isPrimary;
        return { id: "barcode-new", code, isPrimary: false };
      },
    }).add("variant-1", { code: "5901234123457", isPrimary: false });
    // undefined would mean "decide from the count"; false is an explicit no.
    assert.equal(received, false);
  });
});
