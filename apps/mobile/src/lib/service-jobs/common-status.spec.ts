import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMON_REASON_LABELS,
  COMMON_STATUS_LABELS,
  commonStateOf,
  commonStateText,
  maintenanceBadgeText,
  serviceJobStateText,
  serviceJobStepLabel,
  stepConfirmation,
} from "./common-status";

/*
  A KÖZÖS ÁLLAPOT A TELEFONON (kártya 7f23785c, 5. szelet). MI PIROSÍT: ha a telefon a tárolt állapotból maga vezet le közöset (a szerver mondja);
  ha az Elkészült vagy a Lezárt az ok nélkül áll; ha egy ismeretlen állapot üres szöveget vagy kitalált szót ad a mai tartalék helyett; ha a régi
  válasz (nincs commonStatus) nem a mai nyolc szót mutatja; ha az ismeretlen ok elviszi az állapotot; ha a karbantartás jelvénye a közös szavak
  helyett a régi „Kész"-t írja, amikor a szerver a közöset hozza; ha a lépés-gomb állapotnevet ír ige helyett; ha a két végállapot megerősítés nélkül
  megy; ha a megerősítés a karbantartási lapot hibajegynek nevezi.
*/
describe("commonStateOf és commonStateText", () => {
  it("a szerver két mezőjéből áll össze, az okkal együtt", () => {
    assert.deepEqual(
      commonStateOf({
        commonStatus: "DONE",
        commonReason: "AWAITING_SIGNATURE",
      }),
      {
        status: "DONE",
        reason: "AWAITING_SIGNATURE",
      },
    );
    assert.equal(
      commonStateText({ status: "DONE", reason: "AWAITING_SIGNATURE" }),
      "Elkészült · aláírásra vár",
    );
    assert.equal(
      commonStateText({ status: "CLOSED", reason: "CANCELLED" }),
      "Lezárt · meghiúsult",
    );
    assert.equal(
      commonStateText({ status: "WAITING", reason: "PARTS" }),
      "Vár valamire · alkatrészre",
    );
    assert.equal(
      commonStateText({ status: "IN_PROGRESS", reason: "REJECTED" }),
      "Folyamatban · elutasítva",
    );
    assert.equal(commonStateText({ status: "NEW", reason: null }), "Új");
  });

  it("hiányzó vagy ismeretlen állapotnál nincs közös állapot (a mai tartalék áll)", () => {
    for (const item of [
      {},
      { commonStatus: null },
      { commonStatus: "" },
      { commonStatus: "ARCHIVED" },
      // a prototípus-kulcs sem állapot (`Object.hasOwn`, nem `in`; barracuda, #2981)
      { commonStatus: "toString" },
      { commonStatus: "constructor" },
      { commonStatus: "__proto__" },
    ]) {
      assert.equal(commonStateOf(item), null);
    }
  });

  it("az ismeretlen ok csak az okot hagyja el, az állapot marad", () => {
    assert.deepEqual(
      commonStateOf({ commonStatus: "DONE", commonReason: "SOMETHING_NEW" }),
      {
        status: "DONE",
        reason: null,
      },
    );
    assert.deepEqual(
      commonStateOf({ commonStatus: "DONE", commonReason: null }),
      { status: "DONE", reason: null },
    );
    assert.deepEqual(
      commonStateOf({ commonStatus: "DONE", commonReason: "toString" }),
      { status: "DONE", reason: null },
    );
  });

  it("az öt állapot és a hét ok felirata pontosan a közös lista (a kulcsok száma is)", () => {
    assert.deepEqual(Object.keys(COMMON_STATUS_LABELS), [
      "NEW",
      "IN_PROGRESS",
      "WAITING",
      "DONE",
      "CLOSED",
    ]);
    assert.equal(Object.keys(COMMON_REASON_LABELS).length, 7);
  });
});

describe("serviceJobStateText", () => {
  it("a közös állapot az okkal; a régi válasz a tárolt állapot mai nevével", () => {
    assert.equal(
      serviceJobStateText({
        status: "IN_PROGRESS",
        commonStatus: "DONE",
        commonReason: "AWAITING_HANDOVER",
      }),
      "Elkészült · átadásra vár",
    );
    assert.equal(
      serviceJobStateText({ status: "WAITING_FOR_PARTS" }),
      "Alkatrészre vár",
    );
    assert.equal(serviceJobStateText({ status: "COMPLETED" }), "Elkészült");
    assert.equal(
      serviceJobStateText({ status: "CANCELLED", commonStatus: "NOPE" }),
      "Meghiúsult",
    );
  });

  it("ismeretlen tárolt állapot és nincs közös: a nyers kód, nem üres szöveg", () => {
    assert.equal(serviceJobStateText({ status: "BRAND_NEW" }), "BRAND_NEW");
  });
});

describe("maintenanceBadgeText", () => {
  it("közös állapotnál a közös szó; nélküle a mai Kész / Folyamatban; ha az sincs, nincs jelvény", () => {
    assert.equal(
      maintenanceBadgeText({ commonStatus: "CLOSED", maintenanceDone: true }),
      "Lezárt",
    );
    assert.equal(
      maintenanceBadgeText({
        commonStatus: "IN_PROGRESS",
        maintenanceDone: false,
      }),
      "Folyamatban",
    );
    assert.equal(maintenanceBadgeText({ maintenanceDone: true }), "Kész");
    assert.equal(
      maintenanceBadgeText({ maintenanceDone: false }),
      "Folyamatban",
    );
    assert.equal(maintenanceBadgeText({}), null);
  });
});

describe("serviceJobStepLabel", () => {
  it("a gomb ige: lezárás, meghiúsultnak jelölés, várakoztatás, folytatás, munka megkezdése", () => {
    assert.equal(serviceJobStepLabel("IN_PROGRESS", "COMPLETED"), "Lezárás");
    assert.equal(
      serviceJobStepLabel("IN_PROGRESS", "CANCELLED"),
      "Meghiúsultnak jelölés",
    );
    assert.equal(
      serviceJobStepLabel("IN_PROGRESS", "WAITING_FOR_PARTS"),
      "Várakoztatás: alkatrészre",
    );
    assert.equal(
      serviceJobStepLabel("NEW", "WAITING_FOR_CUSTOMER"),
      "Várakoztatás: ügyfélre",
    );
    assert.equal(
      serviceJobStepLabel("WAITING_FOR_PARTS", "IN_PROGRESS"),
      "Folytatás",
    );
    assert.equal(
      serviceJobStepLabel("WAITING_FOR_CUSTOMER", "IN_PROGRESS"),
      "Folytatás",
    );
    assert.equal(serviceJobStepLabel("NEW", "IN_PROGRESS"), "Munka megkezdése");
  });

  it("a nem cél állapot a tárolt nevét kapja, nem kitalált igét", () => {
    assert.equal(serviceJobStepLabel("NEW", "TRIAGED"), "Felmérve");
    assert.equal(serviceJobStepLabel("NEW", "SCHEDULED"), "Ütemezve");
  });
});

describe("stepConfirmation", () => {
  it("csak a két végállapot kér megerősítést, a többi lépés nem", () => {
    for (const to of [
      "IN_PROGRESS",
      "WAITING_FOR_PARTS",
      "WAITING_FOR_CUSTOMER",
      "NEW",
      "TRIAGED",
      "SCHEDULED",
    ] as const)
      assert.equal(stepConfirmation(to, "KB-1", "REPAIR"), null, to);
    assert.ok(stepConfirmation("COMPLETED", "KB-1", "REPAIR"));
    assert.ok(stepConfirmation("CANCELLED", "KB-1", "REPAIR"));
  });

  it("a szöveg kimondja, hogy nincs visszaút, és megnevezi a lapot a fajta szavával", () => {
    const lezaras = stepConfirmation("COMPLETED", "KB-2026-001", "REPAIR")!;
    assert.equal(lezaras.title, "Lezárod a hibajegyet?");
    assert.match(
      lezaras.message,
      /KB-2026-001 hibajegy lezárul, és nem nyitható újra/,
    );
    assert.match(lezaras.message, /Ez nem vonható vissza/);
    assert.equal(lezaras.confirmLabel, "Lezárás");
    const meghiusul = stepConfirmation("CANCELLED", "KB-2026-001", undefined)!;
    assert.equal(meghiusul.title, "Meghiúsultnak jelölöd a hibajegyet?");
    assert.match(
      meghiusul.message,
      /meghiúsultként lezárul, és nem nyitható újra/,
    );
    assert.equal(meghiusul.confirmLabel, "Meghiúsultnak jelölés");
  });

  it("a karbantartási lap nem hibajegy és a tárgyesete is helyes (lapot)", () => {
    const m = stepConfirmation("COMPLETED", "KT-7", "MAINTENANCE")!;
    assert.equal(m.title, "Lezárod a karbantartási lapot?");
    assert.match(m.message, /KT-7 karbantartási lap lezárul/);
    assert.doesNotMatch(m.message, /hibajegy/);
  });
});
