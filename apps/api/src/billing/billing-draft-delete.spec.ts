import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { draftDeleteRefusal } from "./billing-draft-delete.js";
import type { DraftDeleteRefusal } from "./billing-draft-delete.js";
import type { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";

/**
 * A VÁZLAT TÖRLÉSE (kártya 6a75f15c). MI PIROSÍT: ha a kiállítás alatt álló, a kiállított vagy az elutasított bizonylat törölhetne; ha egy
 * sorszámmal rendelkező "vázlat" törölhetne; ha egy másik bizonylat által hivatkozott vázlat törölhetne (a hivatkozás csendben elszakadna);
 * ha egy közben mentett vázlat törölhetne; ha az időbélyeg nélküli vagy hibás kérés eljutna a tárolóig; ha a "nincs ilyen" nem 404 és a
 * többi elutasítás nem 409.
 */
const T0 = new Date("2026-11-16T10:00:00Z");
const draft = (over: Record<string, unknown> = {}) => ({
  status: "DRAFT",
  invoiceNumber: null,
  updatedAt: T0,
  ...over,
});

describe("draftDeleteRefusal", () => {
  it("an unnumbered draft nobody refers to, with the loaded timestamp, may be deleted", () => {
    assert.equal(draftDeleteRefusal(draft(), 0, T0), null);
  });

  it("ISSUING, ISSUED and ISSUE_FAILED are refused, each with its own sentence", () => {
    const messages = new Set<string>();
    for (const status of ["ISSUING", "ISSUED", "ISSUE_FAILED"]) {
      const refusal = draftDeleteRefusal(draft({ status }), 0, T0);
      assert.equal(refusal?.code, "NOT_DRAFT", status);
      messages.add(refusal!.message);
    }
    assert.equal(messages.size, 3);
  });

  it("a draft that already has a number is refused", () => {
    assert.equal(
      draftDeleteRefusal(draft({ invoiceNumber: "E-2026-1" }), 0, T0)?.code,
      "NOT_DRAFT",
    );
  });

  it("a draft another document refers to is refused", () => {
    assert.equal(draftDeleteRefusal(draft(), 1, T0)?.code, "REFERENCED");
  });

  it("a draft saved since it was loaded is refused", () => {
    assert.equal(
      draftDeleteRefusal(draft(), 0, new Date("2026-11-16T09:59:59Z"))?.code,
      "STALE",
    );
  });

  it("the state wins over the reference, and the reference over the timestamp", () => {
    assert.equal(
      draftDeleteRefusal(draft({ status: "ISSUED" }), 2, new Date(0))?.code,
      "NOT_DRAFT",
    );
    assert.equal(
      draftDeleteRefusal(draft(), 2, new Date(0))?.code,
      "REFERENCED",
    );
  });
});

describe("BillingDocumentsService.deleteDraft", () => {
  const USER = { id: "user-1" } as AuthenticatedUser;
  function setup(refusal: DraftDeleteRefusal | null) {
    const calls: Array<{
      id: string;
      expectedUpdatedAt: Date;
      actorUserId: string;
    }> = [];
    const repository = {
      deleteDraft: async (input: (typeof calls)[number]) => {
        calls.push(input);
        return refusal;
      },
    } as unknown as BillingDocumentsRepository;
    return { service: new BillingDocumentsService(repository), calls };
  }

  it("passes the id, the parsed timestamp and the actor to the store, and answers deleted", async () => {
    const { service, calls } = setup(null);
    assert.deepEqual(
      await service.deleteDraft("doc-1", "2026-11-16T10:00:00.000Z", USER),
      { deleted: true },
    );
    assert.deepEqual(calls, [
      { id: "doc-1", expectedUpdatedAt: T0, actorUserId: "user-1" },
    ]);
  });

  it("a missing or invalid timestamp is a 400 and never reaches the store", async () => {
    for (const bad of [undefined, "", "nem-datum"]) {
      const { service, calls } = setup(null);
      await assert.rejects(
        service.deleteDraft("doc-1", bad, USER),
        BadRequestException,
        String(bad),
      );
      assert.equal(calls.length, 0, String(bad));
    }
  });

  it("not found is a 404, every other refusal a 409 that carries the sentence", async () => {
    await assert.rejects(
      setup({ code: "NOT_FOUND", message: "nincs" }).service.deleteDraft(
        "doc-1",
        "2026-11-16T10:00:00.000Z",
        USER,
      ),
      NotFoundException,
    );
    for (const code of ["NOT_DRAFT", "REFERENCED", "STALE"] as const) {
      await assert.rejects(
        setup({ code, message: `mondat-${code}` }).service.deleteDraft(
          "doc-1",
          "2026-11-16T10:00:00.000Z",
          USER,
        ),
        (error: unknown) =>
          error instanceof ConflictException &&
          error.message === `mondat-${code}`,
        code,
      );
    }
  });
});
