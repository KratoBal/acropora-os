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
