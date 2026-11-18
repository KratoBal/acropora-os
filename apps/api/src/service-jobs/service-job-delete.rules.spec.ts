import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  serviceJobDeleteRefusal,
  serviceJobDeleteWarnings,
  type ServiceJobDeleteFacts,
} from "./service-job-delete.rules.js";

/*
  A HIBAJEGY TÖRLÉSÉNEK SZABÁLYA (Balázs 2026-11-18; acrobot 55766, 55770). Egy jegy csak akkor törölhető véglegesen, ha a törlés nem semmisít meg
  lezárt, aláírt, számlázott vagy beszerzéssel járt nyomot, és nem hagy lógó hivatkozást. A tiltás egy mondat, ami megmondja, MI áll útban.
  MI PIROSÍT: ha egy tiltó tény nem tilt (lezárt jegy, teljesítési igazolás, aláírt/lezárt/átadott munkalap, karbantartási rendelés, kívülről
  folytatott munkalap, beszerzésig jutott anyagigény, készletmozgás), ha a megszakított (CANCELLED) jegy nem törölhető, ha a tiltások sorrendje
  elmozdul, vagy ha a tiszta jegy tiltást kap.
*/
const CLEAN: ServiceJobDeleteFacts = {
  status: "IN_PROGRESS",
  kind: "REPAIR",
  hasCompletionCertificate: false,
  hasMaintenanceOrder: false,
  worksheets: [
    {
      number: null,
      handedOver: false,
      signed: false,
      awaitingSignature: false,
      continuedFromOutside: false,
    },
  ],
  procuredMaterialRequests: 0,
  stockMovements: 0,
};

const facts = (
  over: Partial<ServiceJobDeleteFacts>,
): ServiceJobDeleteFacts => ({
  ...CLEAN,
  ...over,
});
const sheet = (over: Partial<ServiceJobDeleteFacts["worksheets"][number]>) => ({
  ...CLEAN.worksheets[0]!,
  ...over,
});

describe("a hibajegy törlésének tiltásai", () => {
  it("a tiszta, nem lezárt jegy törölhető; a munkalap nélküli is", () => {
    assert.equal(serviceJobDeleteRefusal(CLEAN), null);
    assert.equal(serviceJobDeleteRefusal(facts({ worksheets: [] })), null);
  });

  it("a lezárt (COMPLETED) jegy nem, a megszakított (CANCELLED) igen", () => {
    assert.match(
      serviceJobDeleteRefusal(facts({ status: "COMPLETED" })) ?? "",
      /Lezárt hibajegy nem törölhető/,
    );
    assert.equal(serviceJobDeleteRefusal(facts({ status: "CANCELLED" })), null);
  });

  it("a karbantartási lap szövege karbantartási lapot mond", () => {
    assert.match(
      serviceJobDeleteRefusal(
        facts({ kind: "MAINTENANCE", hasCompletionCertificate: true }),
      ) ?? "",
      /karbantartási laphoz|karbantartási lap/,
    );
    assert.doesNotMatch(
      serviceJobDeleteRefusal(
        facts({ kind: "MAINTENANCE", hasCompletionCertificate: true }),
      ) ?? "",
      /hibajegy/i,
    );
  });

  it("a teljesítési igazolás, a karbantartási rendelés tilt", () => {
    assert.match(
      serviceJobDeleteRefusal(facts({ hasCompletionCertificate: true })) ?? "",
      /Teljesítési igazolás/,
    );
    assert.match(
      serviceJobDeleteRefusal(facts({ hasMaintenanceOrder: true })) ?? "",
      /karbantartási rendelés/i,
    );
  });

  it("az aláírt, a lezárt (számozott) és az átadott munkalap tilt; a piszkozat nem", () => {
    for (const over of [
      { signed: true },
      { number: "BIO-2026-001" },
      { handedOver: true },
    ]) {
      assert.match(
        serviceJobDeleteRefusal(
          facts({ worksheets: [sheet({}), sheet(over)] }),
        ) ?? "",
        /munkalap/i,
        JSON.stringify(over),
      );
    }
    assert.equal(
      serviceJobDeleteRefusal(facts({ worksheets: [sheet({}), sheet({})] })),
      null,
    );
  });

  it("a kívülről folytatott munkalap, a beszerzésig jutott anyagigény és a készletmozgás tilt", () => {
    assert.match(
      serviceJobDeleteRefusal(
        facts({ worksheets: [sheet({ continuedFromOutside: true })] }),
      ) ?? "",
      /folytat/i,
    );
    assert.match(
      serviceJobDeleteRefusal(facts({ procuredMaterialRequests: 1 })) ?? "",
      /anyagigény/i,
    );
    assert.match(
      serviceJobDeleteRefusal(facts({ stockMovements: 2 })) ?? "",
      /készletmozgás/i,
    );
  });

  it("több tiltás közül a legsúlyosabb szól (a lezárt jegy a munkalap előtt)", () => {
    assert.match(
      serviceJobDeleteRefusal(
        facts({
          status: "COMPLETED",
          worksheets: [sheet({ signed: true })],
          stockMovements: 1,
        }),
      ) ?? "",
      /Lezárt hibajegy/,
    );
  });

  it("az aláírásra váró munkalap nem tilt, de figyelmeztet; a tiszta jegy nem", () => {
    const waiting = facts({ worksheets: [sheet({ awaitingSignature: true })] });
    assert.equal(serviceJobDeleteRefusal(waiting), null);
    assert.equal(serviceJobDeleteWarnings(waiting).length, 1);
    assert.match(serviceJobDeleteWarnings(waiting)[0]!, /aláírásra vár/);
    assert.deepEqual(serviceJobDeleteWarnings(CLEAN), []);
  });
});
