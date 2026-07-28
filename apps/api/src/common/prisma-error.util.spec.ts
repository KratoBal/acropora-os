import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPrismaUniqueConstraintViolation } from "./prisma-error.util.js";

describe("isPrismaUniqueConstraintViolation", () => {
  it("recognizes a P2002 error whose meta.target (string array) mentions the field", () => {
    const error = {
      code: "P2002",
      meta: { target: ["supplierId", "supplierInvoiceNumber"] },
    };
    assert.equal(
      isPrismaUniqueConstraintViolation(error, "supplierInvoiceNumber"),
      true,
    );
  });

  it("recognizes a P2002 error whose meta.target is a single string", () => {
    const error = { code: "P2002", meta: { target: "idempotencyKey" } };
    assert.equal(
      isPrismaUniqueConstraintViolation(error, "idempotencyKey"),
      true,
    );
  });

  it("does not misclassify a P2002 on a different unique field", () => {
    const error = { code: "P2002", meta: { target: ["documentNumber"] } };
    assert.equal(
      isPrismaUniqueConstraintViolation(error, "idempotencyKey"),
      false,
    );
  });

  it("returns false for a different Prisma error code", () => {
    const error = { code: "P2025", meta: { target: ["idempotencyKey"] } };
    assert.equal(
      isPrismaUniqueConstraintViolation(error, "idempotencyKey"),
      false,
    );
  });

  it("returns false when there is no meta at all", () => {
    const error = { code: "P2002" };
    assert.equal(
      isPrismaUniqueConstraintViolation(error, "idempotencyKey"),
      false,
    );
  });

  it("returns false when meta.target is missing", () => {
    const error = { code: "P2002", meta: {} };
    assert.equal(
      isPrismaUniqueConstraintViolation(error, "idempotencyKey"),
      false,
    );
  });

  it("returns false for a plain Error (no Prisma shape)", () => {
    assert.equal(
      isPrismaUniqueConstraintViolation(new Error("boom"), "idempotencyKey"),
      false,
    );
  });

  it("returns false for non-object values (string, number, null, undefined)", () => {
    assert.equal(isPrismaUniqueConstraintViolation("P2002", "x"), false);
    assert.equal(isPrismaUniqueConstraintViolation(42, "x"), false);
    assert.equal(isPrismaUniqueConstraintViolation(null, "x"), false);
    assert.equal(isPrismaUniqueConstraintViolation(undefined, "x"), false);
  });

  it("recognizes a real Prisma.PrismaClientKnownRequestError instance (structural check still matches the real shape)", async () => {
    const { Prisma: RuntimePrisma } = await import("@acropora/database");
    const error = new RuntimePrisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["idempotencyKey"] },
    });
    assert.equal(
      isPrismaUniqueConstraintViolation(error, "idempotencyKey"),
      true,
    );
  });
});
