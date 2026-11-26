import type { MyServiceWorkItem } from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  serviceWorkStatusLabel,
  serviceWorkStatusTone,
} from "./service-work-labels";

const job = (over: Partial<MyServiceWorkItem> = {}): MyServiceWorkItem => ({
  kind: "SERVICE_JOB",
  jobKind: "REPAIR",
  id: "job-1",
  number: "HJ-2026-0141",
  status: "IN_PROGRESS",
  title: "Szivattyú",
  partnerName: null,
  unitName: null,
  scheduledAt: null,
  overdueSince: null,
  sentForSignature: false,
  bucket: "MINE",
  createdAt: "2026-11-25T08:00:00.000Z",
  ...over,
});

/*
  A FELADATAIM JEGYE A KÖZÖS SZÓVAL (kártya 7f23785c): ha a szerver küldi, ugyanaz a felirat és szín, mint a hibajegy-listán. A tárolt
  IN_PROGRESS a régi táblából Folyamatban volna; a szerver itt Elkészültet mond, és annak kell látszania. Régi válasznál a tárolt név.
*/
describe("a Feladataim jegyének állapota", () => {
  it("a szerver közös állapota, az okkal együtt", () => {
    const item = job({
      commonStatus: "DONE",
      commonReason: "AWAITING_SIGNATURE",
    });
    expect(serviceWorkStatusLabel(item)).toBe("Elkészült · aláírásra vár");
    expect(serviceWorkStatusTone(item)).toBe("green");
  });

  it("régi válasznál (közös mező nélkül) a tárolt állapot neve", () => {
    expect(serviceWorkStatusLabel(job())).toBe("Folyamatban");
  });

  it("a munkalap a saját megjelenítő állapotát viszi, közös mezőt nem olvas", () => {
    expect(
      serviceWorkStatusLabel({
        ...job(),
        kind: "WORKSHEET",
        status: "IN_PROGRESS",
        commonStatus: "CLOSED",
      }),
    ).not.toBe("Lezárt");
  });

  it("a munkalap-tétel a közös szavakat kapja a megjelenített állapotából (Elkészült · aláírásra vár, Lezárt, Folyamatban · elutasítva)", () => {
    const sheet = (status: string) =>
      ({ ...job(), kind: "WORKSHEET", status }) as MyServiceWorkItem;
    expect(serviceWorkStatusLabel(sheet("NEW"))).toBe("Új");
    expect(serviceWorkStatusLabel(sheet("COMPLETED"))).toBe(
      "Elkészült · aláírásra vár",
    );
    expect(serviceWorkStatusTone(sheet("COMPLETED"))).toBe("green");
    expect(serviceWorkStatusLabel(sheet("CLOSED"))).toBe("Lezárt");
    expect(serviceWorkStatusTone(sheet("CLOSED"))).toBe("neutral");
    expect(serviceWorkStatusLabel(sheet("REJECTED"))).toBe(
      "Folyamatban · elutasítva",
    );
    expect(serviceWorkStatusTone(sheet("REJECTED"))).toBe("red");
  });
});
