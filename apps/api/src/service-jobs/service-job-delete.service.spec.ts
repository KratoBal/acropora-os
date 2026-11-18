import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import {
  ServiceJobDeleteRefused,
  type ServiceJobDeleteRepository,
  type ServiceJobDeleteSnapshot,
} from "./service-job-delete.repository.js";
import type { ServiceJobDeleteFacts } from "./service-job-delete.rules.js";
import { ServiceJobDeleteService } from "./service-job-delete.service.js";

/*
  A TÖRLÉS SZOLGÁLTATÁSA (acrobot 55766, 55770): az előnézet a tiszta szabályt mutatja, a törlés a tárolóra bízza a tranzakciót, a tiltást 409-re, a
  hiányzó jegyet 404-re képezi, a partner nem is tudja, hogy van ilyen jegy (404), és a tárolóba írt csatolmányok a törlés UTÁN, csak SIKER esetén
  mennek ki a tárolóból. MI PIROSÍT: ha a tiltás nem 409; ha a partner előnézetet vagy törlést kap; ha a fájl a bukott törlés után is törlődik; ha a
  sikeres törlés után a fájl marad; ha az előnézet nem a tiszta szabályt mutatja.
*/
const FACTS: ServiceJobDeleteFacts = {
  status: "NEW",
  kind: "REPAIR",
  hasCompletionCertificate: false,
  hasMaintenanceOrder: false,
  worksheets: [],
  procuredMaterialRequests: 0,
  stockMovements: 0,
};
const SNAPSHOT: ServiceJobDeleteSnapshot = {
  id: "job-1",
  jobNumber: "HJ-2026-041",
  title: "Szivattyú",
  facts: FACTS,
  counts: { worksheets: 1, documents: 2, materialRequests: 0 },
};
const internal = { id: "user-1" } as AuthenticatedUser;
const partner = { id: "user-2", customerId: "cust-1" } as AuthenticatedUser;

function build(
  over: {
    snapshot?: ServiceJobDeleteSnapshot | null;
    remove?: () => Promise<unknown>;
  } = {},
) {
  const discarded: unknown[] = [];
  const repository = {
    snapshot: async () =>
      over.snapshot === undefined ? SNAPSHOT : over.snapshot,
    remove:
      over.remove ??
      (async () => ({
        jobNumber: "HJ-2026-041",
        counts: SNAPSHOT.counts,
        stored: [
          { owner: "service-job", ownerId: "job-1", documentId: "doc-1" },
        ],
      })),
  } as unknown as ServiceJobDeleteRepository;
  const store = {
    delete: async (key: unknown) => {
      discarded.push(key);
    },
  };
  return {
    service: new ServiceJobDeleteService(repository, store as never),
    discarded,
  };
}

describe("a hibajegy törlésének szolgáltatása", () => {
  it("az előnézet a szabályt és a darabszámokat mutatja", async () => {
    const { service } = build();
    const preview = await service.preview("job-1", internal);
    assert.equal(preview.deletable, true);
    assert.equal(preview.refusal, null);
    assert.equal(preview.jobNumber, "HJ-2026-041");
    assert.deepEqual(preview.counts, SNAPSHOT.counts);

    const blocked = build({
      snapshot: {
        ...SNAPSHOT,
        facts: { ...FACTS, status: "COMPLETED" },
      },
    });
    const refused = await blocked.service.preview("job-1", internal);
    assert.equal(refused.deletable, false);
    assert.match(refused.refusal ?? "", /Lezárt hibajegy/);
  });

  it("a hiányzó jegy 404, a tiltás 409, a partner 404 (előnézet és törlés is)", async () => {
    await assert.rejects(
      build({ snapshot: null }).service.preview("x", internal),
      NotFoundException,
    );
    await assert.rejects(
      build({ remove: async () => null }).service.delete("x", internal),
      NotFoundException,
    );
    await assert.rejects(
      build({
        remove: async () => {
          throw new ServiceJobDeleteRefused("Aláírt munkalap tartozik.");
        },
      }).service.delete("job-1", internal),
      ConflictException,
    );
    await assert.rejects(
      build().service.preview("job-1", partner),
      NotFoundException,
    );
    await assert.rejects(
      build().service.delete("job-1", partner),
      NotFoundException,
    );
  });

  it("a sorosítási hiba (egyidejű írás) 409, nem 500", async () => {
    await assert.rejects(
      build({
        remove: async () => {
          throw Object.assign(new Error("serialization failure"), {
            code: "P2034",
          });
        },
      }).service.delete("job-1", internal),
      (error: unknown) =>
        error instanceof ConflictException &&
        /újra/.test((error as Error).message),
    );
  });

  it("a tárolóba írt csatolmány a sikeres törlés után törlődik, a bukott után nem", async () => {
    const ok = build();
    assert.deepEqual(await ok.service.delete("job-1", internal), {
      deleted: true,
      jobNumber: "HJ-2026-041",
    });
    assert.equal(ok.discarded.length, 1);

    const failed = build({
      remove: async () => {
        throw new ServiceJobDeleteRefused("tiltás");
      },
    });
    await assert.rejects(failed.service.delete("job-1", internal));
    assert.equal(failed.discarded.length, 0);
  });
});
