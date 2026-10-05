import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CAPASULI_ITEM_CLASSES,
  CapasuliItemBlocked,
  buildCapasuliItemRequest,
  capasuliFilterEnabled,
  maskEmails,
} from "./capasuli-item.js";

/**
 * A CÁPASULI TÉTEL KÉRÉSE (Balázs, 2026-10-05, acrobot emlék 2069): csak az
 * e-mail-cím maszkolódik, a név marad. MI PIROSÍT: ha egy cím kimegy; ha a név
 * vagy a hiba szövege eltűnik; ha a kapcsoló a `live` szón kívül is bekapcsol.
 * Kitalált nevek és címek.
 */
describe("a Cápasuli tétel kérése", () => {
  it("az e-mail-cím maszkolódik, a név és a hiba szövege marad", () => {
    const request = buildCapasuliItemRequest(
      "Kovács Péter jelezte (kovacs.peter@zoobudapest.com): a bioszűrő felnyomó motorja leesett.",
    );
    const message = request.state.message!;
    assert.doesNotMatch(message, /@/);
    assert.match(message, /\[EMAIL\]/);
    assert.match(message, /Kovács Péter/);
    assert.match(message, /bioszűrő felnyomó motorja leesett/);
    assert.equal(request.maskedEmails, 1);
    assert.deepEqual(Object.keys(request.criteria), [
      "OUR_TECHNICAL_FAULT",
      "NOT_OURS",
      "NOT_A_FAULT",
    ]);
  });

  it("több cím, nagybetűs domainnel is", () => {
    const masked = maskEmails("a@b.hu, ANNA.Kiss@Zoo.HU es x.y@pelda.com");
    assert.equal(masked.count, 3);
    assert.doesNotMatch(masked.text, /@/);
  });

  it("üres tétel nem megy ki", () => {
    assert.throws(
      () => buildCapasuliItemRequest("   "),
      (error) =>
        error instanceof CapasuliItemBlocked &&
        error.outcome === "blocked_empty",
    );
  });

  it("a kapcsoló csak a live szóra kapcsol", () => {
    assert.equal(capasuliFilterEnabled("live"), true);
    assert.equal(capasuliFilterEnabled(" live "), true);
    for (const value of [undefined, "", "on", "true", "LIVE", "shadow"])
      assert.equal(capasuliFilterEnabled(value), false);
  });

  it("a három osztálynak van leírása", () => {
    for (const text of Object.values(CAPASULI_ITEM_CLASSES))
      assert.ok(text.length > 40);
  });
});
