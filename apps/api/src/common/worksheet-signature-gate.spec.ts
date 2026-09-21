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
    /**
     * AZ ALAPERTELMEZES "MAR ATADVA", ES EZ SZANDEKOS.
     *
     * Igy a REGI, alairasrol szolo allitasok tovabbra is CSAK az alairast
     * merik: ha az alapertelmezes `false` lenne, mindegyik ket okbol
     * blokkolna, es egy elrontott alairas-szabaly melle is odaallna egy masik
     * ok, ami zolden tartana oket.
     */
    handedOver: true,
    ...reszek,
  };
}

/** Rovidites: a cel-allapot alapbol a lezaras. */
function kapu(
  lapok: TicketWorksheetSignatureState[],
  to: "COMPLETED" | "CANCELLED" = "COMPLETED",
) {
  return worksheetsBlockingTicketClose({ worksheets: lapok, to });
}

describe("a hibajegy lezarasi kapuja", () => {
  it("munkalap nelkul nincs mi visszatartsa (Balazs 3. szabalya)", () => {
    assert.deepEqual(kapu([]), []);
  });

  it("alairt lap nem tartja vissza", () => {
    assert.deepEqual(kapu([lap({ currentVersionStatus: "SIGNED" })]), []);
  });

  it("alairasra varo lap visszatartja", () => {
    const blokkolo = kapu([
      lap({ currentVersionStatus: "AWAITING_SIGNATURE" }),
    ]);
    assert.equal(blokkolo.length, 1);
    assert.equal(blokkolo[0]?.sheet.number, "MUNKA-2026-001");
  });

  it("piszkozat visszatartja", () => {
    assert.equal(kapu([lap({ currentVersionStatus: "DRAFT" })]).length, 1);
  });

  /**
   * AZ ELUTASITAS NEM ALAIRAS, es ezert all kulon allitas ra. A `REJECTED` egy
   * MEGSZULETETT dontes -- aki a kaput "van-e dontes" alakban irna meg, ezt
   * atengedne, es egy visszautasitott lap folott lehetne lezarni a jegyet.
   */
  it("elutasitott lap visszatartja", () => {
    assert.equal(kapu([lap({ currentVersionStatus: "REJECTED" })]).length, 1);
  });

  it("verzio nelkuli lap visszatartja", () => {
    assert.equal(kapu([lap({ currentVersionStatus: null })]).length, 1);
  });

  /**
   * A DONTES, AMIT KULON MERUNK: a rejtes NEM mentesit. Enelkul egy alairatlan
   * lap elrejtesevel csendben lezarhato lenne a jegy.
   */
  it("a REJTETT alairatlan lap is visszatartja", () => {
    const blokkolo = kapu([
      lap({ currentVersionStatus: "DRAFT", hidden: true }),
    ]);
    assert.equal(blokkolo.length, 1);
    assert.equal(blokkolo[0]?.sheet.hidden, true);
  });

  /**
   * A LEGKOZELEBBI TEVESZTES, AMI MEGIS HELYES: rejtett, DE alairt lap. Ha a
   * kapu "a rejtett lap gyanus" alakban keszulne, ez a sor pirosodna -- es a
   * kapu olyat tartana vissza, amirol a dontes mar megszuletett.
   */
  it("a rejtett DE alairt lap nem tartja vissza", () => {
    assert.deepEqual(
      kapu([lap({ currentVersionStatus: "SIGNED", hidden: true })]),
      [],
    );
  });

  it("tobb lapbol csak az alairatlanokat adja vissza, sorrendben", () => {
    const blokkolo = kapu([
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
      blokkolo.map((sor) => sor.sheet.id),
      ["b", "c"],
    );
  });
});

describe("az atadas feltetele", () => {
  /**
   * ISMERT POZITIV KONTROLL, ES ITT KETSZERESEN KELL.
   *
   * A lenti allitasok tobbsege azt meri, hogy valami VISSZATART. Egy olyan
   * szabaly, ami MINDIG visszatart, mindet kielegitene -- ezert all elol az,
   * hogy a keszre jelolt lap MIND A KET cel-allapotnal atmegy.
   */
  it("alairt ES atadottkent jelolt lap egyik lepest sem tartja vissza", () => {
    assert.deepEqual(kapu([lap()]), []);
    assert.deepEqual(kapu([lap()], "CANCELLED"), []);
  });

  it("a jeloletlen lap a lezarast visszatartja, alairva is", () => {
    const blokkolo = kapu([
      lap({ currentVersionStatus: "SIGNED", handedOver: false }),
    ]);
    assert.equal(blokkolo.length, 1);
    assert.deepEqual(blokkolo[0]?.reasons, ["not-handed-over"]);
  });

  /**
   * A KET HATOKOR KULONBSEGE, NEV SZERINT MERVE -- EZ A KARTYA DONTESE.
   *
   * Nem eleg, hogy a CANCELLED-en "tortenik valami": azt kell megmutatni,
   * hogy MELYIK feltetel all ott es melyik nem. Egy darabszam-allitas ezt a
   * ket esetet nem kulonboztetne meg.
   */
  it("elallaskor az ALAIRAS nem szamit, az ATADAS igen", () => {
    const csakAlairatlan = kapu(
      [lap({ currentVersionStatus: "DRAFT", handedOver: true })],
      "CANCELLED",
    );
    assert.deepEqual(csakAlairatlan, [], "elallaskor az alairas nem feltetel");

    const jeloletlen = kapu(
      [lap({ currentVersionStatus: "DRAFT", handedOver: false })],
      "CANCELLED",
    );
    assert.equal(jeloletlen.length, 1);
    assert.deepEqual(
      jeloletlen[0]?.reasons,
      ["not-handed-over"],
      "elallaskor CSAK az atadas hianya lehet ok",
    );
  });

  /**
   * EGY LAP KET OKKAL. Ez az az eset, amiert a visszateres okokat is ad, nem
   * csak lapokat: ha a hivo csak az elsot mondana el, a kezelo megjavitana,
   * visszajonne, es a masodikon allna meg.
   */
  it("lezaraskor egy lapon MIND A KET ok megjelenhet, ebben a sorrendben", () => {
    const blokkolo = kapu([
      lap({ currentVersionStatus: "DRAFT", handedOver: false }),
    ]);
    assert.equal(blokkolo.length, 1);
    assert.deepEqual(blokkolo[0]?.reasons, ["unsigned", "not-handed-over"]);
  });

  it("a REJTETT, jeloletlen lap is visszatartja", () => {
    const blokkolo = kapu([lap({ hidden: true, handedOver: false })]);
    assert.equal(blokkolo.length, 1);
    assert.equal(blokkolo[0]?.sheet.hidden, true);
  });

  /**
   * A LAPOK KULON-KULON KAPJAK AZ OKAIKAT, nem egy kozos halmazt. Egy
   * megvalositas, ami a jegy OSSZES okat minden lapra raterhelne, atmenne egy
   * puszta darabszam-allitason.
   */
  it("ket lap ket kulonbozo okkal, nem osszemosva", () => {
    const blokkolo = kapu([
      lap({ id: "a", currentVersionStatus: "DRAFT", handedOver: true }),
      lap({ id: "b", currentVersionStatus: "SIGNED", handedOver: false }),
    ]);
    assert.deepEqual(
      blokkolo.map((sor) => [sor.sheet.id, sor.reasons]),
      [
        ["a", ["unsigned"]],
        ["b", ["not-handed-over"]],
      ],
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
