import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  maintenanceMailAuditNote,
  maintenanceMailDecision,
  type MaintenanceMailRecipient,
} from "./maintenance-mail-recipients.js";

const AKTIV: MaintenanceMailRecipient = {
  email: "uzem@partner.hu",
  displayName: "Üzemeltető Ubul",
  isActive: true,
};
const INAKTIV: MaintenanceMailRecipient = {
  email: "kilepett@partner.hu",
  displayName: "Kilépett Kázmér",
  isActive: false,
};

const ELO = {
  mode: "live" as const,
  pathMode: "live" as const,
  redirect: { kind: "off" } as const,
  customerId: "cus-1",
  recipients: [AKTIV],
};

describe("maintenanceMailDecision", () => {
  it("élő kapunál, vevővel és aktív címzettel kimegy", () => {
    const d = maintenanceMailDecision(ELO);
    assert.equal(d.kind, "send");
    assert.deepEqual(d.kind === "send" ? d.to : null, [
      { email: "uzem@partner.hu", name: "Üzemeltető Ubul" },
    ]);
  });

  it("zárt kapunál NEM megy ki", () => {
    const d = maintenanceMailDecision({ ...ELO, mode: "off" });
    assert.deepEqual(d, { kind: "skip", reason: "mail-off" });
  });

  it("zárt kapunál a kapu az ok, nem a hiányzó vevő", () => {
    const d = maintenanceMailDecision({
      mode: "off",
      pathMode: "live",
      redirect: { kind: "off" } as const,
      customerId: null,
      recipients: [],
    });
    assert.deepEqual(d, { kind: "skip", reason: "mail-off" });
  });

  it("vevő nélküli karbantartási lap NEM megy ki", () => {
    const d = maintenanceMailDecision({ ...ELO, customerId: null });
    assert.deepEqual(d, { kind: "skip", reason: "no-customer" });
  });

  it("üres címzett-listára NEM megy ki", () => {
    const d = maintenanceMailDecision({ ...ELO, recipients: [] });
    assert.deepEqual(d, { kind: "skip", reason: "no-recipient" });
  });

  it("csupa inaktív fióknál NEM megy ki", () => {
    const d = maintenanceMailDecision({
      ...ELO,
      recipients: [INAKTIV, INAKTIV],
    });
    assert.deepEqual(d, { kind: "skip", reason: "no-recipient" });
  });

  it("az inaktív fiók kimarad, az aktív megmarad", () => {
    const d = maintenanceMailDecision({ ...ELO, recipients: [INAKTIV, AKTIV] });
    assert.equal(d.kind, "send");
    assert.deepEqual(d.kind === "send" ? d.to.map((cim) => cim.email) : null, [
      "uzem@partner.hu",
    ]);
  });
});

describe("maintenanceMailAuditNote", () => {
  it("a kiküldés sora nem tartalmaz címet", () => {
    const sor = maintenanceMailAuditNote(
      {
        kind: "send",
        to: [
          { email: "uzem@partner.hu", name: "Üzemeltető Ubul" },
          { email: "masik@partner.hu", name: "Másik Mária" },
        ],
      },
      { kind: "off" },
    );
    assert.doesNotMatch(sor, /@/);
    assert.match(sor, /2 címzettnek/);
  });

  it("a kihagyás sora megnevezi az okot", () => {
    assert.match(
      maintenanceMailAuditNote(
        { kind: "skip", reason: "no-recipient" },
        { kind: "off" },
      ),
      /no-recipient/,
    );
  });

  it("az ÁTIRÁNYÍTOTT kiküldés sora kimondja, hogy a címzettek NEM kapták meg", () => {
    const sor = maintenanceMailAuditNote(
      {
        kind: "send",
        to: [{ email: "uzem@partner.hu", name: "Üzemeltető Ubul" }],
      },
      { kind: "on", to: "proba@acropora.hu" },
    );

    assert.match(sor, /ÁTIRÁNYÍTVA/);
    assert.doesNotMatch(sor, /@/);
  });
});
