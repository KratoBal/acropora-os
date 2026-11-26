import { describe, expect, it } from "vitest";

import {
  commonStateOfDisplayStatus,
  worksheetCommonState,
  worksheetDisplayLabel,
  worksheetDisplayPilotVariant,
  worksheetReasonText,
  worksheetStatusLabel,
  worksheetVersionLabel,
} from "./worksheet-labels";

/*
  A MUNKALAP SZAVAI A KÖZÖS SZÓTÁRBÓL (kártya 7f23785c, acrobot 62402). MI PIROSÍT: ha az aláírt lap Lezárva (a közös: Lezárt); ha az elutasított lap
  külön állapot, nem „Folyamatban", „elutasítva" okkal (és piros); ha az aláírásra váró lap az ok nélkül Elkészült; ha a piszkozat tétel nélkül és tétellel
  ugyanazt mondja; ha a szerver mezője nem előz a levezetésnek; ha a megjelenített állapot kulcsából (Feladataim, üzenetek) más szó jön, mint a
  változat-állapotból; ha egy ismeretlen vagy prototípus-kulcs szót kap; ha a fül és a verziótörténet szava eltér a sor jelvényétől.
*/
describe("worksheetCommonState", () => {
  it("a változat-állapotból és a tételszámból áll elő, az okkal", () => {
    const state = (
      status: Parameters<typeof worksheetCommonState>[0]["status"],
      lineCount: number,
    ) => worksheetCommonState({ status, lineCount });
    expect(state("DRAFT", 0)).toEqual({ status: "NEW", reason: null });
    expect(state("DRAFT", 3)).toEqual({ status: "IN_PROGRESS", reason: null });
    expect(state("REJECTED", 3)).toEqual({
      status: "IN_PROGRESS",
      reason: "REJECTED",
    });
    expect(state("AWAITING_SIGNATURE", 3)).toEqual({
      status: "DONE",
      reason: "AWAITING_SIGNATURE",
    });
    expect(state("SIGNED", 3)).toEqual({ status: "CLOSED", reason: null });
  });

  it("a válasz saját közös állapota előz, ha hozza", () => {
    expect(
      worksheetCommonState({
        status: "DRAFT",
        lineCount: 0,
        commonStatus: "WAITING",
        commonReason: "PARTS",
      }),
    ).toEqual({ status: "WAITING", reason: "PARTS" });
  });
});

describe("a jelvény szavai", () => {
  it("a szó és az ok szövege", () => {
    expect(worksheetDisplayLabel("SIGNED", 3)).toBe("Lezárt");
    expect(worksheetDisplayLabel("REJECTED", 3)).toBe("Folyamatban");
    expect(worksheetDisplayLabel("AWAITING_SIGNATURE", 3)).toBe("Elkészült");
    expect(
      worksheetReasonText(
        worksheetCommonState({ status: "REJECTED", lineCount: 1 }),
      ),
    ).toBe("elutasítva");
    expect(
      worksheetReasonText(
        worksheetCommonState({ status: "AWAITING_SIGNATURE", lineCount: 1 }),
      ),
    ).toBe("aláírásra vár");
    expect(
      worksheetReasonText(
        worksheetCommonState({ status: "SIGNED", lineCount: 1 }),
      ),
    ).toBeNull();
  });

  it("az elutasított jelvény piros, a többi a hibajegy színe (Új kék, Folyamatban türkiz, Elkészült zöld, Lezárt szürke)", () => {
    expect(worksheetDisplayPilotVariant("REJECTED", 2)).toBe("danger");
    expect(worksheetDisplayPilotVariant("DRAFT", 0)).toBe("blue");
    expect(worksheetDisplayPilotVariant("DRAFT", 2)).toBe("teal");
    expect(worksheetDisplayPilotVariant("AWAITING_SIGNATURE", 2)).toBe(
      "success",
    );
    expect(worksheetDisplayPilotVariant("SIGNED", 2)).toBe("grey");
  });
});

describe("a tételszám nélküli helyek (fül, verziótörténet, lap-kártya)", () => {
  it("az aláírt változat Lezárt, a piszkozat a mai Új és folyamatban", () => {
    expect(worksheetStatusLabel.SIGNED).toBe("Lezárt");
    expect(worksheetStatusLabel.DRAFT).toBe("Új és folyamatban");
    expect(worksheetVersionLabel("DRAFT")).toBe("Új és folyamatban");
    expect(worksheetVersionLabel("AWAITING_SIGNATURE")).toBe("Elkészült");
    expect(worksheetVersionLabel("SIGNED")).toBe("Lezárt");
    expect(worksheetVersionLabel("REJECTED")).toBe("Folyamatban");
  });
});

describe("commonStateOfDisplayStatus", () => {
  it("a megjelenített állapot kulcsából ugyanaz a szó, mint a változat-állapotból", () => {
    expect(commonStateOfDisplayStatus("NEW")).toEqual(
      worksheetCommonState({ status: "DRAFT", lineCount: 0 }),
    );
    expect(commonStateOfDisplayStatus("IN_PROGRESS")).toEqual(
      worksheetCommonState({ status: "DRAFT", lineCount: 1 }),
    );
    expect(commonStateOfDisplayStatus("COMPLETED")).toEqual(
      worksheetCommonState({ status: "AWAITING_SIGNATURE", lineCount: 1 }),
    );
    expect(commonStateOfDisplayStatus("CLOSED")).toEqual(
      worksheetCommonState({ status: "SIGNED", lineCount: 1 }),
    );
    expect(commonStateOfDisplayStatus("REJECTED")).toEqual(
      worksheetCommonState({ status: "REJECTED", lineCount: 1 }),
    );
  });

  it("ismeretlen vagy prototípus-kulcsra null (a hívó a mai tartalékot adja)", () => {
    for (const key of ["", "NO_SUCH", "toString", "constructor", "__proto__"]) {
      expect(commonStateOfDisplayStatus(key)).toBeNull();
    }
  });
});
