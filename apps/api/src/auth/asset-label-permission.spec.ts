import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * A MENUPONT ES A VEGPONTOK UGYANAZT A JOGOT KAPJAK.
 *
 * MIERT KELL ORZO, HOLOTT MA EGYEZIK. Ez a mai napunk fo lelete, egy szabaly
 * KET helyen: ha a ketto szetcsuszik, vagy latszik a gomb annak, aki nem
 * hivhatja meg, vagy hivhatja az, aki nem latja. EGYIK IRANY SEM DOB HIBAT --
 * az elso egy 403-at ad kattintaskor, a masodik semmit.
 *
 * A DONTES HORGONYA: Balazs, 2026-09-02 21:00:53, Discord (matricas szal), a
 * kerdesre, hogy a szervizes lassa-e a menupontot, szo szerint: "Nem kell hogy
 * lassa". Ezert `SETTINGS_MANAGE` -- ugyanaz, ami a tobbi Beallitasok-tetelt
 * kapuzza, amit a szervizes nem lat.
 */
const NAV = "../../packages/types/src/navigation.ts";
const CONTROLLER = "src/service-assets/service-assets.controller.ts";

/** A matricas vegpontok utvonalai, ahogy a vezerloben allnak. */
const UTVONALAK = [
  '@Get("labels/free")',
  '@Post("labels")',
  '@Post("label-batches")',
  '@Get("label-batches")',
  '@Post("label-batches/import")',
];

/** Az `asset-labels` bejegyzes jogosultsaga a kozos forrasbol. */
function menupontJoga(): string {
  const src = readFileSync(NAV, "utf8");
  const blokk = /id: "asset-labels",([\s\S]*?)\n  \},/.exec(src);
  assert.ok(blokk, "az asset-labels bejegyzés nincs a közös forrásban");
  const jog = /permission\(PERMISSIONS\.([A-Z_]+)\)/.exec(blokk[1]!);
  assert.ok(jog, "az asset-labels bejegyzésnek nincs permission() alakú joga");
  return jog[1]!;
}

/** Egy vegpont joga: a dekorator KOZVETLENUL az utvonal utan all. */
function vegpontJoga(utvonal: string): string {
  const src = readFileSync(CONTROLLER, "utf8");
  const i = src.indexOf(utvonal);
  assert.notEqual(i, -1, `${utvonal} nincs a vezérlőben`);
  const jog = /@RequirePermissions\(PERMISSIONS\.([A-Z_]+)\)/.exec(
    src.slice(i, i + 400),
  );
  assert.ok(jog, `${utvonal} után nem találtam RequirePermissions dekorátort`);
  return jog[1]!;
}

describe("a matricás menüpont és a végpontjai", () => {
  it("a menüpont SETTINGS_MANAGE alatt áll, nem SERVICE_MANAGE alatt", () => {
    // A KONKRET ERTEK IS ALLITAS, nem csak az egyezes: ha mindketto
    // SERVICE_MANAGE-re csuszna, az "egyeznek" allitas ZOLD maradna, kozben a
    // szervizes latna a menupontot -- amit Balazs kifejezetten kizart.
    assert.equal(menupontJoga(), "SETTINGS_MANAGE");
  });

  it("mind az öt végpont ugyanazt a jogot kéri, mint a menüpont", () => {
    const menu = menupontJoga();
    const eltero = UTVONALAK.filter((ut) => vegpontJoga(ut) !== menu).map(
      (ut) => `${ut}: ${vegpontJoga(ut)}`,
    );
    assert.deepEqual(
      eltero,
      [],
      `ezek a végpontok más jogot kérnek, mint a menüpont (${menu}): ${eltero.join(", ")}`,
    );
  });

  it("a kivágás tényleg végpontonként mér, nem az egész fájlon", () => {
    // ISMERT POZITIV KONTROLL. A fenti allitas egy szoveg-darabon all; ha a
    // kivagas az egesz fajlt latna, MINDEN vegpont "egyezne", mert valahol a
    // fajlban all SETTINGS_MANAGE. Egy MASIK vegpont, amirol tudjuk, hogy MAS
    // jogon all, ezt kizarja.
    assert.equal(vegpontJoga('@Get("scan-label/:code")'), "SERVICE_VIEW");
  });
});
