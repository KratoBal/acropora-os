import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * MINDEN BESOROLAS SZAMIT -- ES MA SEMMI NEM ORZI EZT.
 *
 * === A MERT SZAMOK, ES MIERT EPP EZ A HIBA VESZELYES ===
 *
 * A WYSIWYG szabaly HELYES alakja: a kategoria RESZFAJA, plusz MINDEN
 * besorolas, az elsodleges es az alternativ egyarant. Acrobot es polip merese
 * (2026-09-04, teszt adatbazis plusz UNAS forras):
 *
 *   reszfa PLUSZ minden besorolas   6 termek   HELYES
 *   csak az ELSODLEGES besorolas    2 termek   negy kimarad
 *
 * A hat termekbol NEGYNEL a WYSIWYG csak ALTERNATIV besorolaskent all. Egy
 * `where: { isPrimary: true }` tehat a hatbol kettot hagyna meg -- es a
 * maradek negy CSENDBEN elore rendelheto lenne, jelzo nelkul, "Eladva" allapot
 * nelkul. A kirakat oldalan ez azt jelenti, hogy egy egyedi peldanyt ket vevo
 * is megvehet.
 *
 * === MIERT A FORRAST OLVASSA, ES MIT NEM BIZONYIT ===
 *
 * A szabaly maga tiszta fuggveny, es sajat allitasai vannak
 * (`medusa-wysiwyg.policy.spec.ts`). A RES nem ott van: a fuggveny azt kapja,
 * amit a HIVO lekerdez. Ha a lekerdezes szukul, a szabaly tovabbra is helyesen
 * mukodik -- csak keves soron.
 *
 * Ezt egy valodi adatbazisos allitas merne a legjobban, es azt itt NEM tudom
 * megirni ugy, hogy kalibralni is tudjam: ehhez a fejlesztoi Postgres kellene,
 * ami ezen a gepen nem fut. Egy orzo, amit nem tudok elbuktatni, ugyanaz a
 * fajta diszlet, mint egy merce, ami nem tud elbukni.
 *
 * Ezert ez a fajl azt meri, AMIT MEG TUD: a ket lekerdezes ALAKJAT. Amit NEM
 * bizonyit: hogy az adatbazis tenylegesen mindket besorolast visszaadja.
 *
 * A brittlesegre egy szo: a ket keresett darab formazott kod, es a
 * `format:check` kapu tartja stabilan. Ha valaki ujraformaz, ez pirosodik --
 * es akkor a javitas az, hogy a keresett darabot igazitjuk, nem az, hogy
 * toroljuk az orzot.
 */

const VETITES = "src/integrations/medusa/medusa-projection.runner.ts";
const KESZLET_CLI = "src/integrations/medusa/medusa-inventory.cli.ts";

/** A vetites termek-lekerdezesenek kategoria-resze, szukites nelkul. */
const VETITES_KATEGORIAK = "categories: { select: { categoryId: true } },";

describe("a WYSIWYG szabaly minden besorolast lat", () => {
  /**
   * ISMERT POZITIV KONTROLL, ES ITT NEM FORMASAG: ha a ket fajl utja elcsuszik
   * (atnevezes, mappa-mozgatas), a `readFileSync` dobna -- de egy ures vagy
   * mas fajl NEM dobna, csak csendben atengedne mindent. Ezert allitunk arra
   * is, hogy TENYLEG ez a ket fajl van a kezunkben.
   */
  it("a ket hivo olvashato, es tenyleg a WYSIWYG szabalyt hasznalja", () => {
    const vetites = readFileSync(VETITES, "utf8");
    const cli = readFileSync(KESZLET_CLI, "utf8");

    assert.match(vetites, /isWysiwygProduct\(/);
    assert.match(cli, /decideWysiwygBackorder\(/);
    assert.ok(
      vetites.length > 10_000 && cli.length > 5_000,
      "A fajlok gyanusan rovidek: valoszinuleg nem azt olvasom, amit hiszek.",
    );
  });

  /**
   * A VETITES OLDALA. A kategoria-valasztas szukites NELKUL all: a `select`
   * mellett nincs `where`. Ha valaki elsodlegesre szukiti, ez a darab eltunik.
   */
  it("a vetites minden besorolast lekerdez, nem csak az elsodlegest", () => {
    const vetites = readFileSync(VETITES, "utf8");

    assert.ok(
      vetites.includes(VETITES_KATEGORIAK),
      `Nem talaltam a szukitetlen kategoria-valasztast a vetitesben.\n` +
        `Keresett darab: ${VETITES_KATEGORIAK}\n` +
        `Ha ez szandekos valtozas volt: a hatbol kettore szukul a WYSIWYG halmaz.`,
    );
  });

  /**
   * A KESZLET-PARANCS OLDALA. Itt a besorolasokat kulon lekerdezes hozza, es
   * annak a `where` resze CSAK a termek-azonositora szur.
   */
  it("a keszlet-parancs minden besorolast lekerdez", () => {
    const cli = readFileSync(KESZLET_CLI, "utf8");

    const kezd = cli.indexOf("database.productCategory.findMany({");
    assert.ok(kezd > -1, "Nem talaltam a besorolas-lekerdezest a parancsban.");
    const blokk = cli.slice(kezd, cli.indexOf("});", kezd));

    // Pozitiv kontroll: tenyleg a besorolas-lekerdezest fogtam meg.
    assert.match(blokk, /productId:/);
    assert.match(blokk, /categoryId: true/);

    assert.ok(
      !blokk.includes("isPrimary"),
      "A besorolas-lekerdezes az elsodlegesre szukit. A hat WYSIWYG termekbol " +
        "ketto maradna, es a masik negy csendben elore rendelheto lenne.",
    );
  });
});
