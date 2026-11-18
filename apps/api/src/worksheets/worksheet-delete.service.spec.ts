import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import {
  WorksheetDeleteRefused,
  type WorksheetDeleteRepository,
  type WorksheetDeleteSnapshot,
} from "./worksheet-delete.repository.js";
import type { WorksheetDeleteFacts } from "./worksheet-delete.rules.js";
import { WorksheetDeleteService } from "./worksheet-delete.service.js";

/*
  AZ ÖNÁLLÓ MUNKALAP TÖRLÉSÉNEK SZOLGÁLTATÁSA (a hibajegy-törlés 2. szelete). MI PIROSÍT: ha a tiltás nem 409; ha a partner előnézetet vagy törlést kap; ha a hiányzó lap nem 404;
  ha a fájl a bukott törlés után is törlődik, vagy a sikeres után marad; ha az előnézet nem a tiszta szabályt mutatja.
*/
const FACTS: WorksheetDeleteFacts = {
  hasServiceJob: false,
  number: null,
  handedOver: false,
  signed: false,
  awaitingSignature: false,
  continuedByOther: false,
  procuredMaterialRequests: 0,
  stockMovements: 0,
};
const SNAPSHOT: WorksheetDeleteSnapshot = {
  id: "ws-1",
  label: "Szivattyú csere",
  facts: FACTS,
  counts: { documents: 2, materialRequests: 1 },
};
const internal = { id: "user-1" } as AuthenticatedUser;
const partner = { id: "user-2", customerId: "cust-1" } as AuthenticatedUser;

function build(
  over: {
    snapshot?: WorksheetDeleteSnapshot | null;
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
        label: "Szivattyú csere",
        counts: SNAPSHOT.counts,
        stored: [{ owner: "worksheet", ownerId: "ws-1", documentId: "doc-1" }],
      })),
  } as unknown as WorksheetDeleteRepository;
  const store = {
    delete: async (key: unknown) => {
      discarded.push(key);
    },
  };
  return {
    service: new WorksheetDeleteService(repository, store as never),
    discarded,
  };
}

describe("az önálló munkalap törlésének szolgáltatása", () => {
  it("az előnézet a szabályt és a darabszámokat mutatja", async () => {
    const preview = await build().service.preview("ws-1", internal);
    assert.equal(preview.deletable, true);
    assert.equal(preview.label, "Szivattyú csere");
    assert.deepEqual(preview.counts, SNAPSHOT.counts);

    const under = await build({
      snapshot: { ...SNAPSHOT, facts: { ...FACTS, hasServiceJob: true } },
    }).service.preview("ws-1", internal);
    assert.equal(under.deletable, false);
    assert.match(under.refusal ?? "", /hibajegyhez tartozik/);
  });

  it("a hiányzó lap 404, a tiltás 409, a partner 404", async () => {
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
          throw new WorksheetDeleteRefused("Aláírt munkalap nem törölhető.");
        },
      }).service.delete("ws-1", internal),
      ConflictException,
    );
    await assert.rejects(
      build().service.preview("ws-1", partner),
      NotFoundException,
    );
    await assert.rejects(
      build().service.delete("ws-1", partner),
      NotFoundException,
    );
  });

  it("a tárolóba írt csatolmány a sikeres törlés után törlődik, a bukott után nem", async () => {
    const ok = build();
    assert.deepEqual(await ok.service.delete("ws-1", internal), {
      deleted: true,
    });
    assert.equal(ok.discarded.length, 1);

    const failed = build({
      remove: async () => {
        throw new WorksheetDeleteRefused("tiltás");
      },
    });
    await assert.rejects(failed.service.delete("ws-1", internal));
    assert.equal(failed.discarded.length, 0);
  });
});
