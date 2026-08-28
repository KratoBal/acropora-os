import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { devicePlatform } from "./push-platform";

describe("a telefon a saját platformját vallja", () => {
  it("a két valódi platformot a szerver alakjára képezi", () => {
    // PIROSÍT: ha bárki visszaírja a beégetett értéket. Ez a teszt az EGYETLEN
    // dolog, ami az Android ágat ma egyáltalán megméri: Android kiadás nincs,
    // tehát futásban senki nem venné észre, ha az ág eltűnne.
    assert.equal(devicePlatform("ios"), "IOS");
    assert.equal(devicePlatform("android"), "ANDROID");
  });

  it("a harmadik esetet KIMONDOTTAN kezeli, nem véletlenül", () => {
    // Ez nem a viselkedést védi, hanem a DÖNTÉST rögzíti: a szerver enumja két
    // értéket ismer, és a regisztrációig csak valódi készülék jut el natív
    // tokennel, tehát ez az ág a drótig nem ér el. Ha valaha mégis, ennek a
    // sornak kell elbuknia, hogy valaki újra döntsön -- ne csendben menjen ki
    // egy harmadik platform iOS néven.
    assert.equal(devicePlatform("web"), "IOS");
    assert.equal(devicePlatform("windows"), "IOS");
  });
});
