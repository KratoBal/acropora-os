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
   * A BEAGYAZOTT DOKUMENTUM-MEZO, ES AMIERT NEM KOMMENT ALL A HELYEN.
   *
   * A javaslat az volt, hogy egy komment jelolje: a szabaly LAPOS payloadot
   * var. A premissza nem all -- a `PLACEMENT_CHANGED` MA IS beagyaz `from` es
   * `to` objektumot --, tehat az a komment mar a leirasakor hamis lenne. A
   * vizsgalat ezert MELY, es ez a teszt az, ami sekelyre visszaallitva PIROS.
   */
  it("a BEÁGYAZOTT dokumentum-mező is a szabály alá esik", () => {
    const nested = {
      type: "DOCUMENT_ARCHIVED",
      payload: { document: { fileName: "szamla.pdf" } },
    };
    assert.equal(scopeMaySeeAssetEvent(nested, partner), false);
    assert.equal(scopeMaySeeAssetEvent(nested, internal), true);

    // Tombben is, mert egy esemeny tobb dokumentumrol is szolhat.
    assert.equal(
      scopeMaySeeAssetEvent(
        { type: "BATCH", payload: { items: [{ documentId: "d1" }] } },
        partner,
      ),
      false,
    );

    // ES A KONTROLL A MASIK IRANYBA: a ma VALODI beagyazott payload, a
    // `PLACEMENT_CHANGED` alakja, tovabbra is latszik. A mely bejaras nem
    // "minden beagyazott payloadot elrejt", hanem a dokumentum-mezot keresi.
    assert.equal(
      scopeMaySeeAssetEvent(
        {
          type: "PLACEMENT_CHANGED",
          payload: {
            from: { customerId: "c1", supplierId: null, aquariumId: null },
            to: { customerId: "c2", supplierId: null, aquariumId: null },
          },
        },
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
