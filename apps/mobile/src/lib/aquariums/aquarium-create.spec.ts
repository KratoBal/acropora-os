import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aquariumEquipmentProblem,
  buildAquariumCreatePayload,
  emptyAquariumCreateForm,
  emptyAquariumEquipmentForm,
  normalizeDecimalText,
  resolveAquariumVolume,
  type AquariumCreateForm,
} from "./aquarium-create";

describe("resolveAquariumVolume", () => {
  it("számol a három méretből, ha nincs kézi felülírás", () => {
    const result = resolveAquariumVolume({
      lengthCm: 100,
      widthCm: 40,
      heightCm: 50,
      volumeLiters: null,
      isManual: false,
    });
    assert.equal(result.systemVolumeLiters, 200);
    assert.equal(result.systemVolumeIsManual, false);
  });

  /**
   * A BRIEF EXPLICIT KÖVETELMÉNYE (Balázs, 2026-09-24): "de lehessen csak
   * litert beírni", és a kézi érték egy KÉSŐBBI méretmódosításnál is
   * megmaradjon. Ez az állítás pontosan ezt a két felét méri egyszerre: a
   * kézi jelző mellett a méretek megléte ELLENÉRE sem számol felül.
   */
  it("megőrzi a kézi litert, akkor is, ha mind a három méret megvan", () => {
    const result = resolveAquariumVolume({
      lengthCm: 100,
      widthCm: 40,
      heightCm: 50,
      volumeLiters: 999,
      isManual: true,
    });
    assert.equal(result.systemVolumeLiters, 999);
    assert.equal(result.systemVolumeIsManual, true);
  });

  it("liter méretek nélkül is menthető", () => {
    const result = resolveAquariumVolume({
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      volumeLiters: 60,
      isManual: false,
    });
    assert.equal(result.systemVolumeLiters, 60);
    assert.equal(result.systemVolumeIsManual, false);
  });

  it("hiányos méretnél (csak kettő) nem számol, a kapott litert adja vissza", () => {
    const result = resolveAquariumVolume({
      lengthCm: 100,
      widthCm: 40,
      heightCm: null,
      volumeLiters: null,
      isManual: false,
    });
    assert.equal(result.systemVolumeLiters, null);
    assert.equal(result.systemVolumeIsManual, false);
  });

  /**
   * FALSZIFIKÁCIÓ: ha a fenti "megőrzi a kézi litert" állítás véletlenül
   * `isManual`-t figyelmen kívül hagyva mindig számolna, ez a bomlasztott
   * hívás 200-at adna 999 helyett. Kalibrálva: a `isManual: true` sor
   * kivételével ugyanez a bemenet fent 200-at ad.
   */
  it("kalibráció: isManual nélkül ugyanez a bemenet számolna", () => {
    const result = resolveAquariumVolume({
      lengthCm: 100,
      widthCm: 40,
      heightCm: 50,
      volumeLiters: 999,
      isManual: false,
    });
    assert.equal(result.systemVolumeLiters, 200);
  });

  /**
   * KALIBRÁCIÓ: 10 × 10,5 × 10,5 / 1000 = 1,1025, PONTOSAN a negyedik
   * tizedesen áll -- a szerver `systemVolumeLiters` oszlopa `Decimal(12, 3)`
   * (3 tizedes). Egy csonkítás (Math.trunc) 1,102-t adna, a helyes kerekítés
   * 1,103-at. Mind a három bemenet legfeljebb 2 tizedesjegyű, tehát a
   * felviteli mező mai mintája (`DECIMAL_PATTERN`) valóban elő tudja
   * állítani ezt az esetet.
   */
  it("a méretekből számolt liter 3 tizedesre kerekít, nem csonkít", () => {
    const result = resolveAquariumVolume({
      lengthCm: 10,
      widthCm: 10.5,
      heightCm: 10.5,
      volumeLiters: null,
      isManual: false,
    });
    assert.equal(result.systemVolumeLiters, 1.103);
  });
});

describe("normalizeDecimalText", () => {
  it("vesszőt pontra cserél", () => {
    assert.equal(normalizeDecimalText("50,5"), 50.5);
  });
  it("üres szövegre null", () => {
    assert.equal(normalizeDecimalText(""), null);
    assert.equal(normalizeDecimalText("   "), null);
  });
  it("nem szám alakra null", () => {
    assert.equal(normalizeDecimalText("ötven"), null);
    assert.equal(normalizeDecimalText("50cm"), null);
  });
});

describe("aquariumEquipmentProblem", () => {
  it("nyomelem-adagolónál a csatornaszám kötelező", () => {
    assert.equal(
      aquariumEquipmentProblem({
        kind: "NYOMELEM_ADAGOLO",
        channelCount: null,
      }),
      "CHANNEL_COUNT_REQUIRED",
    );
  });
  it("nyomelem-adagolónál csatornaszámmal rendben", () => {
    assert.equal(
      aquariumEquipmentProblem({ kind: "NYOMELEM_ADAGOLO", channelCount: 2 }),
      null,
    );
  });
  it("más eszköznél a csatornaszám tilos", () => {
    assert.equal(
      aquariumEquipmentProblem({ kind: "VILAGITAS", channelCount: 2 }),
      "CHANNEL_COUNT_NOT_ALLOWED",
    );
  });
  it("más eszköznél csatornaszám nélkül rendben", () => {
    assert.equal(
      aquariumEquipmentProblem({ kind: "VILAGITAS", channelCount: null }),
      null,
    );
  });
});

describe("buildAquariumCreatePayload", () => {
  function form(
    overrides: Partial<AquariumCreateForm> = {},
  ): AquariumCreateForm {
    return {
      ...emptyAquariumCreateForm(),
      name: "Nappali akvárium",
      ...overrides,
    };
  }

  it("név nélkül elutasít", () => {
    const result = buildAquariumCreatePayload(form({ name: "  " }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.field, "name");
  });

  it("OWN tulajdonnál nem kér ügyfelet", () => {
    const result = buildAquariumCreatePayload(form({ ownershipType: "OWN" }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.payload.newCustomer, undefined);
  });

  it("CUSTOMER tulajdonnál az ügyfél neve kötelező", () => {
    const result = buildAquariumCreatePayload(
      form({ ownershipType: "CUSTOMER", customerName: "" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.field, "customerName");
  });

  it("CUSTOMER tulajdonnál a helyben felvitt ügyfél bekerül a törzsbe", () => {
    const result = buildAquariumCreatePayload(
      form({
        ownershipType: "CUSTOMER",
        customerName: " Kovács Béla ",
        customerEmail: " bela@example.hu ",
        customerPhone: " +36 30 123 4567 ",
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.payload.newCustomer, {
      type: "PERSON",
      displayName: "Kovács Béla",
      email: "bela@example.hu",
      phone: "+36 30 123 4567",
      addresses: undefined,
    });
  });

  /**
   * A RÉSZLEGES CÍM NÉMA HIBÁT OKOZNA A SZERVEREN (a `CreateCustomerAddressDto`
   * a postalCode/city/line1 mindegyikét kéri, ha az objektum egyáltalán
   * elküldve). Ez az állítás azt méri, hogy a telefon EZT ELŐBB veszi észre.
   */
  it("elkezdett, de befejezetlen cím elutasít", () => {
    const result = buildAquariumCreatePayload(
      form({
        ownershipType: "CUSTOMER",
        customerName: "Kovács Béla",
        customerCity: "Budapest",
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.field, "customerAddress");
  });

  it("teljes cím bekerül a törzsbe", () => {
    const result = buildAquariumCreatePayload(
      form({
        ownershipType: "CUSTOMER",
        customerName: "Kovács Béla",
        customerPostalCode: "1111",
        customerCity: "Budapest",
        customerAddressLine1: "Fő utca 1.",
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.payload.newCustomer?.addresses, [
      {
        type: "OTHER",
        postalCode: "1111",
        city: "Budapest",
        line1: "Fő utca 1.",
      },
    ]);
  });

  it("nem szám méretre elutasít", () => {
    const result = buildAquariumCreatePayload(form({ lengthCm: "nem szám" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.field, "lengthCm");
  });

  it("a méretekből számolt liter bekerül a törzsbe", () => {
    const result = buildAquariumCreatePayload(
      form({ lengthCm: "100", widthCm: "40", heightCm: "50" }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.systemVolumeLiters, 200);
    assert.equal(result.payload.systemVolumeIsManual, false);
  });

  it("kézzel írt liter felülírás mellett a méret nélküli mentés is átmegy", () => {
    const result = buildAquariumCreatePayload(
      form({ volumeLiters: "60", volumeManuallyEdited: true }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.systemVolumeLiters, 60);
    assert.equal(result.payload.systemVolumeIsManual, true);
  });

  it("a hibás eszköz-sor a saját indexét nevezi meg", () => {
    const result = buildAquariumCreatePayload(
      form({
        equipment: [
          emptyAquariumEquipmentForm(),
          { ...emptyAquariumEquipmentForm(), kind: "NYOMELEM_ADAGOLO" },
        ],
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.field, "equipment.1.channelCount");
  });

  it("érvényes eszköz-lista bekerül a törzsbe", () => {
    const result = buildAquariumCreatePayload(
      form({
        equipment: [
          {
            ...emptyAquariumEquipmentForm(),
            kind: "NYOMELEM_ADAGOLO",
            channelCount: "3",
            manufacturer: "GHL",
          },
        ],
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.equipment?.length, 1);
    assert.equal(result.payload.equipment?.[0]?.channelCount, 3);
    assert.equal(result.payload.equipment?.[0]?.manufacturer, "GHL");
  });
});
