import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { foregroundNotificationBehavior } from "./push-foreground";

/**
 * AZ ERTESITES, AMI NEM JELENT MEG -- ES AMIT SEMMI NEM JELZETT.
 *
 * A konyvtar alapertelmezese az, hogy kezelo nelkul NEM mutatja meg a nyitott
 * appban erkezo ertesitest. Nem hibaval: csendben. Ezek az allitasok azt a ket
 * dolgot kotik le, ami ezt visszahozna: a viselkedes tartalmat, es azt, hogy a
 * regisztracio egyaltalan lefut.
 */

describe("mit mutatunk, ha az app nyitva van", () => {
  it("a SAV es a LISTA is megkapja", () => {
    /*
      A KETTO KULON MEZO, ES MIND A KETTO KELL. A sav felvillan es eltunik; ha
      a lista kimarad, aki epp nem nezte a telefont abban a masodpercben, sehol
      nem talalja meg az ertesitest.

      MI PIROSIT: barmelyik ketto false-ra allitasa.
    */
    const b = foregroundNotificationBehavior();
    assert.equal(b.shouldShowBanner, true);
    assert.equal(b.shouldShowList, true);
  });

  it("a HANG bekapcsolva marad, mert Androidon a sav ezen all", () => {
    /*
      EZ A LEGKONNYEBBEN ELRONTHATO DONTES EBBEN A MODULBAN, mert „ne zavarjuk
      hanggal" ertelmes kerésnek hangzik.

      A konyvtar tipusanak sajat megjegyzese (expo-notifications 57.0.9): „On
      Android, setting `shouldPlaySound: false` will result in the drop-down
      notification alert NOT showing, no matter what the priority is."

      Vagyis a hang kikapcsolasa Androidon PONT AZT a savot venne el, amiert ez
      a modul keszult -- csendben, es csak az egyik platformon. iOS-en a hiba
      elo sem allna, tehat egy keszuleken vegzett proba is atengedne.

      MI PIROSIT: `shouldPlaySound: false`.
    */
    assert.equal(foregroundNotificationBehavior().shouldPlaySound, true);
  });

  it("JELVENYT nem ir, mert a szerver nem kuld szamot hozza", () => {
    /*
      A szerver APNs torzse `alert` es `sound` mezot kuld, `badge`-et nem. Egy
      itt kitalalt jelveny-szamot semmi nem tartana karban: nem tudna
      nullazodni, es orokre ottmaradna a telefonon.
    */
    assert.equal(foregroundNotificationBehavior().shouldSetBadge, false);
  });

  it("az ELAVULT mezot NEM adja at", () => {
    /*
      A `shouldShowAlert` a konyvtarban elavult, es ha atadjuk, futasidoben
      figyelmeztetest ir a naploba (a `setNotificationHandler` maga ellenorzi).
      Egy regi peldabol masolt kod pont ezt hozna vissza -- es a masolas nem uj
      kockazatot hoz, hanem a meglevot sokszorozza.

      MI PIROSIT: a mezo felvetele a visszaadott objektumba.
    */
    assert.deepEqual(Object.keys(foregroundNotificationBehavior()).sort(), [
      "shouldPlaySound",
      "shouldSetBadge",
      "shouldShowBanner",
      "shouldShowList",
    ]);
  });
});

/**
 * A REGISZTRACIO -- FORRAS-SZINTEN.
 *
 * A `_layout.tsx` `@/` alaku importokat hasznal, tehat a teszt-forditasba nem
 * kerulhet be. Ami viszont CSAK ott dol el, es aminek a hianya NEMA: hogy a
 * viselkedest atadja-e valaki a rendszernek, es hogy MODUL SZINTEN teszi-e.
 * Enelkul a fenti negy allitas egy olyan fuggvenyt ir le, amit soha senki nem
 * hiv -- ugyanaz a szakadas-alak, mint egy vegpont, amit nem hiv semmi.
 */
const LAYOUT = join(__dirname, "..", "..", "..", "src", "app", "_layout.tsx");

const layout = (() => {
  try {
    return readFileSync(LAYOUT, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${LAYOUT}. Ez a KERESES hibaja, nem a lefedettsege -- a lenti allitasok addig semmit nem mondanak.`,
    );
  }
})();

describe("a kezelo regisztracioja", () => {
  it("a forras betoltodott, es tenyleg a gyoker-elrendezes", () => {
    // ISMERT POZITIV KONTROLL: egy ures fajlon a lenti allitasok elbuknanak,
    // de az okat a hianyzo fajlra fognank.
    assert.equal(layout.length > 1000, true);
    assert.match(layout, /export default function RootLayout/);
  });

  it("a viselkedest ATADJA a rendszernek", () => {
    /*
      MI PIROSIT: a hivas torlese. A modul ettol meg lefordul es a fenti negy
      allitas zold marad -- a nyitott appban erkezo ertesites viszont ugyanugy
      eltunne, mint 2026-09-04 elott.
    */
    assert.match(layout, /Notifications\.setNotificationHandler\(\{/);
    assert.match(layout, /foregroundNotificationBehavior\(\)/);
  });

  it("MODUL SZINTEN regisztral, nem egy komponensben", () => {
    /*
      A rendszer akkor kerdez ra a viselkedesre, amikor az ertesites MEGERKEZIK.
      Egy `useEffect`-ben regisztralva a horog a legelso ertesitesrol lekesne --
      pontosan arrol, amelyik az appot eppen eleri.

      A MERES: a hivas a fajl elso komponens-definicioja ELOTT all. Ez gyengebb,
      mint egy futasi proba, es nem nulla: a `useEffect`-be huzas ezt pirosra
      valtja.
    */
    const hivas = layout.indexOf("Notifications.setNotificationHandler(");
    const elsoKomponens = layout.indexOf("export default function RootLayout");
    assert.notEqual(hivas, -1);
    assert.equal(
      hivas < elsoKomponens,
      true,
      "a regisztracio a komponens utan all",
    );
  });
});
