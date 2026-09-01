import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STATES_THAT_CAN_WAIT_FOR_IMAGE,
  waitingFor,
} from "./content-filter.js";

describe("what the default list shows", () => {
  /**
   * A SZERZŐ KÉT ÁLLAPOTBAN VAN SORON: az induló vázlatnál és a visszakörnél.
   * Ha csak a `DRAFTING` szerepelne, a javításra visszaküldött tételek
   * eltűnnének a listájáról -- és pont azok a legrégebben állók.
   */
  it("puts both the first draft and the send-backs on the author's list", () => {
    assert.deepEqual(waitingFor("author").states, [
      "DRAFTING",
      "AWAITING_REVISION",
    ]);
  });

  it("shows a reviewer only what is waiting for review", () => {
    assert.deepEqual(waitingFor("reviewer").states, ["AWAITING_REVIEW"]);
  });

  it("shows an approver only what is waiting for approval", () => {
    assert.deepEqual(waitingFor("approver").states, ["AWAITING_APPROVAL"]);
  });

  /**
   * A JÓVÁHAGYÓ ÉS A KIKÜLDŐ MINDENT LÁT, AMI RÁJUK VÁR, akárki írta. Ez a két
   * szerep nevesített embereké, és az egész felület azért készül, mert ma nem
   * látják, mi vár rájuk -- egy saját-tételekre szűkítés pont ezt hozná vissza.
   *
   * A szerző és a lektor viszont szűkül: az ő listájuk ne teljen meg mások
   * vázlataival.
   */
  it("does not narrow the approver or the sender to their own pieces", () => {
    assert.equal(waitingFor("approver").ownOnly, false);
    assert.equal(waitingFor("sender").ownOnly, false);
    assert.equal(waitingFor("author").ownOnly, true);
    assert.equal(waitingFor("reviewer").ownOnly, true);
  });
});

describe("which pieces can still be waiting for an image", () => {
  /**
   * A KIKÜLDÖTT ÉS AZ ELVETETT KIMARAD, és ez nem részletkérdés: egy
   * kiküldött poszt képe már nem hiányzik, akkor sem, ha a mező üresen maradt.
   * Ha benne lennének, a „képre vár" lista minden régi tétellel megtelne, és
   * három ilyen után senki nem nézné meg.
   */
  it("leaves out what has already gone out or been dropped", () => {
    assert.equal(STATES_THAT_CAN_WAIT_FOR_IMAGE.includes("SENT"), false);
    assert.equal(STATES_THAT_CAN_WAIT_FOR_IMAGE.includes("DISCARDED"), false);
  });

  /**
   * A SCHEDULED BENNE VAN, és ez az az eset, ami elsőre furcsa: egy ütemezett
   * posztnak elvileg már van képe. De a képet a Facebookon is lehet cserélni,
   * és a mi táblánk attól még hiányosnak látszana -- a lista feladata
   * megmutatni, nem eldönteni, hogy baj-e.
   */
  it("still counts a scheduled piece, because ours may be the incomplete one", () => {
    assert.equal(STATES_THAT_CAN_WAIT_FOR_IMAGE.includes("SCHEDULED"), true);
  });
});
