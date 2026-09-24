import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoDate } from "./completion-certificate-content.js";

describe("isoDate", () => {
  it("egy csupasz UTC éjfél előtti bélyegre ugyanazt a napot adja", () => {
    assert.equal(isoDate(new Date("2026-07-28T20:00:00Z")), "2026-07-28");
  });

  /**
   * KALIBRÁCIÓ: A NAPTÁRI NAP BUDAPESTI IDŐ SZERINT ÁLL, NEM UTC SZERINT.
   *
   * A `2026-07-28T22:30:00Z` bélyeg Budapesten (nyári időszámítás, UTC+2)
   * MÁR `2026-07-29` 00:30 -- egy UTC-s olvasás (a korábbi, hibás alak)
   * `2026-07-28`-at adott volna, egy nappal korábbit a valódinál.
   *
   * ÉLŐBEN VISSZAMÉRVE: a korábbi `getUTCFullYear`/`getUTCMonth`/
   * `getUTCDate`-alapú függvényre ez PONTOSAN ez az egy állítás pirosodott
   * ("2026-07-28" jött "2026-07-29" helyett), a többi zöld maradt.
   */
  it("egy UTC éjfél körüli bélyegre a BUDAPESTI naptár szerinti KÖVETKEZŐ napot adja", () => {
    assert.equal(isoDate(new Date("2026-07-28T22:30:00Z")), "2026-07-29");
  });

  /** UGYANEZ TÉLEN (UTC+1), hogy a zóna-eltolás ne csak a nyári esetre álljon. */
  it("télen (UTC+1) is a budapesti naptár szerinti napot adja", () => {
    assert.equal(isoDate(new Date("2026-01-01T23:30:00Z")), "2026-01-02");
  });
});
