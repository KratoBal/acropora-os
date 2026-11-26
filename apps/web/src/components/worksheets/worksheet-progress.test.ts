import { describe, expect, it } from "vitest";

import { handoverNote, worksheetProgressSteps } from "./worksheet-progress";

/*
  A MUNKALAP FOLYAMATSÁVJA ÉS AZ ÁTADÁS MONDATA (picasso 3.1; acrobot 62184).
  MI PIROSÍT: ha a sáv szavai nem a jelvény szavai; ha az aláírt lap nem lépi át a Lezárt lépést; ha az elutasított lap nem a harmadik
  lépésen áll; ha az átadás a sorrendhez kötött (korábbi átadás is pipa); ha a karbantartási vagy az önálló lap átadását hibának
  mondja, vagy a hibajegy alattiét nem.
*/
const states = (steps: ReturnType<typeof worksheetProgressSteps>) =>
  steps.map((step) => `${step.label}:${step.state}`);

describe("worksheetProgressSteps", () => {
  it("piszkozat: a saját szavával (Új vagy Folyamatban) a jelenlegi lépés", () => {
    expect(states(worksheetProgressSteps("DRAFT", 0, false))).toEqual([
      "Új:current",
      "Elkészült:todo",
      "Lezárt:todo",
      "Átadva:todo",
    ]);
    expect(states(worksheetProgressSteps("DRAFT", 2, false))[0]).toBe(
      "Folyamatban:current",
    );
  });

  it("aláírásra vár: Elkészült a jelenlegi", () => {
    expect(
      states(worksheetProgressSteps("AWAITING_SIGNATURE", 2, false)),
    ).toEqual([
      "Folyamatban:done",
      "Elkészült:current",
      "Lezárt:todo",
      "Átadva:todo",
    ]);
  });

  it("aláírva: a Lezárt megtett, az átadás a jelenlegi, amíg nincs rögzítve", () => {
    expect(states(worksheetProgressSteps("SIGNED", 2, false))).toEqual([
      "Folyamatban:done",
      "Elkészült:done",
      "Lezárt:done",
      "Átadva:current",
    ]);
    expect(states(worksheetProgressSteps("SIGNED", 2, true))[3]).toBe(
      "Átadva:done",
    );
  });

  it("az aláírás előtti átadás is pipa; az elutasított lap a harmadik lépésen, Elutasítva", () => {
    expect(states(worksheetProgressSteps("DRAFT", 1, true))[3]).toBe(
      "Átadva:done",
    );
    expect(states(worksheetProgressSteps("REJECTED", 1, false))).toEqual([
      "Folyamatban:done",
      "Elkészült:done",
      "Elutasítva:rejected",
      "Átadva:todo",
    ]);
  });
});

describe("handoverNote", () => {
  it("rögzített átadásnál nincs mondat", () => {
    expect(
      handoverNote({
        handedOver: true,
        serviceJob: { jobNumber: "HJ-1", kind: "REPAIR" },
      }),
    ).toBeNull();
  });

  it("hibajegy alatt kötelező (a régi válasz fajta nélkül is hibajegy); karbantartásnál és önálló lapnál nem", () => {
    for (const kind of ["REPAIR", undefined] as const)
      expect(
        handoverNote({
          handedOver: false,
          serviceJob: { jobNumber: "HJ-1", kind },
        }),
      ).toEqual({
        required: true,
        text: "A HJ-1 hibajegy csak az átadás rögzítése után zárható le.",
      });
    for (const serviceJob of [
      { jobNumber: "KT-1", kind: "MAINTENANCE" as const },
      null,
    ])
      expect(handoverNote({ handedOver: false, serviceJob })?.required).toBe(
        false,
      );
  });
});
