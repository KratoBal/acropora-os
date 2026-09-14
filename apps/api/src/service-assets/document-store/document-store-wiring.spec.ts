import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

/**
 * AKI A TAROLOT KERI, MEG IS KAPJA -- ES EZT SEMMI NEM MERTE.
 *
 * === A MERT HIBA, AMIERT EZ A FAJL LETEZIK ===
 *
 * A `DOCUMENT_STORE` jelzot egyetlen modul allitja elo (`ServiceAssetsModule`),
 * es NEM exportalja; egyetlen modul sem `@Global` ebben az alkalmazasban
 * (merve 2026-09-14: nulla `@Global` az `apps/api/src` fan). Egy modul tehat
 * CSAK akkor kapja meg, ha maga is felveszi a providerei koze.
 *
 * A `WorksheetsModule` nem vette fel. A `WorksheetsService` `@Optional()`
 * alakban keri a tarolot, tehat NEM indulasi hiba lett belole: `undefined`-ot
 * kapott, es a munkalap-fenykep feltoltese ELESBEN 503-at adott, a
 * KORNYEZETET nevezve meg -- holott a kornyezet rendben volt.
 *
 * === MIERT NEM VETTE ESZRE SENKI ===
 *
 * Mert nincs olyan teszt, ami a modult ALLITJA OSSZE. A
 * `worksheet-document.spec.ts` kozvetlenul adja at a tarolot a
 * konstruktornak, tehat ott mindig van -- a BEKOTES pontosan az a lepes, amit
 * a szolgaltatas-szintu teszt kihagy.
 *
 * === MIERT A FORRAST OLVASSA ===
 *
 * Futasidoben ugyanezt merni annyit tenne, hogy minden modult fel kell
 * epiteni egy Nest teszt-kornyezetben -- a repoban ma nincs `@nestjs/testing`
 * hasznalat (merve: nulla talalat). A forras-olvasas egy korben megnezi
 * mindet, es akkor is szol, ha az UJ modulhoz ma meg nincs teszteset.
 *
 * ES A LISTA GEPI, NEM KEZZEL IRT: a modulok a fabol jonnek, a providerek
 * pedig a modul SAJAT import-soraibol. Egy kezzel irt lista pontosan az uj
 * modult hagyna ki -- azt, amiert ez a mero letezik.
 */

const GYOKER = "src";

function fajlok(konyvtar: string, vege: string): string[] {
  const talalt: string[] = [];
  for (const bejegyzes of readdirSync(konyvtar, { withFileTypes: true })) {
    const ut = join(konyvtar, bejegyzes.name);
    if (bejegyzes.isDirectory()) talalt.push(...fajlok(ut, vege));
    else if (bejegyzes.name.endsWith(vege)) talalt.push(ut);
  }
  return talalt;
}

/**
 * A modul SAJAT import-soraibol: melyik nev melyik fajlbol jon.
 *
 * A MASIK MODULOK KIMARADNAK, es ez nem szures, hanem a szabaly alakja: egy
 * modul a SAJAT providereinek allit elo jelzoket. Hogy egy beagyazott modulnak
 * mire van szuksege, az ANNAK a modulnak a dolga -- es ott ugyanez a mero
 * kerdezi szamon.
 */
function importaltFajlok(modul: string): string[] {
  const forras = readFileSync(modul, "utf8");
  const utak: string[] = [];
  for (const sor of forras.matchAll(/from "(\.[^"]+)\.js"/g)) {
    const ut = resolve(dirname(modul), `${sor[1]!}.ts`);
    if (!ut.endsWith(".module.ts")) utak.push(ut);
  }
  return utak;
}

/**
 * A MEGJEGYZESEK NELKULI FORRAS.
 *
 * MERT LEPES, NEM OVATOSSAG: az elso valtozat a nyers szovegben kereste az
 * injektalast, es azonnal HAMIS talalatot adott -- a `worksheets.module.ts`
 * MEGJEGYZESEBEN all a `@Inject(DOCUMENT_STORE)` alak, mert epp azt magyarazza,
 * miert kellett a javitas. A mero a sajat dokumentaciojan sult el.
 */
function kodResze(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Azok a modulok, amikben egy importalt fajl a tarolot KERI. */
function tarolotKeroModulok(): string[] {
  return fajlok(GYOKER, ".module.ts").filter((modul) =>
    importaltFajlok(modul).some((fajl) => {
      let forras: string;
      try {
        forras = readFileSync(fajl, "utf8");
      } catch {
        // Nem minden import mutat letezo `.ts` fajlra (mappa-index, tipus).
        return false;
      }
      return kodResze(forras).includes("@Inject(DOCUMENT_STORE)");
    }),
  );
}

describe("a dokumentum-tároló bekötése", () => {
  /**
   * A KONTROLL A KERESESRE, es ez az allitas tartja a masikat.
   *
   * Egy bejaras, ami URES halmazt vet ossze egy szaballyal, ZOLDEN HAZUDIK:
   * nem talal bekotetlen modult, mert nem talal modult. Ha a fa alakja vagy az
   * injektalas irasmodja valtozik, ez a sor szol eloszor.
   */
  it("megtalálja a modulokat, amiket vizsgálni akar", () => {
    assert.ok(
      fajlok(GYOKER, ".module.ts").length >= 10,
      "Alig találtam modult a fában; a bejárás vagy a munkakönyvtár elavult.",
    );
    const kerok = tarolotKeroModulok();
    assert.ok(
      kerok.length >= 3,
      `Csak ${kerok.length} modul kéri a tárolót (${kerok.join(", ")}); a minta valószínűleg elavult.`,
    );
  });

  /**
   * A JELENLETET IS A KODBAN KELL KERESNI, NEM A SZOVEGBEN -- ES EZ MERT
   * TANULSAG, A MASODIK UGYANEBBEN A FAJLBAN.
   *
   * Az elso valtozat a modul NYERS szovegeben kereste a `documentStoreProvider`
   * nevet. A kalibracio (a provider ES az importja kivetele a
   * `worksheets.module.ts`-bol) ZOLD MARADT: a nev ott allt tovabbra is a modul
   * MEGJEGYZESEBEN, ami epp azt magyarazza, miert kellett a javitas.
   *
   * Vagyis a mero a bekotes MEGSZUNESET nem vette volna eszre, mert a rola
   * szolo mondat maradt a helyen. Egy hianyzo `kodResze` hivas pontosan azt az
   * agat tette volna diszletté, amiert a fajl letezik.
   */
  it("aki kéri, elő is állítja", () => {
    const hianyzik = tarolotKeroModulok().filter(
      (modul) =>
        !kodResze(readFileSync(modul, "utf8")).includes(
          "documentStoreProvider",
        ),
    );
    assert.deepEqual(
      hianyzik,
      [],
      `Ezekben a modulokban egy szolgáltatás KÉRI a DOCUMENT_STORE jelzőt, de a modul nem állítja elő: ${hianyzik.join(", ")}. Az @Optional() miatt ez NEM indulási hiba: a szolgáltatás undefined tárolót kap, és a feltöltés 503-at ad, a KÖRNYEZETET megnevezve.`,
    );
  });
});
