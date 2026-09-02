import { describe, expect, it } from "vitest";

import {
  batchCsv,
  batchFileName,
  batchSummaryLine,
  batchTimestampLabel,
} from "./asset-label-batches";

describe("a matricakiadás listája", () => {
  it("percre pontos időpontot mutat", () => {
    // MI PIROSIT: ha valaki nap-pontossagra egyszerusiti. Ket, egy percen
    // belul inditott generalas akkor egyformanak latszana a listan, es a
    // veletlen dupla kattintas ELTUNNE -- pont az, amit latni akarunk.
    const cimke = batchTimestampLabel("2026-09-02T20:41:00.000Z");
    expect(cimke).toMatch(/2026\. 09\. 02\. \d{2}:\d{2}$/);
  });

  it("hibás időpontot nem hallgat el", () => {
    // Egy ures sztring vagy egy "Invalid Date" csendben ures cellat adna, es a
    // sor ugy nezne ki, mintha nem lenne idopontja.
    expect(batchTimestampLabel("ez nem dátum")).toBe("ismeretlen időpont");
  });

  it("a fájlnév tételenként különbözik", () => {
    const a = batchFileName("abcdef1234", "2026-09-02T20:41:00.000Z");
    const b = batchFileName("999999zzzz", "2026-09-02T20:41:00.000Z");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^matricak-2026-09-02-abcdef12\.csv$/);
  });

  it("a letöltés a közös formátumot adja", () => {
    // ISMERT POZITIV KONTROLL: nem azt allitjuk, hogy "van tartalom", hanem
    // hogy a MERT formatum jon -- BOM-mal es CRLF-fel.
    const csv = batchCsv(["V2196"]);
    expect(csv.codePointAt(0)).toBe(0xfeff);
    expect(csv).toContain("V2196;V2196\r\n");
  });

  it("a szabad darabszám mellé kiírja, mit jelent", () => {
    const sor = batchSummaryLine({
      id: "b1",
      createdAt: "2026-09-02T20:41:00.000Z",
      count: 10,
      freeCount: 3,
    });
    // MIERT NEM ELEG A SZAM: a "3 szabad" azt is jelenthetne, hogy harom van
    // kinyomtatva. A szam a REGISZTRACIOBOL jon.
    expect(sor).toContain("10 kód");
    expect(sor).toContain("3 még nincs eszközhöz rendelve");
  });
});
