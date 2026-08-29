import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatDateTime,
  formatMoney,
  orderStatusPresentation,
} from "./presentation";

describe("orderStatusPresentation", () => {
  it("gives a physical UNAS deletion precedence over every status", () => {
    assert.deepEqual(
      orderStatusPresentation({
        status: "COMPLETED",
        unasStatusLabel: "Megrendelés lezárva",
        unasDeletedAt: "2026-08-09T10:00:00.000Z",
      }),
      { label: "Törölve a UNAS-ban", tone: "danger" },
    );
  });

  it("uses the UNAS label when one is available", () => {
    assert.deepEqual(
      orderStatusPresentation({
        status: "PICKING",
        unasStatusLabel: "Összekészítés",
        unasDeletedAt: null,
      }),
      { label: "Összekészítés", tone: "neutral" },
    );
  });
});

describe("order formatting", () => {
  it("formats valid currency values and safely falls back for invalid input", () => {
    assert.match(formatMoney("1234", "HUF"), /1[\s\u00a0]?234/);
    assert.equal(formatMoney("unknown", "HUF"), "unknown HUF");
  });

  it("does not render an invalid date", () => {
    assert.equal(formatDateTime("not-a-date"), "—");
  });
});

/**
 * A címketábla két védelme, és hogy MIÉRT KETTŐ.
 *
 * A típus fordítási időben véd: a `CANCELLED` és a `COMPLETED` ág tartalék nélkül
 * olvas ki egy kulcsot, és a `Record<string, string>` alatt ez csendben
 * `undefined`-ot adhatott volna. A `labelFor`-ág futásidőben véd: a státusz a
 * szerver adata, tehát megjelenhet olyan kód, amit ez a tábla nem ismer.
 *
 * A második teszt azért van itt, mert a típusjavítás után a `?? order.status`
 * feleslegesnek LÁTSZIK. Nem az -- és aki kiveszi, ezen a teszten fog elhasalni.
 */
describe("a státuszcímke két védelme", () => {
  it("ismert státuszra a magyar címkét adja, tartalék nélkül is", () => {
    const cancelled = orderStatusPresentation({
      status: "CANCELLED",
      unasStatusLabel: null,
      unasDeletedAt: null,
    });
    const completed = orderStatusPresentation({
      status: "COMPLETED",
      unasStatusLabel: null,
      unasDeletedAt: null,
    });

    assert.equal(cancelled.label, "Törölve");
    assert.equal(completed.label, "Lezárva");
  });

  it("ISMERETLEN státuszra a nyers kódot mutatja, nem üres mezőt", () => {
    const presentation = orderStatusPresentation({
      status: "AWAITING_PAYMENT",
      unasStatusLabel: null,
      unasDeletedAt: null,
    });

    assert.equal(presentation.label, "AWAITING_PAYMENT");
    assert.notEqual(presentation.label, "");
    assert.equal(presentation.tone, "neutral");
  });
});
