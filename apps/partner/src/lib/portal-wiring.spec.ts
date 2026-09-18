import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A PARTNER PORTÁL BEKÖTÉSE.
 *
 * === EZ A CSOMAG ELSŐ TESZTJE, ÉS AMI A HELYÉN ÁLLT ===
 *
 * A `test` script 2026-09-17-ig `tsc --noEmit` volt, betűre ugyanaz, mint a
 * `typecheck`. A teszt-kapu tehát ZÖLDET adott úgy, hogy NULLA tesztet
 * futtatott, és ezt semmi nem mondta meg. A CI `pnpm test`-et hív, tehát a
 * zöld pipa is megvolt hozzá.
 *
 * === A HATÁR, KIMONDVA ===
 *
 * Ezek az állítások a FORRÁS SZÖVEGÉT olvassák: azt mérik, hogy a felület a
 * helyes hívásokat írja le, NEM azt, hogy a partner látja a képernyőt. Ehhez
 * nincs renderelő a csomagban, és ez a kör nem is vezet be egyet: a most kért
 * három állítás közül egyikhez sem kell renderelés.
 *
 * Ha egyszer renderelő kerül ide, ezeket VISELKEDÉSRE kell cserélni, nem
 * mellé tenni -- ugyanaz a kikötés, ami a mobil forrás-olvasó specjeiben áll.
 *
 * MINDEN MINTA A HÍVÁS ALAKJÁRA ILLESZT, NEM A PUSZTA NÉVRE: egy név-alapú
 * állítást az `import` sor zölden tartana.
 */
const KLIENS = "src/lib/api.ts";
const BEALLITASOK = "src/components/settings.tsx";
const DOKUMENTUMOK = "src/components/document-panel.tsx";
const BEJELENTO = "src/components/new-ticket.tsx";
const HIBAJEGY_RESZLET = "src/components/ticket-detail.tsx";

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("a partner portál bekötése", () => {
  it("POZITÍV KONTROLL: mind a három fájl olvasható és nem üres", () => {
    for (const ut of [KLIENS, BEALLITASOK, DOKUMENTUMOK])
      assert.ok(olvas(ut).length > 500, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * A JELENLEGI JELSZÓ IS ELMEGY, MIND A KÉT MŰVELETNÉL.
   *
   * MI PIROSÍT: ha a törzs csak az ÚJ értéket küldené. A szerver a jelenlegi
   * jelszót kéri igazolásként, tehát enélkül a hívás elbukna -- de a hiba a
   * partnernél "nem sikerült" alakban jelenne meg, és a mezőt ő töltötte ki,
   * tehát a saját gépelését gyanúsítaná.
   *
   * A DARABSZÁM SZÁMÍT: a `currentPassword` MIND A KÉT törzsben kell (a jelszó
   * és az aláírókód módosításánál). Egy jelenlét-illesztés zölden átengedné, ha
   * az egyikből kimaradna -- a másik tartaná életben.
   */
  it("a jelszó és az aláírókód módosítása is küldi a JELENLEGI jelszót", () => {
    const s = olvas(KLIENS);
    assert.match(
      s,
      /body: JSON\.stringify\(\{ currentPassword, newPassword \}\)/,
    );
    assert.match(
      s,
      /body: JSON\.stringify\(\{ currentPassword, signingCode \}\)/,
    );
    const db = s.split("currentPassword").length - 1;
    assert.equal(
      db,
      4,
      `a currentPassword ${db} helyen áll; mind a két hívásnál a paraméterben ÉS a törzsben kell`,
    );
  });

  /**
   * A KÉPERNYŐ IS ÁTADJA, NEM CSAK A KLIENS TUDJA FOGADNI.
   *
   * Ez külön állítás, és nem ismétlés: a kliens szerződése és a hívás helye két
   * különböző dolog. Egy űrlap, ami üres sztringet ad át, a fenti állítást
   * zölden hagyná.
   */
  it("a beállítások képernyő a begépelt jelenlegi jelszót adja át", () => {
    const s = olvas(BEALLITASOK);
    assert.match(s, /changePassword\(password\.current, password\.next\)/);
    assert.match(s, /changeSigningCode\(signing\.current, signing\.code\)/);
  });

  /**
   * AZ ALÁÍRÓKÓD NÉGY SZÁMJEGY -- ÉS A FELÜLET IS KIMONDJA.
   *
   * A `pattern` és a `maxLength` a böngészőnek szól; a MONDAT a partnernek. Ha
   * csak a technikai korlát áll ott, a partner egy néma elutasítást kap, és nem
   * tudja, hány számjegyet vár a mező.
   */
  it("az aláírókód mező négy számjegyet fogad el, és ez ki is van írva", () => {
    const s = olvas(BEALLITASOK);
    assert.match(s, /pattern="\[0-9\]\{4\}"/);
    assert.match(s, /maxLength=\{4\}/);
    /**
     * A SZÁM, ÉS NEM A PUSZTA JELENLÉT -- ÉS EZT A SAJÁT MÉRŐHELYEM FOGTA MEG,
     * MIELŐTT A KALIBRÁCIÓ ELBUKOTT VOLNA.
     *
     * A `négyjegyű` KÉT helyen áll, és mind a kettő kell: a magyarázó mondatban
     * (a kód módosításához a jelenlegi jelszó kell) ÉS a mező címkéjében. Egy
     * jelenlét-illesztés zölden átengedné bármelyik elvesztését -- kalibrálva:
     * a magyarázó mondatból kivéve a régi alak NEM pirosodott.
     */
    const db = s.split("négyjegyű").length - 1;
    assert.equal(
      db,
      2,
      `a "négyjegyű" ${db} helyen áll; a magyarázó mondatban ÉS a mező címkéjében is kell`,
    );
  });

  /**
   * A KÉP A LETÖLTÖTT BÁJTOKBÓL KÉSZÜL, NEM KÖZVETLEN VÉGPONT-HIVATKOZÁSSAL.
   *
   * MI PIROSÍT: egy `<img src={`${API}/documents/...`}>` alak. A böngésző azt a
   * kérést HITELESÍTÉS NÉLKÜL küldené, tehát 401-et kapna, és a kép üres
   * csempeként állna ott -- ugyanaz a néma hiba, amit a mobil galériáknál
   * mértünk.
   *
   * A #788 törzse ezt ÁLLÍTJA, de nem mérte. Ez az állítás méri.
   */
  it("a dokumentum-panel objektum-URL-t használ, nem közvetlen végpontot", () => {
    const s = olvas(DOKUMENTUMOK);
    assert.match(
      s,
      /URL\.createObjectURL\(await loader\.current\(item\.id\)\)/,
    );
    // ÉS A TÚLSÓ IRÁNY: a kép forrása a letöltött URL, nem egy összefűzött cím.
    assert.match(s, /<img src=\{urls\[item\.id\]\}/);
    assert.doesNotMatch(s, /<img[^>]*src=\{`/);
  });
});

describe("a bejelentő űrlap fájl-melléklete", () => {
  it("a bejelentő űrlapon VAN fájl-mező", () => {
    /*
      MI PIROSÍT: a mező elhagyása. 2026-09-18-ig nem is létezett -- csatolni
      csak a MÁR LÉTREJÖTT jegy adatlapján lehetett, tehát a bejelentőnek két
      lépésben kellett elmondania ugyanazt.

      A MINTA A MEZŐ ALAKJÁRA ILLESZT (`type="file"`), nem a "file" szóra: az
      utóbbit egy komment vagy egy változónév zölden tartaná.
    */
    assert.match(olvas(BEJELENTO), /type="file"/);
  });

  it("a feltöltés a MÁR LÉTREJÖTT jegy azonosítójára megy", () => {
    /*
      === MIÉRT EZ A LÉNYEG, ÉS NEM A MEZŐ MEGLÉTE ===

      A végpont a jegy azonosítójára ír, az azonosító pedig csak a létrehozás
      után létezik. Egy fájl-mező, ami a létrehozás ELŐTT próbálna feltölteni,
      ugyanúgy ott állna a képernyőn -- és soha nem csatolna semmit.

      A minta ezért a HÍVÁS ALAKJÁRA illeszt, a `created.id` argumentummal
      együtt: ez az, ami a sorrendet bizonyítja.
    */
    assert.match(olvas(BEJELENTO), /uploadTicketDocument\(\s*created\.id/);
  });
});

describe("a dokumentumcsomag letöltése", () => {
  it("a partner felületén a letöltés csak elkészült jegynél jelenik meg", () => {
    const s = olvas(HIBAJEGY_RESZLET);
    assert.match(s, /ticket\.partnerStatus === "COMPLETED"/);
    assert.match(s, /Dokumentumcsomag letöltése/);
  });
});
