import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handoverMailAuditNote,
  handoverMailDecision,
  type HandoverRecipient,
} from "./handover-mail-recipients.js";

const AKTIV: HandoverRecipient = {
  email: "uzem@partner.hu",
  displayName: "Üzemeltető Ubul",
  isActive: true,
};
const INAKTIV: HandoverRecipient = {
  email: "kilepett@partner.hu",
  displayName: "Kilépett Kázmér",
  isActive: false,
};

const ELO = {
  mode: "live" as const,
  departmentId: "dep-1",
  customerId: "cus-1",
  recipients: [AKTIV],
};

/**
 * MINDEN KIHAGYASI AG KULON ALLITAST KAP, NEV SZERINT.
 *
 * Egy keszlet, ami csak a SIKERES agat meri, a fuggveny LETEZESET meri, nem a
 * szukiteset -- es akkor is zold lenne, ha minden bemenetre `send`-et adna. A
 * kalibracios rontas ezert epp a szukites elhagyasa, nem a sikeres ag
 * elrontasa.
 */
describe("handoverMailDecision", () => {
  it("élő kapunál, helyszínnel és aktív címzettel kimegy", () => {
    const d = handoverMailDecision(ELO);
    assert.equal(d.kind, "send");
    assert.deepEqual(d.kind === "send" ? d.to : null, [
      { email: "uzem@partner.hu", name: "Üzemeltető Ubul" },
    ]);
  });

  it("zárt kapunál NEM megy ki", () => {
    const d = handoverMailDecision({ ...ELO, mode: "off" });
    assert.deepEqual(d, { kind: "skip", reason: "mode-off" });
  });

  /**
   * A KAPU ELOL ALL, ES EZ MERHETO: zart kapunal AKKOR IS `mode-off` az ok, ha
   * a jegyen SEMMI nincs. Enelkul egy zart kapu melletti futas a jegyre
   * mutatna, holott a kornyezeten all.
   */
  it("zárt kapunál a kapu az ok, nem a hiányzó helyszín", () => {
    const d = handoverMailDecision({
      mode: "off",
      departmentId: null,
      customerId: null,
      recipients: [],
    });
    assert.deepEqual(d, { kind: "skip", reason: "mode-off" });
  });

  it("helyszín nélküli jegy NEM megy ki", () => {
    const d = handoverMailDecision({ ...ELO, departmentId: null });
    assert.deepEqual(d, { kind: "skip", reason: "no-department" });
  });

  it("gazdátlan helyszín NEM megy ki", () => {
    const d = handoverMailDecision({ ...ELO, customerId: null });
    assert.deepEqual(d, { kind: "skip", reason: "no-customer" });
  });

  it("üres címzett-listára NEM megy ki", () => {
    const d = handoverMailDecision({ ...ELO, recipients: [] });
    assert.deepEqual(d, { kind: "skip", reason: "no-recipient" });
  });

  /**
   * EZ AZ ALLITAS A "NE KULDJON URES LISTARA" KIKOTES MAGVA.
   *
   * Csupa INAKTIV fiok mellett a lista NEM ures -- a szures utan viszont az. Ha
   * a kapu a NYERS hosszra nezne, ez a bemenet atmenne, es a kuldes egy ures
   * cimzett-mezovel indulna el.
   */
  it("csupa inaktív fióknál NEM megy ki", () => {
    const d = handoverMailDecision({ ...ELO, recipients: [INAKTIV, INAKTIV] });
    assert.deepEqual(d, { kind: "skip", reason: "no-recipient" });
  });

  it("az inaktív fiók kimarad, az aktív megmarad", () => {
    const d = handoverMailDecision({ ...ELO, recipients: [INAKTIV, AKTIV] });
    assert.equal(d.kind, "send");
    assert.deepEqual(d.kind === "send" ? d.to.map((cim) => cim.email) : null, [
      "uzem@partner.hu",
    ]);
  });
});

describe("handoverMailAuditNote", () => {
  /**
   * A NAPLO-SOR CIMET NEM TARTALMAZ, es ez nem szohasznalat.
   *
   * A jegy naploja ATMEGY a partner portalra (fb945858 merese): a
   * `/service/jobs/{id}` valasza szo szerint ugyanaz a partnernek es a belsos
   * felhasznalonak. Egy cim, ami egyszer bekerul egy naplo szovegebe, onnantol
   * minden jovobeli feluletnel egyutt utazik.
   */
  it("a kiküldés sora nem tartalmaz címet", () => {
    const sor = handoverMailAuditNote({
      kind: "send",
      to: [
        { email: "uzem@partner.hu", name: "Üzemeltető Ubul" },
        { email: "masik@partner.hu", name: "Másik Mária" },
      ],
    });
    assert.doesNotMatch(sor, /@/);
    assert.match(sor, /2 címzettnek/);
  });

  it("a kihagyás sora megnevezi az okot", () => {
    assert.match(
      handoverMailAuditNote({ kind: "skip", reason: "no-recipient" }),
      /no-recipient/,
    );
  });
});
