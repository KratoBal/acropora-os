import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssetDetail, AssetDocumentSummary } from "@acropora/types";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";
import type { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * AZ ESZKÖZ CSATOLMÁNY-LISTÁJA -- A BEKÖTÉS, NEM A SZŰRÉS.
 *
 * === MIT MÉR EZ A FÁJL, ÉS MIT NEM ===
 *
 * A két hatókör-szűrés (látható-e az eszköz, látható-e ez a fajta irat) a
 * tárolóban áll, valódi sorokon. Itt HAMIS tárolóval dolgozunk, tehát azt NEM
 * lehet megmérni -- azt az `asset-documents-list.integration.spec.ts` méri, a
 * CI adatbázisán.
 *
 * Amit ITT lehet megmérni, az a BEKÖTÉS, és éppen az a hely, ahol egy lista
 * csendben tágabb lesz az adatlapjánál: ha a metódus a HÍVÓ hatóköre helyett
 * `{ kind: "internal" }` értéket adna tovább. Az alak nem elképzelt -- ebben a
 * szolgáltatásban öt írási út SZÁNDÉKOSAN pontosan ezt teszi (`remove`,
 * `setDocumentCaption` és társaik), tehát a másolásra kínálkozó minta ott áll
 * néhány sorral feljebb. Egy ilyen elcsúszás nem hibázik: a partner egyszerűen
 * MINDENT látna.
 */

const DOKUMENTUMOK: AssetDocumentSummary[] = [
  {
    id: "doc-1",
    type: "MANUAL",
    fileName: "kezikonyv.pdf",
    contentType: "application/pdf",
    sizeBytes: 12,
    sha256: "a".repeat(64),
    caption: "A szivattyú kézikönyve",
    createdAt: "2026-09-17T08:00:00.000Z",
  },
  {
    id: "doc-2",
    type: "WARRANTY",
    fileName: "garancia.pdf",
    contentType: "application/pdf",
    sizeBytes: 34,
    sha256: "b".repeat(64),
    caption: null,
    createdAt: "2026-09-16T08:00:00.000Z",
  },
];

const ESZKOZ = {
  id: "asset-1",
  assetNumber: "ESZ-0001",
  qrToken: "550e8400-e29b-41d4-a716-446655440000",
  name: "Fóka felnyomó szivattyú",
  kind: "COMPONENT",
  status: "ACTIVE",
  criticality: "HIGH",
  owner: {
    type: "CUSTOMER",
    id: "customer-1",
    code: "VEVO-1",
    displayName: "Fóka",
  },
  childCount: 0,
  updatedAt: "2026-09-17T08:00:00.000Z",
  ancestors: [],
  children: [],
  events: [],
  documents: DOKUMENTUMOK,
  createdAt: "2026-09-01T08:00:00.000Z",
} satisfies AssetDetail;

/** A hamis tároló, ami elteszi, MILYEN hatókörrel hívták. */
function szolgaltatas(detail: (id: string, scope: PartnerScope) => unknown) {
  const kapott: { id?: string; scope?: PartnerScope } = {};
  const repository = {
    detail: async (id: string, scope: PartnerScope) => {
      kapott.id = id;
      kapott.scope = scope;
      return detail(id, scope);
    },
  } as unknown as ServiceAssetsRepository;
  return {
    kapott,
    service: new ServiceAssetsService(repository, new InMemoryDocumentStore()),
  };
}

const VEVO: PartnerScope = { kind: "customer", customerId: "customer-1" };

describe("egy eszköz csatolmány-listája", () => {
  /**
   * A LÉNYEGI ÁLLÍTÁS. A hívó hatóköre VÁLTOZATLANUL jut el az
   * eszköz-lekéréshez -- se `internal`-ra cserélve, se elhagyva.
   */
  it("a hívó hatóköre változatlanul jut el az eszköz-lekéréshez", async () => {
    const { service, kapott } = szolgaltatas(() => ESZKOZ);
    await service.documents("asset-1", VEVO);

    assert.deepEqual(kapott.scope, VEVO);
    assert.equal(kapott.id, "asset-1");
  });

  /**
   * A BUROK A JEGYÉÉ: `{ items: [...] }`. Egy nyers tömb ugyanúgy "működne",
   * és a két képernyő ugyanarra a galériára két alakot kezelne.
   *
   * ÉS EZ EGYBEN A POZITÍV KONTROLL a lenti 404-es állításhoz: megmutatja,
   * hogy a lista MEG TUDJA találni a csatolmányokat, amikor ott vannak.
   * Nélküle a 404-es állítás egy olyan metódustól is zöld lenne, ami mindig
   * hibát dob.
   */
  it("a válasz burka `{ items: [...] }`, ugyanaz, mint a jegyé", async () => {
    const { service } = szolgaltatas(() => ESZKOZ);
    assert.deepEqual(await service.documents("asset-1", VEVO), {
      items: DOKUMENTUMOK,
    });
  });

  /**
   * A NEM LÁTHATÓ ESZKÖZ 404, NEM ÜRES LISTA.
   *
   * A kettő a kliensen megkülönböztethetetlen: az üres lista azt állítaná,
   * hogy nincs csatolmány -- holott van, csak nem a kérőé. Ugyanez a csapda,
   * amit a kikötés is megnevez: egy üres és egy hatókörből kizárt lista
   * ugyanúgy néz ki.
   */
  it("a nem látható eszköz 404, nem üres lista", async () => {
    const { service } = szolgaltatas(() => null);
    await assert.rejects(
      () => service.documents("asset-1", VEVO),
      /Az eszköz nem található/,
    );
  });
});
