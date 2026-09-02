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

describe("serviceJobTimeline", () => {
  it("a három forrást egy sorba fésüli, legújabb felül", () => {
    const timeline = serviceJobTimeline({
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
    };

    const elso = serviceJobTimeline(input).map((entry) => entry.sortKey);
    const masodik = serviceJobTimeline(input).map((entry) => entry.sortKey);

    assert.deepEqual(elso, masodik);
    assert.deepEqual(elso, ["a1", "e1", "e2", "w1"]);
  });

  it("üres jegyen üres naplót ad, nem hibázik", () => {
    assert.deepEqual(
      serviceJobTimeline({ events: [], worksheets: [], assets: [] }),
      [],
    );
  });
});
