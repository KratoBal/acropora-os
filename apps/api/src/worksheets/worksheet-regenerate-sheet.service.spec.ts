import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

/*
  A PDF ÚJRAGENERÁLÁSA, A SZOLGÁLTATÁS DÖNTÉSEI (acrobot 56321, kártya 47e07a53). A dupla a repositoryt helyettesíti: a hatókör, a hibafajták és a mondatok mérődnek; az írást (archívum és csere egy tranzakcióban) az integrációs készlet méri.
  MI PIROSÍT: ha a partner hatókörrel is lefut (belsős lépés: a partner a saját lapját nem generálja újra); ha egy hiányzó lap nem 404; ha a nem lezárt, a hiányzó végleges vagy a hiányzó kiadott lap nem 409 kimondott okkal;
  ha a párhuzamos csere elvesztése nem 409; ha a siker nem adja vissza, történt-e változás.
*/
const BELSOS = {
  id: "szerelo-1",
  displayName: "Szerelő Szilárd",
  customerId: null,
  supplierId: null,
};
const PARTNER = { id: "kontakt-1", customerId: "customer-1", supplierId: null };

function service(
  result: unknown,
  seen: { calls: unknown[] } = { calls: [] },
  detail: unknown = { id: "worksheet-1", customerId: "customer-1" },
) {
  return new WorksheetsService({
    detail: async () => detail,
    regenerateIssuedSheet: async (...args: unknown[]) => {
      seen.calls.push(args);
      return result;
    },
  } as unknown as WorksheetsRepository);
}

describe("a PDF újragenerálása", () => {
  it("partner hatókörrel nem megy, és a repositoryhoz el sem jut", async () => {
    const seen = { calls: [] as unknown[] };
    await assert.rejects(
      () =>
        service({ ok: true, changed: true }, seen).regenerateIssuedSheet(
          "worksheet-1",
          PARTNER as never,
        ),
      (error: unknown) => error instanceof ForbiddenException,
    );
    assert.deepEqual(seen.calls, []);
  });

  it("ismeretlen lap: 404", async () => {
    const svc = new WorksheetsService({
      detail: async () => null,
    } as unknown as WorksheetsRepository);
    await assert.rejects(
      () => svc.regenerateIssuedSheet("nincs", BELSOS as never),
      (error: unknown) => error instanceof NotFoundException,
    );
  });

  it("minden kimondott ok 409, a saját mondatával", async () => {
    const mondatok: Record<string, RegExp> = {
      NOT_CLOSED: /nincs lezárva/i,
      NO_SHEET: /nincs kiadott PDF/i,
      SIGNED_SHEET_MISSING: /végleges/i,
      CONFLICT: /közben/i,
    };
    for (const [reason, minta] of Object.entries(mondatok)) {
      await assert.rejects(
        () =>
          service({ ok: false, reason }).regenerateIssuedSheet(
            "worksheet-1",
            BELSOS as never,
          ),
        (error: unknown) =>
          error instanceof ConflictException &&
          minta.test(String((error as ConflictException).message)),
        reason,
      );
    }
  });

  it("siker: megmondja, történt-e változás, és átadja a kezdeményező nevét és az időt", async () => {
    const seen = { calls: [] as unknown[] };
    const changed = await service(
      { ok: true, changed: true },
      seen,
    ).regenerateIssuedSheet("worksheet-1", BELSOS as never);
    assert.deepEqual(changed, { changed: true });
    const same = await service({
      ok: true,
      changed: false,
    }).regenerateIssuedSheet("worksheet-1", BELSOS as never);
    assert.deepEqual(same, { changed: false });
    const [id, input] = seen.calls[0] as [
      string,
      { actorName: string; at: string },
    ];
    assert.equal(id, "worksheet-1");
    assert.equal(input.actorName, "Szerelő Szilárd");
    assert.match(input.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

/*
  A PARTNER NEM LÁTJA AZ ARCHÍV PÉLDÁNYT (acrobot 56329): a régi elrendezésű PDF belső előzmény, a partner portál a lap összes csatolmányát listázza, ezért a szűrés a listában ÉS a letöltésben is áll. MI PIROSÍT: ha a partner listája az
  archívot hozza; ha a belsős lista nem hozza (az előzmény eltűnne); ha a partner az archív azonosítóját közvetlenül letöltheti; ha a partner a SAJÁT feltöltött `OTHER` fájlját nem látja.
*/
describe("az archív példány a partner elől rejtve", () => {
  const archiv = {
    id: "doc-archiv",
    type: "OTHER",
    caption:
      "A lap korábbi elrendezésű PDF-je, az újragenerálás előtti példány. Újragenerálva: 2026-11-18 20:40, Teszt Elek.",
  };
  const sajat = { id: "doc-sajat", type: "OTHER", caption: "Szivattyú előtte" };
  const lap = { id: "worksheet-1", customerId: "customer-1" };

  function listaSzolgaltatas() {
    return new WorksheetsService({
      detail: async () => lap,
      documents: async () => [archiv, sajat],
      document: async (_id: string, documentId: string) => ({
        ...(documentId === archiv.id ? archiv : sajat),
        fileName: "x.pdf",
        contentType: "application/pdf",
        sizeBytes: 3,
        content: Buffer.from("pdf"),
        storageKey: null,
      }),
    } as unknown as WorksheetsRepository);
  }

  it("a partner listája nem hozza az archívot, a saját fájlját igen", async () => {
    const result = await listaSzolgaltatas().documents("worksheet-1", {
      kind: "customer",
      customerId: "customer-1",
    } as never);
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["doc-sajat"],
    );
  });

  it("a belsős lista mindkettőt hozza", async () => {
    const result = await listaSzolgaltatas().documents("worksheet-1", {
      kind: "internal",
    } as never);
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["doc-archiv", "doc-sajat"],
    );
  });

  it("a partner az archív azonosítójával sem tölti le: 404, a saját fájlja megy", async () => {
    const partner = { kind: "customer", customerId: "customer-1" } as never;
    await assert.rejects(
      () =>
        listaSzolgaltatas().documentBytes("worksheet-1", "doc-archiv", partner),
      (error: unknown) => error instanceof NotFoundException,
    );
    const sajatLetoltes = await listaSzolgaltatas().documentBytes(
      "worksheet-1",
      "doc-sajat",
      partner,
    );
    assert.equal(sajatLetoltes.bytes.toString(), "pdf");
    const belsos = await listaSzolgaltatas().documentBytes(
      "worksheet-1",
      "doc-archiv",
      { kind: "internal" } as never,
    );
    assert.equal(belsos.bytes.toString(), "pdf");
  });
});
