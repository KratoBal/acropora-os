import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  serviceJobTimeline,
  type ServiceJobAssetLink,
  type ServiceJobStatusEvent,
  type ServiceJobWorksheetLink,
} from "./service-job-management.js";

function event(
  id: string,
  createdAt: string,
  extra: Partial<ServiceJobStatusEvent> = {},
): ServiceJobStatusEvent {
  return {
    id,
    fromStatus: "NEW",
    toStatus: "TRIAGED",
    note: null,
    actorName: null,
    createdAt,
    ...extra,
  };
}

function worksheet(id: string, createdAt: string): ServiceJobWorksheetLink {
  return { id, number: null, createdAt, handedOverAt: null };
}

function asset(id: string, attachedAt: string): ServiceJobAssetLink {
  return {
    id,
    assetId: `asset-${id}`,
    assetNumber: "ESZ-1",
    assetName: "Szivattyú",
    attachedAt,
  };
}

function removal(id: string, removedAt: string) {
  return {
    id,
    fileName: "szivattyu.jpg",
    actorName: "Kiss Eszter",
    removedAt,
  };
}

describe("serviceJobTimeline", () => {
  it("a három forrást egy sorba fésüli, legújabb felül", () => {
    const timeline = serviceJobTimeline({
      documentRemovals: [],
      events: [event("e1", "2026-09-01T08:00:00.000Z")],
      worksheets: [worksheet("w1", "2026-09-03T08:00:00.000Z")],
      assets: [asset("a1", "2026-09-02T08:00:00.000Z")],
    });

    assert.deepEqual(
      timeline.map((entry) => entry.kind),
      ["worksheet", "asset", "status"],
    );
  });

  /**
   * EZ AZ ÁLLÍTÁS A RENDEZÉST MÉRI, NEM A MEGLÉTET.
   *
   * A bemenet szándékosan MÁR időrendben érkezik forrásonként, de a három
   * forrás egymáshoz képest keverve: egy egyszerű összefűzés (a rendezés
   * elhagyása) itt `status, status, worksheet` sorrendet adna, tehát ez az
   * állítás pirosodik ki, ha a szabály elveszik.
   */
  it("a forrásokon ÁTMENŐ időrendet tartja, nem a forrásonkéntit", () => {
    const timeline = serviceJobTimeline({
      documentRemovals: [],
      events: [
        event("e-regi", "2026-09-01T08:00:00.000Z"),
        event("e-uj", "2026-09-05T08:00:00.000Z"),
      ],
      worksheets: [worksheet("w-kozepso", "2026-09-03T08:00:00.000Z")],
      assets: [],
    });

    assert.deepEqual(
      timeline.map((entry) => entry.sortKey),
      ["e-uj", "w-kozepso", "e-regi"],
    );
  });

  /**
   * AZONOS IDŐBÉLYEG NEM RITKA: a jegy keletkezésekor a naplósor és a
   * csatolások egy tranzakcióban születnek. Determinált másodlagos kulcs nélkül
   * ugyanaz a jegy két lekérdezésen más sorrendben jönne vissza.
   */
  it("azonos időbélyegnél is ugyanazt a sorrendet adja, kétszer futtatva", () => {
    const azonos = "2026-09-02T08:00:00.000Z";
    const input = {
      events: [event("e2", azonos), event("e1", azonos)],
      worksheets: [worksheet("w1", azonos)],
      assets: [asset("a1", azonos)],
      documentRemovals: [],
    };

    const elso = serviceJobTimeline(input).map((entry) => entry.sortKey);
    const masodik = serviceJobTimeline(input).map((entry) => entry.sortKey);

    assert.deepEqual(elso, masodik);
    assert.deepEqual(elso, ["a1", "e1", "e2", "w1"]);
  });

  it("üres jegyen üres naplót ad, nem hibázik", () => {
    assert.deepEqual(
      serviceJobTimeline({
        events: [],
        worksheets: [],
        assets: [],
        documentRemovals: [],
      }),
      [],
    );
  });

  /**
   * A NEGYEDIK FORRÁS UGYANABBA AZ IDŐRENDBE ÁLL BE, nem a lista végére.
   *
   * A törlés a jegy életének egy PILLANATA, és a napló épp arról szól, mi mikor
   * történt. Egy külön listába tett törlés-sor ugyanolyan igaz lenne, és a
   * kérdésre („mi történt ezzel a jeggyel") nem válaszolna.
   *
   * A FIXTÚRA ÚGY VAN IDŐZÍTVE, HOGY A TÖRLÉS KÖZÉPRE ESSEN: ha az összefésülés
   * a lista végére fűzné (rendezés nélkül), ez az állítás pirosodik. Egy olyan
   * minta, ahol a törlés amúgy is a legújabb, nem tudna elbukni.
   */
  it("a törölt csatolmány beáll az időrendbe, nem a lista végére", () => {
    const timeline = serviceJobTimeline({
      events: [event("e-regi", "2026-09-01T08:00:00.000Z")],
      worksheets: [worksheet("w-uj", "2026-09-05T08:00:00.000Z")],
      assets: [],
      documentRemovals: [removal("d-kozepso", "2026-09-03T08:00:00.000Z")],
    });

    assert.deepEqual(
      timeline.map((entry) => entry.kind),
      ["worksheet", "document", "status"],
    );
  });

  /**
   * ÉS A SOR VISZI A FÁJLNEVET ÉS A TÖRLŐT - mert a dokumentum sora addigra
   * NINCS MEG. Ha az összefésülés csak az időbélyeget vinné át, a napló azt
   * mondaná, hogy „történt valami", és épp azt nem, hogy MI tűnt el.
   */
  it("a törölt csatolmány sora viszi a fájlnevet és a törlőt", () => {
    const [entry] = serviceJobTimeline({
      events: [],
      worksheets: [],
      assets: [],
      documentRemovals: [removal("d1", "2026-09-03T08:00:00.000Z")],
    });

    assert.equal(entry?.kind, "document");
    if (entry?.kind !== "document") return;
    assert.equal(entry.removal.fileName, "szivattyu.jpg");
    assert.equal(entry.removal.actorName, "Kiss Eszter");
  });
});
