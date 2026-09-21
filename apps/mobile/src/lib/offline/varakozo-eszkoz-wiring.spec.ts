import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A SORBAN ALLO FELVITEL A LISTAN -- BEKOTES, FORRAS SZINTEN.
 *
 * MIERT NEM RENDERELESSEL: az `apps/mobile` alatt nincs komponens-teszt eszkoz.
 * A DONTES (mi kerul a listara, milyen sorrendben) valodi allitasokkal all a
 * `varakozo-eszkozok.spec.ts`-ben; itt csak az van, hogy a kepernyok tenyleg
 * azt hivjak.
 */
const gyoker = join(__dirname, "..", "..", "..", "src", "app", "assets");
const URLAP = join(gyoker, "new.tsx");
const LISTA = join(gyoker, "index.tsx");

const kod = (ut: string) =>
  readFileSync(ut, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("offline mentés után a lista", () => {
  it("POZITÍV KONTROLL: mind a két képernyő olvasható és nem üres", () => {
    for (const ut of [URLAP, LISTA])
      assert.ok(readFileSync(ut, "utf8").length > 2000);
  });

  /**
   * A SIKERES SORBA TETEL UTAN VISSZALEPUNK A LISTARA, es az ellenorzo mondat
   * ATMEGY oda.
   *
   * Balazs jelentese: "nem lep vissza az elozo kepernyore... semmi
   * visszajelzes nincs". Az eddigi ag itt MARADT, es egy borostyan dobozt irt
   * a gorgetheto lap aljara.
   *
   * MI PIROSIT: a regi `setQueued` alak visszaterese, vagy egy uzenet nelkuli
   * visszalepes -- az utobbi elvinne azt az informaciot, hany eszkoz ellen
   * ellenoriztunk.
   */
  it("a sorba tétel után a lista jön, a mondattal együtt", () => {
    const s = kod(URLAP);
    assert.match(
      s,
      /router\.replace\(\{\s*pathname: "\/assets",\s*params: \{ varakozoUzenet: outcome\.message \},?\s*\}\)/,
    );
    assert.ok(!/setQueued/.test(s), "a régi, helyben maradó ág visszatért");
  });

  /**
   * A SORBA TETEL BUKASA NEM MENT, ES NEM IS LEP VISSZA.
   *
   * Ilyenkor a felvitel SEHOL nincs (tele lemez, serult adatbazis). Egy
   * visszalepes ugyanazt mutatna, mint a siker, es a szerelo tovabbmenne.
   *
   * MI PIROSIT: egy kozos `router.replace` a ket agra. A szam azert allitas,
   * mert EGY visszalepes van a mentes-agban (a `saved`), plusz EGY a
   * `queued`-ben -- egy harmadik csak a hibas agbol johetne.
   */
  it("a sorba tétel bukása nem lép vissza", () => {
    const s = kod(URLAP);
    const db = s.split("router.replace(").length - 1;
    assert.equal(
      db,
      2,
      `${db} visszalépés van; a sikeres mentés és a sorba tétel ágán EGY-EGY`,
    );
    assert.match(s, /setError\(\{ field: null, message: outcome\.message \}\)/);
  });

  /**
   * A LISTA A SORBOL OLVAS, NEM EGY MASODIK NYILVANTARTASBOL.
   *
   * Ugyanaz a tabla, amibol a kiurites dolgozik. Egy kulon lista ket helyen
   * allo igazsagot csinalna, es az elcsuszasuk nema lenne: a szerelo egy mar
   * felment eszkozt latna varakozokent, vagy forditva.
   */
  it("a lista a szinkron-sorból veszi a várakozókat", () => {
    const s = kod(LISTA);
    assert.match(s, /queryFn: pendingQueueRows/);
    assert.match(s, /varakozoEszkozok\(sorbanAllok\.data \?\? \[\]\)/);
  });

  /**
   * A VARAKOZO SOR NEM UGY NEZ KI, MINT A TOBBI, ES NEM IS KATTINTHATO.
   *
   * Balazs epp azt panaszolta, hogy nem tudja, sikerult-e. Egy sor, ami
   * ugyanugy nez ki, mint a kesz eszkozok, MASIK hazugsag ugyanarrol. Es
   * adatlapja meg nincs: az azonositot a szerver adja a felmenetelkor, tehat
   * egy kattintas ures kepernyore vinne.
   */
  it("a várakozó sor megjelölt, és nem visz adatlapra", () => {
    const s = kod(LISTA);
    assert.match(s, /FELTÖLTÉSRE VÁR/);
    const sorRajzolo = s.match(
      /sor\.fajta === "varakozo" \? \([\s\S]*?\) : \(/,
    );
    assert.ok(sorRajzolo, "nem találom a várakozó sor ágát");
    assert.ok(
      !/onPress/.test(sorRajzolo[0]),
      "a várakozó sor kattintható, holott még nincs adatlapja",
    );
  });

  /**
   * KERESES KOZBEN A VARAKOZOK KIESNEK: a talalati lista kulonben mast
   * allitana, mint a felirata.
   */
  it("keresés közben a várakozók nem jelennek meg", () => {
    assert.match(kod(LISTA), /varakozok: search\.trim\(\) \? \[\] : varakozok/);
  });
});
