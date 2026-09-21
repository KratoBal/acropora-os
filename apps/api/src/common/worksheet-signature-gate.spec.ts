import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mayWorksheetBeSigned,
  worksheetsBlockingTicketClose,
  type TicketWorksheetSignatureState,
} from "./worksheet-signature-gate.js";

/**
 * A KESZLET A TILTOTT ESETEKRE IS ALLIT, NEV SZERINT.
 *
 * Egy keszlet, ami csak a megengedett iranyokat meri, a kapu LETEZESET meri, nem
 * a SZUKITESET -- es egy mindent atengedo valtozaton is zold maradna. A kapu
 * erteke pontosan az, amit NEM enged at.
 */

function lap(
  reszek: Partial<TicketWorksheetSignatureState> = {},
): TicketWorksheetSignatureState {
  return {
    id: "ws-1",
    number: "MUNKA-2026-001",
    currentVersionStatus: "SIGNED",
    hidden: false,
    ...reszek,
  };
}

describe("a hibajegy lezarasi kapuja", () => {
  it("munkalap nelkul nincs mi visszatartsa (Balazs 3. szabalya)", () => {
    assert.deepEqual(worksheetsBlockingTicketClose([]), []);
  });

  it("alairt lap nem tartja vissza", () => {
    assert.deepEqual(
      worksheetsBlockingTicketClose([lap({ currentVersionStatus: "SIGNED" })]),
      [],
    );
  });

  it("alairasra varo lap visszatartja", () => {
    const blokkolo = worksheetsBlockingTicketClose([
      lap({ currentVersionStatus: "AWAITING_SIGNATURE" }),
    ]);
    assert.equal(blokkolo.length, 1);
    assert.equal(blokkolo[0]?.number, "MUNKA-2026-001");
  });

  it("piszkozat visszatartja", () => {
    assert.equal(
      worksheetsBlockingTicketClose([lap({ currentVersionStatus: "DRAFT" })])
        .length,
      1,
    );
  });

  /**
   * AZ ELUTASITAS NEM ALAIRAS, es ezert all kulon allitas ra. A `REJECTED` egy
   * MEGSZULETETT dontes -- aki a kaput "van-e dontes" alakban irna meg, ezt
   * atengedne, es egy visszautasitott lap folott lehetne lezarni a jegyet.
   */
  it("elutasitott lap visszatartja", () => {
    assert.equal(
      worksheetsBlockingTicketClose([lap({ currentVersionStatus: "REJECTED" })])
        .length,
      1,
    );
  });

  it("verzio nelkuli lap visszatartja", () => {
    assert.equal(
      worksheetsBlockingTicketClose([lap({ currentVersionStatus: null })])
        .length,
      1,
    );
  });

  /**
   * A DONTES, AMIT KULON MERUNK: a rejtes NEM mentesit. Enelkul egy alairatlan
   * lap elrejtesevel csendben lezarhato lenne a jegy.
   */
  it("a REJTETT alairatlan lap is visszatartja", () => {
    const blokkolo = worksheetsBlockingTicketClose([
      lap({ currentVersionStatus: "DRAFT", hidden: true }),
    ]);
    assert.equal(blokkolo.length, 1);
    assert.equal(blokkolo[0]?.hidden, true);
  });

  /**
   * A LEGKOZELEBBI TEVESZTES, AMI MEGIS HELYES: rejtett, DE alairt lap. Ha a
   * kapu "a rejtett lap gyanus" alakban keszulne, ez a sor pirosodna -- es a
   * kapu olyat tartana vissza, amirol a dontes mar megszuletett.
   */
  it("a rejtett DE alairt lap nem tartja vissza", () => {
    assert.deepEqual(
      worksheetsBlockingTicketClose([
        lap({ currentVersionStatus: "SIGNED", hidden: true }),
      ]),
      [],
    );
  });

  it("tobb lapbol csak az alairatlanokat adja vissza, sorrendben", () => {
    const blokkolo = worksheetsBlockingTicketClose([
      lap({
        id: "a",
        number: "MUNKA-2026-001",
        currentVersionStatus: "SIGNED",
      }),
      lap({ id: "b", number: "MUNKA-2026-002", currentVersionStatus: "DRAFT" }),
      lap({
        id: "c",
        number: null,
        currentVersionStatus: "AWAITING_SIGNATURE",
      }),
    ]);
    assert.deepEqual(
      blokkolo.map((sor) => sor.id),
      ["b", "c"],
    );
  });
});

describe("a munkalap alairasi kapuja", () => {
  it("hibajegy nelkul nem irhato ala (Balazs 5. szabalya)", () => {
    assert.deepEqual(mayWorksheetBeSigned({ serviceJobId: null }), {
      ok: false,
      reason: "no-ticket",
    });
  });

  it("hibajeggyel alairhato", () => {
    assert.deepEqual(mayWorksheetBeSigned({ serviceJobId: "job-1" }), {
      ok: true,
    });
  });
});
