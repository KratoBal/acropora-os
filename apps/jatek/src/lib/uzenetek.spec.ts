import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BEKULDES_RENDBEN,
  MAR_MEGEROSITVE,
  MEGEROSITVE,
  NEM_ELERHETO,
  bekuldesHiba,
  megerositesHiba,
} from "./uzenetek.js";

/*
  WHAT TURNS THIS RED. A sentence that says whether the answer was right or whether the address has played before
  (the page must not give either away); a known code falling back to the api's sentence; a gateway's HTML error
  page, or a long or multi-line text, reaching the visitor.
*/
describe("az oldal mondatai", () => {
  it("the accepted-submission sentence is the contract's, and says nothing about the answer or an earlier play", () => {
    assert.equal(
      BEKULDES_RENDBEN,
      "Küldtünk egy levelet, a benne lévő linkkel lesz érvényes a játékod.",
    );
    for (const mondat of [BEKULDES_RENDBEN, MEGEROSITVE, MAR_MEGEROSITVE])
      assert.doesNotMatch(
        mondat,
        /helyes|rossz|hibás|jó válasz|már játszott|korábban/i,
      );
  });

  it("a known submission code is the page's own sentence, whatever the api wrote", () => {
    for (const code of [
      "INVALID_EMAIL",
      "INVALID_ANSWER",
      "NO_QUESTION",
      "CLOSED",
      "TOO_MANY",
    ]) {
      const sajat = bekuldesHiba(code);
      assert.notEqual(sajat, NEM_ELERHETO, code);
      assert.equal(bekuldesHiba(code, "Az api mondata."), sajat, code);
    }
  });

  it("a known confirmation code is the page's own sentence too", () => {
    for (const code of ["INVALID_TOKEN", "CLOSED", "TOO_MANY"]) {
      const sajat = megerositesHiba(code);
      assert.notEqual(sajat, NEM_ELERHETO, code);
      assert.equal(megerositesHiba(code, "Az api mondata."), sajat, code);
    }
  });

  it("an unknown code shows the api's short one-line sentence, otherwise 'not available'", () => {
    assert.equal(
      bekuldesHiba("UJ_KOD", "Rövid magyar mondat."),
      "Rövid magyar mondat.",
    );
    assert.equal(bekuldesHiba("UJ_KOD"), NEM_ELERHETO);
    assert.equal(
      bekuldesHiba("UJ_KOD", "<html>502 Bad Gateway</html>"),
      NEM_ELERHETO,
    );
    assert.equal(bekuldesHiba("UJ_KOD", "x".repeat(201)), NEM_ELERHETO);
    assert.equal(bekuldesHiba("UJ_KOD", "két\nsor"), NEM_ELERHETO);
    assert.equal(megerositesHiba("UNAVAILABLE", ""), NEM_ELERHETO);
  });
});
