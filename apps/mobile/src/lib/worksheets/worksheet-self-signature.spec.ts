import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  selfSignatureGate,
  type BiometricOutcome,
} from "./worksheet-self-signature";

describe("a saját aláírás biometrikus kapuja", () => {
  it("sikeres azonosítás után MEGY, és nincs mit mondani", () => {
    assert.deepEqual(selfSignatureGate("unlocked"), {
      mayProceed: true,
      mayRetry: false,
      message: null,
    });
  });

  it("BEÁLLÍTATLAN készüléken MEGY -- ez a döntés, nem mulasztás", () => {
    /*
      acrobot pontositasa, 2026-09-18 13:23: "Aki nem allitott be biometriat a
      sajat telefonjan, attol nem eshet ki a munkabol: a kapu kenyelmi es
      helyi, nem ez hordozza a bizonyito erot."

      MI PIROSIT: ha a beallitatlan keszulek is elutasitast kap. Az a szerelot
      a HELYSZINEN allitana meg, es megkerulo ut nincs -- a belsos agon
      alairokod sincs, amire visszaesni lehetne.
    */
    const kapu = selfSignatureGate("unavailable");
    assert.equal(kapu.mayProceed, true);
    /*
      ES A MONDAT KIMONDJA, HOGY NEM TORTENT AZONOSITAS. E nelkul a szerelo azt
      hinne, hogy igen -- es a kapu tobbet allitana, mint ami tortent.
    */
    assert.ok(
      kapu.message,
      "szó nélkül megy át: a szerelő azt hinné, azonosított",
    );
    assert.match(kapu.message, /nincs beállítva|bejelentkezésed/);
  });

  it("ELUTASÍTOTT azonosítás után NEM megy, és nincs megkerülő út", () => {
    /*
      EZ A LENYEG, ES A MASIK KET ALLITASSAL EGYUTT ER VALAMIT: itt VAN
      allitasunk -- a keszulek azt mondta, hogy nem a tulajdonos. Ezt figyelmen
      kivul hagyni rosszabb, mint meg sem kerdezni.

      MI PIROSIT: ha a `rejected` is atengedne. Akkor a kapu DISZLET lenne: a
      kerdest feltennenk, es a valaszt eldobnank.
    */
    const kapu = selfSignatureGate("rejected");
    assert.equal(kapu.mayProceed, false);
    assert.equal(kapu.mayRetry, true);
    assert.ok(kapu.message);
  });

  it("a KÉT NEMLEGES kimenet KÜLÖNBÖZIK -- ez nem két néven ugyanaz", () => {
    /*
      "Nincs mit probalni" a KESZULEKROL szol (hianyzo adat), a "nem sikerult"
      a SZEMELYROL (nemleges valasz).

      MI PIROSIT: ha valaki egysegesiti a ket agat. Az barmelyik iranyban kart
      okoz: vagy a beallitatlan telefon allitja meg a munkat, vagy az
      elutasitott ujjlenyomat megy at.
    */
    assert.notEqual(
      selfSignatureGate("unavailable").mayProceed,
      selfSignatureGate("rejected").mayProceed,
    );
  });

  it("ÚJRAPRÓBÁLÁST csak ott kínál, ahol van mit próbálni", () => {
    /*
      Egy "probald ujra" gomb egy Face ID nelkuli telefonon olyan gomb, ami nem
      tud mukodni. A meglevo `biometric-outcome.ts` epp ezert valasztja szet a
      ket agat -- ez az allitas azt orzi, hogy a szetvalasztas IDE is atjott.
    */
    assert.equal(selfSignatureGate("unavailable").mayRetry, false);
    assert.equal(selfSignatureGate("rejected").mayRetry, true);
  });

  it("MIND A HÁROM kimenetre válaszol, és a válaszok különböznek", () => {
    /*
      POZITIV KONTROLL: egy fuggveny, ami mindenre ugyanazt adja, a fenti
      allitasok kozul tobbet is kielegitene. Az alakok halmaza azt meri, hogy a
      harom ag tenyleg harom.
    */
    const mind: BiometricOutcome[] = ["unlocked", "rejected", "unavailable"];
    const alakok = mind.map((o) => JSON.stringify(selfSignatureGate(o)));
    assert.equal(new Set(alakok).size, 3, alakok.join(" | "));
  });
});
