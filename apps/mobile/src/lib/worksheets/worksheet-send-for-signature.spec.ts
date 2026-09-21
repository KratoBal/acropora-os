import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  kikuldesAllapotSora,
  kikuldhetoAlairasra,
} from "./worksheet-send-for-signature";

/**
 * A TILTO ESETEK NEV SZERINT ALLNAK ITT, NEM EGY DARABSZAMKENT.
 *
 * Egy keszlet, ami csak a MEGENGEDETT esetet meri, a gomb LETEZESET meri, nem
 * a SZUKITESET -- es akkor is zold lenne, ha a fuggveny mindig `true`-t adna.
 * Ezert minden feltetelhez kulon allitas tartozik, es a kalibracio epp a
 * szukites elhagyasa (nem egy megengedett ag elrontasa).
 */
describe("kikuldhetoAlairasra", () => {
  const kiallitott = {
    status: "AWAITING_SIGNATURE",
    sentForSignatureAt: null,
    worksheetsManage: true,
  };

  it("kiállított lapon, joggal, kiküldés előtt megjelenik", () => {
    assert.equal(kikuldhetoAlairasra(kiallitott), true);
  });

  it("jog nélkül NEM jelenik meg", () => {
    assert.equal(
      kikuldhetoAlairasra({ ...kiallitott, worksheetsManage: false }),
      false,
    );
  });

  it("piszkozaton NEM jelenik meg", () => {
    assert.equal(
      kikuldhetoAlairasra({ ...kiallitott, status: "DRAFT" }),
      false,
    );
  });

  it("már aláírt lapon NEM jelenik meg", () => {
    assert.equal(
      kikuldhetoAlairasra({ ...kiallitott, status: "SIGNED" }),
      false,
    );
  });

  it("elutasított lapon NEM jelenik meg", () => {
    assert.equal(
      kikuldhetoAlairasra({ ...kiallitott, status: "REJECTED" }),
      false,
    );
  });

  it("már kiküldött lapon NEM jelenik meg", () => {
    assert.equal(
      kikuldhetoAlairasra({
        ...kiallitott,
        sentForSignatureAt: "2026-09-21T16:00:00.000Z",
      }),
      false,
    );
  });
});

describe("kikuldesAllapotSora", () => {
  it("kiküldés előtt nincs sor", () => {
    assert.equal(
      kikuldesAllapotSora({
        sentForSignatureAt: null,
        sentForSignatureToName: "Vevő Vilmos",
      }),
      null,
    );
  });

  it("kiküldés után megnevezi a címzettet", () => {
    assert.equal(
      kikuldesAllapotSora({
        sentForSignatureAt: "2026-09-21T16:00:00.000Z",
        sentForSignatureToName: "Vevő Vilmos",
      }),
      "Kiküldve aláírásra: Vevő Vilmos",
    );
  });

  /**
   * EZ AZ ALLITAS A MEZO-ELCSUSZAS ELLEN SZOL, NEM A SZOVEGERT.
   *
   * A cimzett fiokja torolheto, es olyankor a NEV `null`, a DATUM megmarad. Ha
   * a sor a nevre kapuzna, a torles CSENDBEN eltuntetne az egesz allapot-sort,
   * es a lap ugy nezne ki, mintha soha nem kuldtuk volna ki -- vagyis a gomb
   * visszajonne egy mar kint levo lapra.
   */
  it("törölt címzettnél is kiírja, hogy kiment", () => {
    assert.equal(
      kikuldesAllapotSora({
        sentForSignatureAt: "2026-09-21T16:00:00.000Z",
        sentForSignatureToName: null,
      }),
      "Kiküldve aláírásra",
    );
  });
});
