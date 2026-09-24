import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  maintenancePackageBlockers,
  maintenancePackageBlockMessage,
  maintenancePackageIsBlocked,
} from "./maintenance-package-gate.js";

const KESZ_LAP = {
  id: "ws-1",
  number: "ML-2026-001",
  hidden: false,
  closed: true,
  hasIssuedSheet: true,
};

function input(
  overrides: Partial<Parameters<typeof maintenancePackageBlockers>[0]> = {},
) {
  return {
    worksheets: [KESZ_LAP],
    hasCertificate: true,
    certificateSigned: true,
    invoicePresent: false,
    purpose: "download" as const,
    ...overrides,
  };
}

describe("maintenancePackageBlockers", () => {
  it("mindent rendben találva a letöltés nem blokkolt", () => {
    const blockers = maintenancePackageBlockers(input());
    assert.equal(maintenancePackageIsBlocked(blockers), false);
  });

  /**
   * KALIBRÁCIÓ: ha a `purpose` ága hiányozna, ez az állítás is `false`-t
   * adna számla nélkül -- ez a teszt pont azt méri, hogy a `send` cél
   * ténylegesen szigorúbb, mint a `download`.
   */
  it("mindent rendben találva, de számla nélkül a kiküldés blokkolt", () => {
    const blockers = maintenancePackageBlockers(input({ purpose: "send" }));
    assert.equal(maintenancePackageIsBlocked(blockers), true);
    assert.deepEqual(blockers.job, ["no-invoice"]);
  });

  it("számlával a kiküldés is átmegy", () => {
    const blockers = maintenancePackageBlockers(
      input({ purpose: "send", invoicePresent: true }),
    );
    assert.equal(maintenancePackageIsBlocked(blockers), false);
  });

  it("igazolás nélkül a LETÖLTÉS is blokkolt, nem csak a kiküldés", () => {
    const blockers = maintenancePackageBlockers(
      input({ hasCertificate: false, certificateSigned: false }),
    );
    assert.equal(maintenancePackageIsBlocked(blockers), true);
    assert.deepEqual(blockers.job, ["no-certificate"]);
  });

  it("kiállított, de alá nem írt igazolás külön okot ad, nem a hiányzóéval azonosat", () => {
    const blockers = maintenancePackageBlockers(
      input({ hasCertificate: true, certificateSigned: false }),
    );
    assert.deepEqual(blockers.job, ["certificate-not-signed"]);
  });

  it("lezáratlan munkalap blokkolja a letöltést is", () => {
    const blockers = maintenancePackageBlockers(
      input({
        worksheets: [{ ...KESZ_LAP, closed: false, hasIssuedSheet: false }],
      }),
    );
    assert.equal(maintenancePackageIsBlocked(blockers), true);
    assert.equal(blockers.worksheets[0]?.reason, "not-closed");
  });
});

describe("maintenancePackageBlockMessage", () => {
  it("egy mondatban mondja ki az összes okot egyszerre", () => {
    const blockers = maintenancePackageBlockers(
      input({
        worksheets: [{ ...KESZ_LAP, closed: false, hasIssuedSheet: false }],
        hasCertificate: false,
        purpose: "send",
      }),
    );
    const message = maintenancePackageBlockMessage(blockers);
    assert.match(message, /Nincs lezárva: ML-2026-001/);
    assert.match(message, /Nincs kiállítva teljesítési igazolás/);
    assert.match(message, /Nincs kiállítva számla/);
  });
});
