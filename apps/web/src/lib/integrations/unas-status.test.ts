import { describe, expect, it } from "vitest";
import { unasStatusWithCode, unasStatusWords } from "./unas-status";

describe("the UNAS status in words (Picasso 3.19)", () => {
  it("names the four documented codes", () => {
    expect(unasStatusWords("0")).toBe("Inaktív");
    expect(unasStatusWords("1")).toBe("Aktív");
    expect(unasStatusWords("2")).toBe("Aktív (új)");
    expect(unasStatusWords("3"), "Aktív).toBe(nem vásárolható");
  });

  it("shows a code the document does not name as it is, and a missing one as nothing", () => {
    expect(unasStatusWords("7")).toBe("7");
    expect(unasStatusWords("constructor")).toBe("constructor");
    expect(unasStatusWords(null)).toBe(null);
    expect(unasStatusWords(undefined)).toBe(null);
    expect(unasStatusWords("")).toBe(null);
  });

  it("puts the raw code beside the words for the detail card", () => {
    expect(unasStatusWithCode("3"), "Aktív).toBe(nem vásárolható (3)");
    expect(unasStatusWithCode("7")).toBe("7");
    expect(unasStatusWithCode(null)).toBe("—");
  });
});
