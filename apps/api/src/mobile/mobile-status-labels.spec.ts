import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { forras, kodSzoveg } from "./mobile-contract-source.js";

/**
 * A HIBAJEGY ALLAPOT-FELIRATAI EGYEZZENEK A KET FELULETEN.
 *
 * === MIERT KELETKEZETT (2026-09-18) ===
 *
 * Balazs atnevezte a `CANCELLED` felirat magyar alakjat ("Elallt" -> "Meghiusult"),
 * es a valtoztatas HAROM helyet erintett: a webes terkepet, a mobil tukret es egy
 * segito mondatot. A kartya sajat indoklasa ez volt: "mind a harom kell, kulonben
 * a KET FELULET MAST MOND".
 *
 * Ez egy SZABALY volt, amit embernek kellett betartania -- es a ket terkep kozott
 * SEMMI nem allt. Egy kovetkezo atnevezes ugyanugy elcsuszhatott volna, es a
 * kulonbseg CSENDES: mind a ket felulet mukodik, csak mast ir ugyanarra a jegyre.
 *
 * Ez a spec abbol csinal MERHETOT, ami eddig fegyelem volt.
 *
 * === A HATARA, KIMONDVA ===
 *
 * A KULCS-ERTEK parokat veti ossze, nem a tipusokat. A kulcsok halmazat mar
 * ellenorzi a fordito mind a ket oldalon (`Record<ServiceJobStatusValue, string>`),
 * az ERTEKEKROL viszont egyik oldal sem tud semmit -- es epp az ertek az, amit az
 * ember lat.
 *
 * ES AMIT SZANDEKOSAN NEM FED: a PARTNER feliratait. Azok a szerverrol jonnek
 * (`partnerStatusLabel`), kulon halmazbol, mert a partner mas bontast lat. Egy
 * kozos allitas ott hamis pirosat adna.
 */
const WEB = "../web/src/components/service-jobs/service-job-labels.ts";
const MOBIL = "../mobile/src/lib/service-jobs/service-job-status.ts";

/** Egy `KULCS: "ertek",` terkep parjai, a megjelolt konstansbol. */
function feliratok(kod: string, nev: string): Map<string, string> {
  const start = kod.indexOf(nev);
  assert.notEqual(start, -1, `nem találtam: ${nev}`);
  const nyito = kod.indexOf("{", start);
  const zaro = kod.indexOf("};", nyito);
  assert.notEqual(zaro, -1, `nem találtam a végét: ${nev}`);
  const torzs = kodSzoveg(kod.slice(nyito, zaro));
  return new Map(
    [...torzs.matchAll(/([A-Z_]+):\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!]),
  );
}

describe("a hibajegy állapot-feliratai a két felületen", () => {
  const web = feliratok(forras(WEB), "serviceJobStatusLabel");
  const mobil = feliratok(forras(MOBIL), "SERVICE_JOB_STATUS_LABELS");

  /**
   * POZITIV KONTROLL: ket URES terkep barmikor egyezne. A nyolc allapot ma
   * ismert, es a szam LEFELE nem mozdulhat eszrevetlenul.
   */
  it("POZITÍV KONTROLL: mind a két térkép tele van", () => {
    assert.ok(web.size >= 8, `gyanúsan kevés webes felirat: ${web.size}`);
    assert.ok(mobil.size >= 8, `gyanúsan kevés mobil felirat: ${mobil.size}`);
    // ES EGY ISMERT ERTEK, hogy a kiolvasas ne csak SZAMOLJON, hanem lasson is.
    assert.equal(web.get("NEW"), "Új");
  });

  it("ugyanazt a szót mondják ugyanarra az állapotra", () => {
    const eltero = [...web.entries()]
      .filter(([kulcs, ertek]) => mobil.get(kulcs) !== ertek)
      .map(
        ([kulcs, ertek]) =>
          `${kulcs}: web "${ertek}" ≠ mobil "${mobil.get(kulcs)}"`,
      );
    assert.deepEqual(
      eltero,
      [],
      "a két felület MÁST mond ugyanarra az állapotra -- egy átnevezés az egyik oldalon maradt",
    );
  });

  it("egyik oldalon sincs olyan állapot, amit a másik nem ismer", () => {
    assert.deepEqual([...web.keys()].sort(), [...mobil.keys()].sort());
  });
});
