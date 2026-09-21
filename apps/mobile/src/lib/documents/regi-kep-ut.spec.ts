import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A NATÍV BETÖLTŐRE BÍZOTT KÉP-ÚT MEGSZŰNT -- MIND A HÁROM KÉPERNYŐN.
 *
 * === A MÉRT HIBA ===
 *
 * A böngésző `<img>` eleme és a React Native `Image` elemе EGYARÁNT nem küld
 * `Authorization` fejlécet a mi kérésünk helyett. Androidon ez 401-et adott,
 * és a kép ÜRES CSEMPEKÉNT állt ott: Balázs éles hibája, 2026-09-21, a
 * mérőeszközöm hozta vissza a készülékről a nyers üzenetet.
 *
 * A javítás a hibajegy képernyőjén készült el (#877), és Balázs a SAJÁT
 * készülékén igazolta: „a hibajegynel megjelenik a kep" (10:11:25 UTC).
 *
 * === AMIT EZ AZ ÁLLÍTÁS VÉD ===
 *
 * A régi horog (`useDocumentImageSource`) ezzel a körrel TÖRLŐDÖTT. Egy
 * megmaradt, használható modul azt jelentené, hogy a következő képernyő
 * ugyanazt a 401-et építi újra -- és a hiba NÉMA: a csempe megjelenik, csak
 * üresen.
 *
 * === A HATÁRA, KIMONDVA ===
 *
 * Ez a forrás SZÖVEGÉT olvassa. Egy másik néven újraírt, ugyanilyen horog
 * átcsúszna rajta -- ezt a fájl megléte elleni állítás sem fogná meg. Amit
 * mér: hogy EZ a modul és EZ a hívás ne térjen vissza.
 */
const gyoker = join(__dirname, "..", "..", "..", "src");
const KEPERNYOK = [
  join(gyoker, "app", "service-jobs", "[id].tsx"),
  join(gyoker, "app", "worksheets", "[id].tsx"),
  join(gyoker, "app", "assets", "[id].tsx"),
];

describe("a régi, natív betöltőre bízott kép-út", () => {
  /**
   * POZITÍV KONTROLL: mind a három képernyő olvasható, ÉS mind a három a
   * `DocumentImage`-et használja. Enélkül a lenti két negatív állítás akkor is
   * zöld lenne, ha a galériák eltűntek volna.
   */
  it("POZITÍV KONTROLL: mind a három képernyő a DocumentImage-et használja", () => {
    for (const ut of KEPERNYOK) {
      const s = readFileSync(ut, "utf8");
      assert.ok(s.length > 2000, `${ut}: üres vagy gyanúsan rövid`);
      assert.equal(
        s.split("<DocumentImage").length - 1,
        2,
        `${ut}: nem két helyen áll a hitelesített kép (csempe ÉS nagy nézet)`,
      );
    }
  });

  it("a régi horog modulja nincs többé", () => {
    assert.ok(
      !existsSync(
        join(gyoker, "lib", "documents", "use-document-image-source.ts"),
      ),
      "a régi kép-forrás horog visszakerült; a következő képernyő újraépítené vele a 401-et",
    );
  });

  it("egyik képernyő sem hívja a régi horgot", () => {
    for (const ut of KEPERNYOK)
      assert.ok(
        !/useDocumentImageSource\(/.test(readFileSync(ut, "utf8")),
        `${ut}: megint a natív betöltőre bízza a fejlécet`,
      );
  });
});
