import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import { scopeMaySeeAssetEvent } from "./service-assets.repository.js";

const partner: PartnerScope = { kind: "customer", customerId: "c1" };
const internal: PartnerScope = { kind: "internal" };

describe("scopeMaySeeAssetEvent", () => {
  it("belsős kérőnek minden esemény látszik", () => {
    for (const type of ["DOCUMENT_UPLOADED", "DOCUMENT_DELETED", "CREATED"]) {
      assert.equal(
        scopeMaySeeAssetEvent(
          { type, payload: { documentType: "INVOICE" } },
          internal,
        ),
        true,
      );
    }
  });

  it("a nem dokumentumos eseményt nem érinti a szabály", () => {
    assert.equal(
      scopeMaySeeAssetEvent({ type: "CREATED", payload: {} }, partner),
      true,
    );
    assert.equal(
      scopeMaySeeAssetEvent({ type: "QR_ROTATED", payload: null }, partner),
      true,
    );
    // A ma tenylegesen irt payloadok a masik hat tipuson.
    assert.equal(
      scopeMaySeeAssetEvent(
        { type: "STATUS_CHANGED", payload: { from: "ACTIVE", to: "RETIRED" } },
        partner,
      ),
      true,
    );
    assert.equal(
      scopeMaySeeAssetEvent(
        { type: "UPDATED", payload: { fields: ["name"] } },
        partner,
      ),
      true,
    );
  });

  /**
   * A KONTROLL A KILENCEDIK TIPUSRA, es ez az egyetlen allitas, ami MA
   * kulonbseget tesz a ket lehetseges szabaly kozott.
   *
   * Ha a szures az esemeny TIPUSARA lenne kotve (egy lista a mai ket
   * dokumentum-esemenyrol), akkor egy KESOBB felvett tipus, ami fajlnevet ir a
   * payloadba, csendben atmenne rajta -- es senki nem tudna, hogy ide vissza
   * kellett volna jonnie. A szabaly ezert a payload ALAKJARA szol.
   *
   * Ez a teszt tehat nem a mai viselkedest irja le, hanem azt a napot vedi,
   * amikor valaki uj esemenyt vezet be. Murena vetette fel, 2026-08-31.
   */
  it("egy ISMERETLEN típusú esemény is a szabály alá esik, ha dokumentumot nevez meg", () => {
    const future = {
      type: "DOCUMENT_ARCHIVED",
      payload: { documentId: "d1", fileName: "szamla.pdf" },
    };
    assert.equal(scopeMaySeeAssetEvent(future, partner), false);
    assert.equal(scopeMaySeeAssetEvent(future, internal), true);

    // Es ha a tipust IS hordozza, a tablazat donti el, nem a tipus neve.
    assert.equal(
      scopeMaySeeAssetEvent(
        {
          type: "DOCUMENT_ARCHIVED",
          payload: { documentType: "WARRANTY", fileName: "garancia.pdf" },
        },
        partner,
      ),
      true,
    );
    assert.equal(
      scopeMaySeeAssetEvent(
        {
          type: "DOCUMENT_ARCHIVED",
          payload: { documentType: "INVOICE", fileName: "szamla.pdf" },
        },
        partner,
      ),
      false,
    );
  });

  /**
   * A LENYEG: a dokumentum-esemeny ugyanazt a tablazatot koveti, mint maga a
   * dokumentum. Ha a ketto elvalna, a szamla neve az esemenynaplon menne ki.
   */
  it("a dokumentum-esemény a dokumentum szabályát követi", () => {
    assert.equal(
      scopeMaySeeAssetEvent(
        { type: "DOCUMENT_UPLOADED", payload: { documentType: "INVOICE" } },
        partner,
      ),
      false,
    );
    assert.equal(
      scopeMaySeeAssetEvent(
        { type: "DOCUMENT_DELETED", payload: { documentType: "INVOICE" } },
        partner,
      ),
      false,
    );
    assert.equal(
      scopeMaySeeAssetEvent(
        { type: "DOCUMENT_UPLOADED", payload: { documentType: "WARRANTY" } },
        partner,
      ),
      true,
    );
    assert.equal(
      scopeMaySeeAssetEvent(
        { type: "DOCUMENT_UPLOADED", payload: { documentType: "MANUAL" } },
        partner,
      ),
      true,
    );
    assert.equal(
      scopeMaySeeAssetEvent(
        { type: "DOCUMENT_UPLOADED", payload: { documentType: "OTHER" } },
        partner,
      ),
      false,
    );
  });

  /**
   * A FEL NEM ISMERT PAYLOAD PARTNERNEL REJTVE MARAD, es ez DONTES, nem
   * melléktermek. Egy regi vagy hianyos esemenysornal nem tudjuk, melyik
   * tipusrol szol -- az atengedese pont annal a sornal adna hozzaferest,
   * amirol a legkevesebbet tudjuk.
   */
  it("az ismeretlen vagy hiányzó dokumentum-típus partnernél REJTVE marad", () => {
    for (const payload of [
      {},
      null,
      undefined,
      [],
      "INVOICE",
      { documentType: "SOMETHING_NEW" },
      { documentType: 42 },
    ]) {
      assert.equal(
        scopeMaySeeAssetEvent({ type: "DOCUMENT_UPLOADED", payload }, partner),
        false,
      );
    }
  });
});
