import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A HAROM HIVOHELY NEM AD FAJTAT -- ES EZ AZ EGYETLEN HELY, AHOL EZ MERHETO.
 *
 * === MIERT NEM ELEG A `document-upload.spec.ts` KET ALLITASA ===
 *
 * Azok a BBUILDERT merik: kuldott tipus atmegy, hianyzo tipus nem kerul a
 * torzsbe. Mind a ketto helyes, es EGYIK SEM szol, ha valaki visszair egy
 * `type: "OTHER"` erteket egy HIVOHELYRE -- a builder akkor is pontosan azt
 * teszi, amit leir. A sajat fejlecük meg is nevezi ezt a rest.
 *
 * === MIERT KELL EGYALTALAN, ES MI TORTENT 2026-09-22-IG ===
 *
 * Az eszkoz-uton HAROM hivohelyen allt beegetett `type: "OTHER"`. Amig azok
 * mentek, a szerver bajt-alapu felismerese a telefonrol erkezo kepekre SOSEM
 * futott le: a kuldott ertek felulirta. A partner epp azokat a fenykepeket nem
 * latta, amikert a PHOTO fajta letezik.
 *
 * A HARMADIK HIVOHELY A LEGCSENDESEBB: az offline sor kiuritese
 * (`use-queue-drain.ts`) a HELYSZINEN, halozat nelkul keszult kepeket viszi
 * fel -- vagyis pont azokat, amiket a partner latni akar.
 *
 * === AMIT MER, ES AMIT SZANDEKOSAN NEM ===
 *
 * MER: hogy egyik eszkoz-hivas sem ad `type`-ot, es hogy a ket TESTVER
 * (munkalap, hibajegy) tovabbra is AD. A masodik nem dísz: nelkule ez az
 * allitas egy ures vagy atnevezett fajlon is zold lenne.
 *
 * NEM MER: hogy a szerver a helyes fajtat valasztja. Azt az api oldalan harom
 * allitas meri (`service-assets.controller.spec.ts`), valodi bajtokkal.
 *
 * ES A HATARA, KIMONDVA: ez SZOVEGET olvas. Egy valtozoba kiemelt vagy
 * feltetelesen osszerakott `type` atmenne rajta. A ma letezo harom hivas
 * mindegyike literalis objektumot ad at, tehat ma fedi oket -- ha valaki
 * atalakitja a hivas alakjat, ez az allitas NEM fog szolni, es akkor ujra kell
 * gondolni, hol mérjük.
 */
const HIVOHELYEK = [
  "src/app/assets/[id].tsx",
  "src/app/assets/new.tsx",
  "src/lib/offline/use-queue-drain.ts",
] as const;

/** A kommentek kikerulnek: a fajl jegyzete SZANDEKOSAN leirja a regi, hibas alakot. */
const kommentNelkul = (szoveg: string) =>
  szoveg.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function hivasTorzse(ut: string): string {
  const forras = kommentNelkul(readFileSync(ut, "utf8"));
  const kezd = forras.indexOf("uploadAssetDocuments(");
  assert.notEqual(
    kezd,
    -1,
    `kontroll: a ${ut} fajlnak hivnia KELL az uploadAssetDocuments-et`,
  );
  const nyito = forras.indexOf("(", kezd);
  let melyseg = 0;
  for (let i = nyito; i < forras.length; i += 1) {
    if (forras[i] === "(") melyseg += 1;
    else if (forras[i] === ")") {
      melyseg -= 1;
      if (melyseg === 0) return forras.slice(nyito, i + 1);
    }
  }
  throw new Error(`a ${ut} hivasa nem zarul le`);
}

describe("az eszkoz-dokumentum feltoltese nem mond fajtat", () => {
  for (const ut of HIVOHELYEK) {
    it(`${ut} NEM ad type-ot`, () => {
      assert.doesNotMatch(
        hivasTorzse(ut),
        /\btype\s*:/,
        "a fajtat a szerver dönti el a fájl bájtjaiból; egy itt megadott érték felülírja",
      );
    });
  }

  /**
   * ISMERT POZITIV KONTROLL: a kereses LAT tipus-kuldest.
   *
   * A ket testver SZANDEKOSAN ad fajtat, es ezt acrobot kulon kikototte
   * (2026-09-22): az alapertelmezesuk egy FELTETELEZESEN all (a telefonrol
   * erkezo feltoltes fenykep), nem a fajl tulajdonsagan. Ha ez a sor elbukik,
   * nem a testverek romlottak el -- a fenti harom nulla vesztette el az
   * ertelmet, mert a minta nem lat semmit.
   */
  it("KONTROLL: a ket testver-ut TOVABBRA IS ad fajtat", () => {
    for (const ut of [
      "src/lib/api/worksheets.ts",
      "src/lib/api/service-jobs.ts",
    ]) {
      assert.match(
        kommentNelkul(readFileSync(ut, "utf8")),
        /type:\s*"PHOTO"/,
        `${ut}: a testver-ut allando fajtat kuld, es ez tudatos`,
      );
    }
  });
});
