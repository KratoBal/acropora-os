import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  archiveOfIssuedSheet,
  sheetToRegenerate,
  type IssuedSheetRow,
} from "./worksheet-sheet-regeneration.js";

/*
  EGY LEZÁRT LAP PDF-JÉNEK ÚJRAGENERÁLÁSA (Balázs 2026-11-18 19:17 UTC, kártya 47e07a53; acrobot 56321): a kiadott lap a lezáráskor tárolódik, és a #2688 előtti lapokon a régi elrendezést őrzi. A gomb ugyanabból a verzióból új bájtokat ír, a régi
  példány visszakereshető marad. MI PIROSÍT: ha egy piszkozat verziójához is újragenerálna; ha egy aláírt verzió a lezáráskori (aláírás előtti) sort írná át, amelyik az aláírást nem viselte; ha az aláírt verzió végleges lapja hiányzik, és ez nem kimondott ok;
  ha az aláíratlan lezárt verzió nem a lezáráskori sort választja; ha az archív példány a régi nevét, SHA-ját vagy eredeti idejét elveszti, vagy a felirat nem mondja ki az újragenerálás idejét és kezdeményezőjét.
*/
function row(
  type: IssuedSheetRow["type"],
  over: Partial<IssuedSheetRow> = {},
): IssuedSheetRow {
  return {
    id: `doc-${type}`,
    type,
    fileName: "munkalap-NMD-2026-028.pdf",
    sha256: `sha-${type}`,
    createdAt: new Date("2026-09-20T10:00:00.000Z"),
    ...over,
  };
}

describe("melyik kiadott sort írjuk újra", () => {
  it("a piszkozat verziójához nem: a lap lezáráskor születik", () => {
    assert.deepEqual(
      sheetToRegenerate({ status: "DRAFT", closedAt: null }, []),
      { ok: false, reason: "NOT_CLOSED" },
    );
  });

  it("az aláíratlan lezárt verziónál a lezáráskori sor jön", () => {
    for (const status of ["AWAITING_SIGNATURE", "REJECTED"] as const) {
      const result = sheetToRegenerate({ status, closedAt: "2026-09-20" }, [
        row("GENERATED_SHEET"),
      ]);
      assert.ok(result.ok, status);
      assert.equal(result.row.type, "GENERATED_SHEET");
    }
  });

  it("az aláírt verziónál a VÉGLEGES sor jön, a lezáráskori érintetlen marad", () => {
    const result = sheetToRegenerate(
      { status: "SIGNED", closedAt: "2026-09-20" },
      [row("GENERATED_SHEET"), row("SIGNED_SHEET")],
    );
    assert.ok(result.ok);
    assert.equal(result.row.type, "SIGNED_SHEET");
  });

  it("aláírt verzió végleges lap nélkül nem a lezáráskori sort írja át", () => {
    assert.deepEqual(
      sheetToRegenerate({ status: "SIGNED", closedAt: "2026-09-20" }, [
        row("GENERATED_SHEET"),
      ]),
      { ok: false, reason: "SIGNED_SHEET_MISSING" },
    );
  });

  it("lezárt verzió kiadott lap nélkül: kimondott ok, nem néma siker", () => {
    assert.deepEqual(
      sheetToRegenerate(
        { status: "AWAITING_SIGNATURE", closedAt: "2026-09-20" },
        [],
      ),
      { ok: false, reason: "NO_SHEET" },
    );
  });
});

describe("a régi példány archívuma", () => {
  const at = "2026-11-18 20:40";

  it("megtartja az eredeti időt, a hashet és a nevet, és kimondja, mikor és ki generálta újra", () => {
    const old = row("GENERATED_SHEET");
    const archive = archiveOfIssuedSheet(old, { at, byName: "Kovács Anna" });
    assert.equal(
      archive.fileName,
      "munkalap-NMD-2026-028 (korábbi elrendezés).pdf",
    );
    assert.equal(archive.createdAt.getTime(), old.createdAt.getTime());
    assert.match(archive.caption, /korábbi elrendezés/i);
    assert.ok(archive.caption.includes(at));
    assert.ok(archive.caption.includes("Kovács Anna"));
    assert.ok(archive.caption.length <= 500);
  });

  it("a hosszú név a 120 karakteres határon belül marad, és a kiterjesztés .pdf", () => {
    const long = "munkalap-" + "x".repeat(200) + ".pdf";
    const archive = archiveOfIssuedSheet(
      row("SIGNED_SHEET", { fileName: long }),
      {
        at,
        byName: "Név",
      },
    );
    assert.ok(archive.fileName.endsWith(" (korábbi elrendezés).pdf"));
    assert.ok(archive.fileName.length <= 180);
  });

  it("a felirat 500 karakter alatt marad extrém hosszú névnél is", () => {
    const archive = archiveOfIssuedSheet(row("GENERATED_SHEET"), {
      at,
      byName: "N".repeat(900),
    });
    assert.ok(archive.caption.length <= 500);
    assert.ok(archive.caption.includes(at));
  });
});
