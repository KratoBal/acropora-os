import { describe, expect, it } from "vitest";

import {
  closeBlockedSentence,
  commonPilotVariant,
  commonReasonText,
  serviceJobStepLabel,
} from "./common-status-view";

const sheet = (
  status: "DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED",
  handedOverAt: string | null = null,
) => ({ status, handedOverAt });

describe("serviceJobStepLabel: a gomb felirata ige", () => {
  it("a várakozásból folytatás, újból megkezdés", () => {
    expect(serviceJobStepLabel("WAITING_FOR_PARTS", "IN_PROGRESS")).toBe(
      "Folytatás",
    );
    expect(serviceJobStepLabel("NEW", "IN_PROGRESS")).toBe("Munka megkezdése");
    expect(serviceJobStepLabel("IN_PROGRESS", "COMPLETED")).toBe("Lezárás");
    expect(serviceJobStepLabel("NEW", "CANCELLED")).toBe(
      "Meghiúsultnak jelölés",
    );
    expect(serviceJobStepLabel("NEW", "WAITING_FOR_CUSTOMER")).toBe(
      "Várakoztatás: ügyfélre",
    );
  });
});

describe("closeBlockedSentence: csak ott halvány, ahol a kapu biztosan nem enged", () => {
  it("munkalap nélküli Folyamatban jegynél nincs akadály (a kapu átengedi)", () => {
    expect(
      closeBlockedSentence({ status: "IN_PROGRESS", reason: null }, []),
    ).toBeNull();
  });

  it("a lezárható Elkészültnél nincs akadály", () => {
    expect(
      closeBlockedSentence({ status: "DONE", reason: "READY_TO_CLOSE" }, [
        sheet("SIGNED", "2026-11-25T10:00:00.000Z"),
      ]),
    ).toBeNull();
  });

  /*
    A REJTETT LAP A KÖZÖS ÁLLAPOTBAN BENNE VAN, A LÁTHATÓ LISTÁBAN NINCS: ha a
    látható lapok mind aláírtak, a szám nulla volna. A mondat ilyenkor szám
    nélkül mondja ki az akadályt, nem azt, hogy „0 munkalap".
  */
  it("ha csak rejtett lap tart vissza, a mondat szám nélkül áll", () => {
    expect(
      closeBlockedSentence({ status: "DONE", reason: "AWAITING_SIGNATURE" }, [
        sheet("SIGNED"),
      ]),
    ).toBe("Még nem zárható le: van aláíratlan munkalap.");
    expect(
      closeBlockedSentence({ status: "IN_PROGRESS", reason: null }, [
        sheet("SIGNED", "2026-11-25T10:00:00.000Z"),
      ]),
    ).toBe("Még nem zárható le: van befejezetlen munkalap.");
  });
});

describe("a jelvény színe és oka", () => {
  it("az öt állapot öt különböző színt kap", () => {
    const variants = (
      ["NEW", "IN_PROGRESS", "WAITING", "DONE", "CLOSED"] as const
    ).map((status) => commonPilotVariant({ status, reason: null }));
    expect(new Set(variants).size).toBe(5);
  });

  it("a karbantartás Lezártja kimondja, hogy minden lap aláírva; a hibajegyé nem", () => {
    const closed = { status: "CLOSED" as const, reason: null };
    expect(commonReasonText(closed, "MAINTENANCE")).toBe(
      "minden munkalap aláírva",
    );
    expect(commonReasonText(closed, "REPAIR")).toBeNull();
  });
});
