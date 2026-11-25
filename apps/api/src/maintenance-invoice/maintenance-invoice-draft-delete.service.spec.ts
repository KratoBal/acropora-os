import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";

import { MaintenanceInvoiceDraftService } from "./maintenance-invoice-draft.service.js";
import type { CompletionCertificatesRepository } from "../completion-certificates/completion-certificates.repository.js";
import type { MaintenanceInvoiceRepository } from "./maintenance-invoice.repository.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import type { SzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";

/**
 * A TIG PISZKOZAT TÖRLÉSÉNEK SZOLGÁLTATÁSA (Luca kérése, acrobot 61225). Mi pirosít: ha a "nem található" nem 404, ha
 * bármelyik más elutasítás nem 409 az elutasítás saját mondatával, ha a sikeres törlés után az előnézet PDF nem törlődik a
 * tárolóból a SOR azonosítójával és az előnézet kulcsával, ha egy elutasításnál a tárolóhoz nyúl, vagy ha a tároló hibája
 * miatt a törlés hibával tér vissza (a sor ekkor már törölve van).
 */
function subject(options: {
  result:
    | { refusal: { code: string; message: string } }
    | { removed: { pdfStorageKey: string | null } };
  storeDeleteError?: Error;
}) {
  const repositoryCalls: unknown[] = [];
  const storeDeletes: unknown[] = [];
  const repository = {
    deleteDraft: async (input: unknown) => {
      repositoryCalls.push(input);
      return options.result;
    },
  } as unknown as MaintenanceInvoiceRepository;
  const documentStore = {
    delete: async (key: unknown) => {
      storeDeletes.push(key);
      if (options.storeDeleteError) throw options.storeDeleteError;
      return true;
    },
  } as unknown as DocumentStore;
  return {
    repositoryCalls,
    storeDeletes,
    service: new MaintenanceInvoiceDraftService(
      {} as CompletionCertificatesRepository,
      repository,
      {} as SzamlazzCredentialProvider,
      documentStore,
      {} as SzamlazzAgentClient,
    ),
  };
}

describe("MaintenanceInvoiceDraftService.deleteDraft", () => {
  it("deletes the preview PDF of the removed row from the store, by the row's id", async () => {
    const { service, storeDeletes, repositoryCalls } = subject({
      result: { removed: { pdfStorageKey: "invoice/invoice-1/preview.pdf" } },
    });
    const outcome = await service.deleteDraft("invoice-1", { id: "user-1" });
    assert.deepEqual(outcome, { deleted: true });
    assert.deepEqual(repositoryCalls, [
      { invoiceId: "invoice-1", actorUserId: "user-1" },
    ]);
    assert.deepEqual(storeDeletes, [
      { owner: "invoice", ownerId: "invoice-1", documentId: "preview.pdf" },
    ]);
  });

  it("does not touch the store when the row had no stored preview", async () => {
    const { service, storeDeletes } = subject({
      result: { removed: { pdfStorageKey: null } },
    });
    assert.deepEqual(await service.deleteDraft("invoice-1", null), {
      deleted: true,
    });
    assert.deepEqual(storeDeletes, []);
  });

  it("is a 404 when the draft is not found", async () => {
    const { service, storeDeletes } = subject({
      result: {
        refusal: {
          code: "NOT_FOUND",
          message: "A piszkozat-számla nem található.",
        },
      },
    });
    await assert.rejects(
      service.deleteDraft("missing", { id: "user-1" }),
      (error: unknown) =>
        error instanceof NotFoundException &&
        error.message === "A piszkozat-számla nem található.",
    );
    assert.deepEqual(storeDeletes, []);
  });

  for (const code of ["NOT_DRAFT", "REFERENCED", "STALE"]) {
    it(`is a 409 with the refusal's own sentence for ${code}, and the store is not touched`, async () => {
      const { service, storeDeletes } = subject({
        result: { refusal: { code, message: `mondat ${code}` } },
      });
      await assert.rejects(
        service.deleteDraft("invoice-1", { id: "user-1" }),
        (error: unknown) =>
          error instanceof ConflictException &&
          error.message === `mondat ${code}`,
      );
      assert.deepEqual(storeDeletes, []);
    });
  }

  it("still succeeds when the store cannot delete the PDF (the row is already gone)", async () => {
    const { service, storeDeletes } = subject({
      result: { removed: { pdfStorageKey: "invoice/invoice-1/preview.pdf" } },
      storeDeleteError: new Error("disk"),
    });
    assert.deepEqual(await service.deleteDraft("invoice-1", { id: "u" }), {
      deleted: true,
    });
    assert.equal(storeDeletes.length, 1);
  });
});
