import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeRegistrationOutcome,
  describeTokenShape,
  registrationOutcome,
} from "./push-registration";

const APNS = "a".repeat(64);
/* Egy FCM-szerű alak: hosszú, kettősponttal és aláhúzással. A TARTALMA
   kitalált -- amit mérünk, az az ALAK, nem egy valódi token. */
const FCM = "dGVzenQ_a1b2c3:APA91bH-" + "x".repeat(120);

describe("a token alakja, a token kiírása nélkül", () => {
  it("az APNs alakot hexadecimálisként nevezi meg, a hosszával", () => {
    const leiras = describeTokenShape(APNS);

    assert.ok(leiras.includes("64 karakter"));
    assert.ok(leiras.includes("csak hexadecimális"));
  });

  /**
   * A MÁSIK IRÁNY, ÉS EZ A MÉRÉS LÉNYEGE: az FCM alaknak MÁS a leírása, tehát
   * a kettő a képernyőn szétválasztható -- enélkül a mérés nem mondana semmit.
   */
  it("az FCM-szerű alakot a hossza és a jelei különböztetik meg", () => {
    const leiras = describeTokenShape(FCM);

    assert.ok(!leiras.includes("csak hexadecimális"));
    assert.ok(leiras.includes("kettőspontot tartalmaz"));
    assert.ok(leiras.includes("aláhúzást tartalmaz"));
  });

  it("az Expo tokent néven nevezi", () => {
    assert.ok(
      describeTokenShape("ExponentPushToken[abc123]").includes("Expo-token"),
    );
  });

  /**
   * A TOKEN MAGA NEM KERÜL KI. Egy tokent a képernyőre írni ugyanaz a fajta
   * hiba, mint naplóba írni -- és ez az állítás az, ami megakadályozza, hogy
   * egy későbbi "bővítsük ki egy kis részlettel" lépés csendben kiszivárogtassa.
   */
  it("a leírás NEM tartalmazza magát a tokent", () => {
    for (const token of [APNS, FCM, "ExponentPushToken[abc123]"]) {
      const leiras = describeTokenShape(token);
      assert.ok(
        !leiras.includes(token),
        `a leírás kiírta a tokent: ${leiras.slice(0, 40)}`,
      );
      /* Egy hosszabb részlet sem: az első húsz karakter már azonosítana. */
      assert.ok(!leiras.includes(token.slice(0, 20)));
    }
  });

  /**
   * AZ ALAK BEKERÜL A HIBA OKÁBA. A puszta "not a native APNs token" IGAZ, de
   * nem mondja meg, MI jött helyette -- és épp az választja szét az Expo
   * tokent (rossz hívás) az FCM tokentől (másik platform, másik szabály kell).
   */
  it("a rossz alakú token OKA hordozza az alakot", () => {
    const eredmeny = registrationOutcome({
      supported: true,
      permission: { granted: true, canAskAgain: true },
      token: FCM,
      // IOS: itt az FCM-alak VALOBAN rossz. Androidon ugyanez atmegy -- arra
      // sajat allitas all a `push-registration.spec.ts`-ben.
      platform: "IOS",
    });

    assert.equal(eredmeny.status, "failed");
    if (eredmeny.status !== "failed") return;
    assert.ok(eredmeny.reason.includes("kettőspontot tartalmaz"));
  });
});

describe("mit lát a képernyőn, aki bekapcsolta", () => {
  /**
   * A NÉGY KIMENETEL NÉGY KÜLÖN MONDAT. Eddig EGY közös mondat állt a
   * beállítások lapján ("nincs engedély vagy nincs push"), ami Androidon
   * valószínűleg HAMIS: ha a készülék ad tokent, de az nem APNs-alakú, akkor
   * VAN engedély ÉS van push.
   */
  it("a megtagadott engedély és a hiányzó push KÜLÖN mondat", () => {
    const megtagadva = describeRegistrationOutcome({ status: "declined" });
    const nincs = describeRegistrationOutcome({ status: "unavailable" });

    assert.ok(megtagadva?.includes("nem adott engedélyt"));
    assert.ok(nincs?.includes("nincs push"));
    assert.notEqual(megtagadva, nincs);
  });

  it("az elakadt regisztráció kimondja, hogy a készülék ADOTT választ", () => {
    const szoveg = describeRegistrationOutcome({
      status: "failed",
      reason: "not a native APNs token (163 karakter, kettőspontot tartalmaz)",
    });

    assert.ok(szoveg?.includes("ADOTT választ"));
    assert.ok(szoveg?.includes("kettőspontot tartalmaz"));
  });

  /**
   * A SIKERES ESET NEM ÍR KI SEMMIT. Egy mondat arról, hogy minden rendben,
   * pont annyit ér, mint egy üres képernyő -- és elveszi a helyet a másik
   * háromtól, ami viszont teendőt ad.
   */
  it("a sikeres regisztráció nem mond semmit", () => {
    assert.equal(
      describeRegistrationOutcome({ status: "ready", token: "a".repeat(64) }),
      null,
    );
  });

  it("mindhárom mondat MÉRÉS-ként jelöli magát", () => {
    for (const eset of [
      { status: "declined" } as const,
      { status: "unavailable" } as const,
      { status: "failed", reason: "x" } as const,
    ])
      assert.ok(describeRegistrationOutcome(eset)?.startsWith("MÉRÉS:"));
  });
});
