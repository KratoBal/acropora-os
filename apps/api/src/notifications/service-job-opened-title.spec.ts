import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serviceJobOpenedPushTitle } from "./service-job-opened-title.js";

describe("az ügyfél-bejelentés push címe", () => {
  it("N1: a kóddal a bővebb mondat megy", () => {
    assert.equal(
      serviceJobOpenedPushTitle("FANK"),
      "Új hibajegyet nyitott a FANK",
    );
  });

  it("N2: kód nélkül a visszaesés megy", () => {
    assert.equal(
      serviceJobOpenedPushTitle(null),
      "Új hibajegyet nyitott egy ügyfél",
    );
  });

  /**
   * N3: A TILTOTT HARMADIK ALAK.
   *
   * Egy csupa szokozbol allo kod a `null`-lal EGYENERTEKU, es ha nem az lenne,
   * a mondat "Új hibajegyet nyitott a " alakban menne ki -- befejezetlenul, a
   * zarolt kepernyore. Ez rosszabb mind a ket ervenyes alaknal.
   *
   * NEM ELEG AZT ALLITANI, hogy a visszaeses jon: azt allitom, hogy a kimenet
   * SOHA nem vegzodik a "nyitott a " toredekkel -- igy egy harmadik, meg nem
   * latott ures alak is fennakad rajta.
   */
  it("N3: a csupa szóköz kód nem ad befejezetlen mondatot", () => {
    for (const ures of ["   ", "", "\t", undefined]) {
      const cim = serviceJobOpenedPushTitle(ures);
      assert.equal(
        cim,
        "Új hibajegyet nyitott egy ügyfél",
        `bemenet: ${JSON.stringify(ures)}`,
      );
      assert.doesNotMatch(cim, /nyitott a $/);
    }
  });

  /**
   * N4: KONTROLL -- a kod KORULVAGVA kerul bele.
   *
   * E nelkul az N1 zold maradna egy olyan megvalositason is, ami a nyers
   * erteket teszi be: " FANK " mellett a mondat ket szokozzel allna.
   */
  it("N4: KONTROLL: a kód körülvágva kerül a mondatba", () => {
    assert.equal(
      serviceJobOpenedPushTitle("  FANK  "),
      "Új hibajegyet nyitott a FANK",
    );
  });
});
