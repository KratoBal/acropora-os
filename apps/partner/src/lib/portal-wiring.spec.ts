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
const ESZKOZ_LISTA = "src/components/reference-lists.tsx";
const ESZKOZ_RESZLET = "src/components/asset-detail.tsx";
const ESZKOZ_UTVONAL = "src/app/(portal)/eszkozok/[id]/page.tsx";
const NAPLO_SOR = "src/lib/naplo-sor.ts";
const MUNKALAP_RESZLET = "src/components/worksheet-detail.tsx";

const olvas = (ut: string) => readFileSync(ut, "utf8");

/**
 * A FÁJL KÓDJA, A KOMMENTEK NÉLKÜL -- ÉS EZ NEM ÓVATOSSÁG.
 *
 * MÉRVE 2026-09-21, ebben a körben: a „nem kínálja a QR-cserét" állítás
 * PIROSRA ment, miközben a lap NEM kínálja. Az ok a saját fejléc-kommentem
 * volt, ami a `qr/rotate` végpontot IDÉZI, hogy elmagyarázza, miért nincs ott
 * gomb. Vagyis a jó magyarázat buktatta el a mérést.
 *
 * A jó komment épp azokat a szavakat használja, amiket a szöveg-alapú mérés
 * keres -- a kettő ugyanabból a forrásból jön. Ezért a komment-kiszedés az
 * ALAPÉRTELMEZÉS a hiány-állításoknál, nem a kivétel.
 *
 * A HATÁRA KIMONDVA: egy szöveges KONSTANS (például egy hibaüzenet), ami
 * idézi a keresett alakot, ugyanúgy találat marad. A kódra mérni több, mint a
 * kommenteket kiszedni.
 */
const kod = (ut: string) =>
  olvas(ut)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

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
    /*
      ÉS A TÚLSÓ IRÁNY: a kép forrása a letöltött URL, nem egy összefűzött cím.

      A MINTA 2026-09-21-EN ÁTÍRÓDOTT, ÉS A PIROS JOGOS VOLT. A korábbi alak
      a `<img src={urls[item.id]}` SORT illesztette, egy sorban. A csempe azóta
      gomb belsejébe került, a formázó pedig több sorra tördelte az `img`
      elemet -- a kód JOBB lett, az állítás pedig a tördelésre volt kötve.

      Az új alak a FORRÁS-MEGADÁST méri, nem a sortörést, és MIND A KETTŐT: a
      csempéét és a nagyított képét. A negatív ág a lényeg: sehol nincs
      sablon-sztringből összefűzött cím.
    */
    assert.match(s, /src=\{urls\[item\.id\]\}/);
    assert.match(s, /src=\{urls\[nagyitott\]\}/);
    assert.doesNotMatch(s, /src=\{`/);
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

  /**
   * === MIERT ALL ITT EZ A KET ALLITAS ===
   *
   * A helyszin-lista a HOZZARENDELESI tablabol tolt (`worksheets.service.ts`,
   * `assignedUnitIdsFor`), nem a vevo osszes alegysegebol. Egy hozzarendeles
   * nelkuli partner-fiok tehat URES valasztot kap -- es egy ures lista
   * kivulrol UGYANUGY NEZ KI, mint egy elromlott betoltes.
   *
   * MERVE (acrobot, eles adatbazis, 2026-09-22 20:5x): MA ket PARTNER_SERVICE
   * felhasznalo letezik, es MINDKETTONEK van helyszine, tehat ma senki nem esik
   * ebbe az allapotba. Ez ALLAPOT, nem garancia: egy uj partner-fiok
   * hozzarendeles NELKUL szuletik.
   *
   * MINDKET ALLITAS A `kod()`-ON MER, nem a nyers forrason: a fenti bekezdes
   * maga is tartalmazza a keresett szavakat, tehat a kommentek bent hagyasa
   * zolden tartana oket. Ez a fajl sajat, mert tanulsaga.
   */
  it("hozzárendelés nélküli partnernél a helyszín-doboz MEGNEVEZI az okot", () => {
    const s = kod(BEJELENTO);
    /*
      MI PIROSIT: ha a felirat felteteltol fuggetlenul all ott (akkor betoltes
      kozben is villanna, es epp a hibas allapotot utanozna), vagy ha a
      felteteles ag eltunik es a valaszto csendben ures marad.

      A `!loading` RESZE AZ ALLITASNAK: betoltes alatt a lista joggal ures.
    */
    assert.match(s, /!loading && locations\.length === 0 \?/);
    assert.match(s, /nincs helyszín rendelve/);
  });

  it("az eszköz-doboz KÜLÖN mondatot ad a hozzárendelés hiányára", () => {
    const s = kod(BEJELENTO);
    /*
      A KET ALLAPOT KET MONDAT, ES EZ NEM STILUS. Az "Előbb válasszon
      helyszínt" mondat annak szol, aki VALASZTHAT; hozzarendeles nelkul
      ugyanez zsakutca, mert arra keri a partnert, hogy valasszon valamit, ami
      nincs a listajaban.

      MI PIROSIT: ha valaki a ket agat visszavonja egy mondatba. A darabszam
      nem eleg hozza -- a KULONBSEGET kell allitani, tehat mind a ket mondat
      kulon szerepel.
    */
    assert.match(s, /nincs Önhöz rendelt helyszín/);
    assert.match(s, /Előbb válasszon helyszínt/);
  });
});

describe("a dokumentumcsomag letöltése", () => {
  it("a partner felületén a letöltés csak elkészült jegynél jelenik meg", () => {
    const s = olvas(HIBAJEGY_RESZLET);
    assert.match(s, /ticket\.partnerStatus === "COMPLETED"/);
    assert.match(s, /Dokumentumcsomag letöltése/);
  });
});

/**
 * AZ ESZKÖZ-ADATLAP ÉS A KÉT SZŰRŐ (6559eab5).
 *
 * Az öt állítás a feladatlap leadási mércéje. Mind a forrás szövegét olvassa,
 * a fenti fejléc határával együtt: azt mérik, hogy a felület a helyes hívásokat
 * írja le, NEM azt, hogy a partner mit lát a képernyőn.
 */
describe("a partner eszköz-adatlapja és szűrői", () => {
  it("POZITÍV KONTROLL: mind a három új fájl olvasható és nem üres", () => {
    for (const ut of [ESZKOZ_LISTA, ESZKOZ_RESZLET, ESZKOZ_UTVONAL])
      assert.ok(olvas(ut).length > 200, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * 1. A NÉGY ÍRÁSI MŰVELET NINCS AZ ADATLAPON -- MIND A NÉGY KÜLÖN NÉVVEL.
   *
   * A negatív állítás mellé a POZITÍV KONTROLL az 5. pont (a megmaradt
   * műveletek): enélkül ez a négy akkor is zöld lenne, ha az egész lap üres.
   */
  it("az adatlap nem kínálja a szerkesztést", () => {
    const s = kod(ESZKOZ_RESZLET);
    assert.ok(!/partnerApi\.updateAsset|method: "PATCH"/.test(s));
  });

  it("az adatlap nem kínálja a QR-cserét", () => {
    assert.ok(!/qr\/rotate/.test(kod(ESZKOZ_RESZLET)));
  });

  it("az adatlap nem kínálja a kivezetést", () => {
    assert.ok(!/archivedAt:|archiveAsset/.test(kod(ESZKOZ_RESZLET)));
  });

  it("az adatlap nem kínálja a végleges törlést", () => {
    assert.ok(!/method: "DELETE"|deleteAsset/.test(kod(ESZKOZ_RESZLET)));
  });

  /**
   * 2. IDEGEN AZONOSÍTÓRA NINCS KLIENS-OLDALI SZŰRÉS, mert a hatókört a
   * SZERVER szabja. Egy `customerId` a hívásban azt sugallná, hogy a
   * láthatóságot a hívó dönti el -- és a portál API-rétegének fejléce épp ezt
   * a hibát írja le egy korábbi körből.
   */
  it("az adatlap-hívás nem visz partner-azonosítót", () => {
    const s = kod(KLIENS);
    const hivas = s.match(/asset: \(id: string\) =>[\s\S]{0,200}?\),/);
    assert.ok(hivas, "nem találom az adatlap hívását");
    assert.ok(!/customerId|ownerId|ownerType/.test(hivas[0]));
  });

  /**
   * 3. A KERESŐ A SZERVERNEK ADJA ÁT A SZÓT. A lista lapozott: egy betöltött
   * oldal fölötti szűrés a lapozás első napján csendben hiányos lenne.
   */
  it("a kereső a szerver hívásába kerül, nem a betöltött lista fölé", () => {
    assert.match(
      olvas(KLIENS),
      /query\.set\("search", input\.search\.trim\(\)\)/,
    );
    /* ES A LISTA NEM SZUR HELYBEN: nincs `filter` a betoltott tetelek folott. */
    const lista = kod(ESZKOZ_LISTA);
    assert.ok(
      !/data\.items\.filter\(/.test(lista),
      "a lista a betöltött tételek fölött szűr",
    );
  });

  /**
   * 4. A HELYSZÍN-SZŰRŐ AZ AZONOSÍTÓT KÜLDI, ÉS ÜRES VÁLASZTÁSNÁL NEM KÜLD
   * PARAMÉTERT. Egy üres sztring NEM ugyanaz: a szerver egy nem létező
   * egységre futtatná a részfa-kibontást.
   */
  it("a helyszín-szűrő üres választásnál nem küld paramétert", () => {
    assert.match(
      olvas(KLIENS),
      /if \(input\?\.departmentId\) query\.set\("departmentId", input\.departmentId\)/,
    );
    assert.match(
      olvas(ESZKOZ_LISTA),
      /\.\.\.\(helyszin \? \{ departmentId: helyszin \} : \{\}\)/,
    );
  });

  /**
   * 5. A POZITÍV KONTROLL: a partner megmaradt műveletei ott vannak. Enélkül a
   * fenti négy negatív állítás akkor is zöld lenne, ha mindent letiltanánk.
   */
  it("a partner megmaradt műveletei megvannak", () => {
    /* hibajegy nyitasa */
    assert.match(olvas(KLIENS), /createTicket: \(input: \{/);
    /* csatolas a sajat jegyhez */
    assert.match(olvas(KLIENS), /uploadTicketDocument: \(/);
    /* munkalap alairasa */
    assert.match(olvas(KLIENS), /signWorksheet|worksheetSigners/);
    /* es az eszkoz-lapon a csatolas, amire a partnernek VAN joga */
    assert.match(olvas(ESZKOZ_RESZLET), /partnerApi\.uploadAssetDocument\(/);
  });

  /**
   * ÉS A LISTÁRÓL ODA IS JUT: a kártya hivatkozás, nem `article`. A hibajegy
   * és a munkalap listája ezt a mintát követi, és a feladatlap is ezt kérte.
   */
  it("a lista kártyája az adatlapra visz", () => {
    assert.match(olvas(ESZKOZ_LISTA), /href=\{`\/eszkozok\/\$\{asset\.id\}`\}/);
  });
});

/**
 * A HIBAJEGY ADATLAPJA (6559eab5, 2. szelet).
 *
 * Ugyanaz a két elv, mint az eszköz-adatlapnál: a TARTALOM a belső felület
 * megfelelőjéből jön, a MŰVELETEK a jogosultságból. A negatív állítások mellé
 * a pozitív kontroll a szakasz végén áll -- enélkül mind zöld lenne egy üres
 * lapon is.
 *
 * A sor SZÖVEGÉT nem ez a szakasz méri, hanem a `naplo-sor.spec.ts`: az a
 * függvényt FUTTATJA. Itt csak az van, ami a képernyő bekötéséről szól.
 */
describe("a partner hibajegy-adatlapja", () => {
  it("POZITÍV KONTROLL: a lap és a naplósor olvasható és nem üres", () => {
    for (const ut of [HIBAJEGY_RESZLET, NAPLO_SOR])
      assert.ok(olvas(ut).length > 500, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * 1. A NÉGY KEZELŐI MŰVELET NINCS A LAPON -- MIND KÜLÖN NÉVVEL.
   *
   * Nem azért, mert nincs rá jog: a `PARTNER_SERVICE` szerep viseli a
   * `SERVICE_MANAGE` jogot (auth.ts:388), tehát a szerver ma átengedné mind a
   * négyet. MA SZÁNDÉKOSAN NEM KÍNÁLJUK őket, és a rés ki van mondva a pull
   * request törzsében.
   */
  it("a lap nem kínálja az állapot léptetését", () => {
    assert.ok(!/allowedSteps|\/step|stepJob/.test(kod(HIBAJEGY_RESZLET)));
  });

  it("a lap nem kínálja a delegálást", () => {
    assert.ok(!/assignees|assignJob|\/assignees/.test(kod(HIBAJEGY_RESZLET)));
  });

  it("a lap nem kínálja a helyszín és az eszközök szerkesztését", () => {
    const s = kod(HIBAJEGY_RESZLET);
    assert.ok(!/method: "PATCH"|updateTicket|setPlacement/.test(s));
  });

  it("a lap nem kínálja a munkalap csatolását és leválasztását", () => {
    const s = kod(HIBAJEGY_RESZLET);
    assert.ok(!/attachWorksheet|detachWorksheet|method: "DELETE"/.test(s));
  });

  /**
   * 2. IDEGEN AZONOSÍTÓRA NINCS KLIENS-OLDALI SZŰRÉS: a hatókört a SZERVER
   * szabja. Egy `customerId` a hívásban azt sugallná, hogy a láthatóságot a
   * hívó dönti el.
   */
  it("a jegy-adatlap hívása nem visz partner-azonosítót", () => {
    const hivas = kod(KLIENS).match(
      /ticket: \(id: string\) =>[\s\S]{0,200}?\),/,
    );
    assert.ok(hivas, "nem találom a jegy adatlapjának hívását");
    assert.ok(!/customerId|ownerId|ownerType/.test(hivas[0]));
  });

  /**
   * 3. AZ ESZKÖZ SORA AZ `assetId`-VEL VISZ TOVÁBB, NEM A CSATOLÁS SORÁNAK
   * AZONOSÍTÓJÁVAL.
   *
   * A `ServiceJobAssetLink` KÉT azonosítót hordoz, és a rossz választás NÉMA:
   * a hivatkozás megjelenne, a lap pedig „nem található" hibát adna, mert az
   * `id` egy csatolási sor, nem egy eszköz. A típus nem fogja meg -- mind a
   * kettő `string`.
   */
  it("az érintett eszköz sora az eszköz adatlapjára visz", () => {
    assert.match(
      olvas(HIBAJEGY_RESZLET),
      /href=\{`\/eszkozok\/\$\{asset\.assetId\}`\}/,
    );
    assert.doesNotMatch(
      olvas(HIBAJEGY_RESZLET),
      /href=\{`\/eszkozok\/\$\{asset\.id\}`\}/,
    );
  });

  /**
   * 4. A MUNKALAPOK A NAPLÓBÓL JÖNNEK, és a saját adatlapjukra visznek.
   *
   * A `ServiceJobDetail` NEM hordoz `worksheets` mezőt: a végpont egy
   * időrendet ad. Egy `ticket.worksheets` alak tehát nem fordulna le -- ez az
   * állítás azt méri, hogy a szűrés a naplóra megy.
   */
  it("a munkalap-panel a naplóból szűr, és a munkalap lapjára visz", () => {
    const s = olvas(HIBAJEGY_RESZLET);
    assert.match(
      s,
      /entry\.kind === "worksheet" \? \[entry\.worksheet\] : \[\]/,
    );
    assert.match(s, /href=\{`\/munkalapok\/\$\{worksheet\.id\}`\}/);
  });

  /**
   * 5. A NAGYÍTÁS GOMB, NEM KÉPRE AKASZTOTT KATTINTÁS. Így billentyűzetről is
   * elérhető, és a képernyőolvasó műveletnek mondja. A panel MIND A HÁROM lap
   * (jegy, munkalap, eszköz) csatolmányait rajzolja, tehát ez egy helyen
   * javít hármat.
   */
  it("a nagyított kép gombról nyílik, és az Escape zárja", () => {
    const s = olvas(DOKUMENTUMOK);
    assert.match(
      s,
      /className="document-thumb"[\s\S]{0,200}?onClick=\{\(\) => setNagyitott\(item\.id\)\}/,
    );
    assert.match(s, /esemeny\.key === "Escape"/);
  });

  /**
   * A BELSŐ MEGJEGYZÉS NEM KERÜL A PARTNER ELÉ (Balázs döntése, 2026-09-21).
   *
   * EZ AZ ÁLLÍTÁS EGY SAJÁT TÉVEDÉSEMET ŐRZI. A megjegyzést BEÍRTAM a naplóba,
   * azzal az érvvel, hogy nem új közzététel: a partner letölthető csomagja MA
   * IS tartalmazza. A mérés igaz volt, a következtetés nem -- Balázs ugyanazzal
   * a mondattal a CSOMAGBÓL is kivetette.
   *
   * MI PIROSÍT: a `note` bármilyen kirajzolása. És a KOLLÉGA NEVE a pozitív
   * kontroll hozzá: Balázs külön kimondta, hogy az marad, tehát egy állítás,
   * ami csak a megjegyzés hiányát méri, zölden hagyná a név elvesztését is.
   */
  it("a napló nem írja ki a belső megjegyzést, a nevet viszont igen", () => {
    const s = kod(HIBAJEGY_RESZLET);
    assert.ok(
      !/event\.note/.test(s),
      "a belső megjegyzés kirajzolódik a partner naplójában",
    );
    assert.match(s, /entry\.event\.actorName/);
  });

  /**
   * EGY VÁLASZTHATÓ ALÁÍRÓNÁL A LAP ELŐRE KIVÁLASZTJA (9188d799).
   *
   * A szerver a kérőre szűkíti a listát, tehát a választó egy elemű. A beküldés
   * `if (!signerUserId) return;` ágon áll: előválasztás nélkül aki nem nyitja le
   * a legördülőt, megnyomja a gombot, és NEM TÖRTÉNIK SEMMI -- hibaüzenet
   * nélkül. Egy néma no-op rosszabb, mint egy hibaüzenet.
   *
   * MI PIROSÍT: az előválasztás elhagyása.
   */
  it("egy választható aláírónál előre kiválasztja", () => {
    assert.match(
      kod(MUNKALAP_RESZLET),
      /signerList\.items\.length === 1[\s\S]{0,120}?setSignerUserId\(/,
    );
  });

  /**
   * AZ ALÁÍRÁS-ŰRLAP A KÉT FELTÉTELHEZ KÖTŐDIK -- ÉS 2026-09-21-IG EGYIKHEZ SEM.
   *
   * Addig az egyetlen feltétel az volt, hogy MÁR ALÁÍRTÁK-E. Vagyis az űrlap
   * PISZKOZATON IS megjelent (a partner-lista nem szűr állapotra), és minden
   * lezárt lapon is -- akkor is, ha soha nem küldtük ki senkinek. Balázs ezt
   * be is jelentette: „van egy nyitott munkalap, amit ala tudna irni ha akarna."
   *
   * A SZERVER KAPUJA UGYANEZT A KETTŐT NÉZI. Ez nem két szabály két helyen: a
   * szerveré a döntő, ez csak azt zárja ki, hogy a felület olyat kínáljon fel,
   * amit a szerver elutasít.
   *
   * MI PIROSÍT: bármelyik feltétel elhagyása.
   */
  it("az aláírás-űrlap a kiállított ÉS kiküldött laphoz kötődik", () => {
    const s = kod(MUNKALAP_RESZLET);
    assert.match(s, /current\.status === "AWAITING_SIGNATURE"/);
    assert.match(s, /current\.sentForSignatureAt !== null/);
  });

  /**
   * ÉS NEM CSAK ELREJTI: KIMONDJA, MIÉRT.
   *
   * Egy eltűnő űrlap ugyanúgy néz ki, mint egy elromlott lap -- a partner nem
   * tudja, rá vár-e valami. Ugyanaz a lelet, amit a belső lapon a lezárás-gomb
   * néma elrejtése okozott (Balázs 2026-09-18: „Nem tudok lezarni munkalapot.
   * Nincs olyan gomb." -- a gomb ott volt).
   */
  it("a nem aláírható lapon MEGMONDJA, miért nincs űrlap", () => {
    assert.match(kod(MUNKALAP_RESZLET), /még nem érkezett meg aláírásra/);
  });

  /**
   * POZITÍV KONTROLL: a partner megmaradt művelete ott van a lapon. Enélkül a
   * fenti négy negatív állítás akkor is zöld lenne, ha a lap üres volna.
   */
  it("a partner továbbra is csatolhat a saját jegyéhez", () => {
    assert.match(
      olvas(HIBAJEGY_RESZLET),
      /partnerApi\.uploadTicketDocument\(id, file, caption\)/,
    );
  });
});

/**
 * A MUNKALAP ADATLAPJA (6559eab5, 3. szelet).
 *
 * Ugyanaz a két elv: a TARTALOM a belső lapé, a MŰVELETEK a jogosultságból.
 * A negatív állítások mellé a pozitív kontroll a szakasz végén áll.
 */
describe("a partner munkalap-adatlapja", () => {
  it("POZITÍV KONTROLL: a lap olvasható és nem üres", () => {
    assert.ok(olvas(MUNKALAP_RESZLET).length > 2000);
  });

  /**
   * 1. A MUNKANAPLÓ NINCS A LAPON -- ÉS EZ NEM A MI DÖNTÉSÜNK.
   *
   * A `:id/entries` végpont saját megjegyzése mondja ki, hogy a bejegyzés a
   * MI munkanaplónk, és Balázs nem kérte, hogy a partner lássa. Ez tehát
   * eldöntött hiány, nem elmaradt munka -- a többi negatív állítástól ezért
   * áll külön.
   */
  it("a lap nem kéri le a munkanaplót", () => {
    const s = kod(MUNKALAP_RESZLET);
    assert.ok(!/\/entries|worksheetEntries|addEntry/.test(s));
    /* ÉS A KLIENS SEM TUD RÓLA: egy bennhagyott hívás később visszakerülne. */
    assert.ok(!/entries/.test(kod(KLIENS)));
  });

  /**
   * 2. A KEZELŐI SZERKESZTŐK NINCSENEK A LAPON. Nem jogosultsági okból: a
   * `PARTNER_SERVICE` szerep viseli a `SERVICE_MANAGE` jogot (auth.ts:388).
   * MA SZÁNDÉKOSAN NEM KÍNÁLJUK őket.
   */
  it("a lap nem kínálja a tételek szerkesztését", () => {
    const s = kod(MUNKALAP_RESZLET);
    assert.ok(!/szerkesztes|method: "PATCH"|updateWorksheet/.test(s));
  });

  it("a lap nem kínálja a felelősök és az eszközök szerkesztését", () => {
    const s = kod(MUNKALAP_RESZLET);
    assert.ok(!/assignees|attachAsset|detachAsset|method: "DELETE"/.test(s));
  });

  /**
   * 3. ÖSSZEG SEHOL. A válasz hordozza a nettó, áfa és bruttó mezőket, de
   * azok 2026-09-17 óta a BELSŐ lapról is kikerültek (#809). Ez tehát nem
   * partneri csonkítás -- és pont ezért kell mérni: a mezők ott vannak a
   * típusban, tehát egy jóhiszemű bővítés bármikor visszateheti őket.
   */
  it("a lap egyetlen összeget sem ír ki", () => {
    const s = kod(MUNKALAP_RESZLET);
    for (const mezo of [
      "netAmount",
      "vatAmount",
      "grossAmount",
      "unitNet",
      "vatRatePercent",
    ])
      assert.ok(!s.includes(mezo), `a lap kiírja a(z) ${mezo} mezőt`);
  });

  /**
   * 4. AZ ESZKÖZ SORA AZ `assetId`-VEL VISZ TOVÁBB. Ugyanaz a néma csapda,
   * mint a hibajegy lapján: mind a két mező `string`.
   */
  it("az érintett eszköz sora az eszköz adatlapjára visz", () => {
    const s = olvas(MUNKALAP_RESZLET);
    assert.match(s, /href=\{`\/eszkozok\/\$\{asset\.assetId\}`\}/);
    assert.doesNotMatch(s, /href=\{`\/eszkozok\/\$\{asset\.id\}`\}/);
  });

  /**
   * 5. A HIBAJEGY HIVATKOZÁS A PORTÁL ÚTVONALÁRA MEGY, nem a belső felületére.
   *
   * MI PIROSÍT: a belső lap alakjának átvétele (`/szerviz/hibajegyek/...`). Az
   * egy létező cím, csak nem ezen a kiszolgálón -- a partner egy bejelentkező
   * képernyőre vagy egy 404-re futna, és a hivatkozás közben helyesnek
   * látszana.
   */
  it("a hibajegy hivatkozás a portál útvonalára megy", () => {
    const s = olvas(MUNKALAP_RESZLET);
    assert.match(s, /href=\{`\/hibajegyek\/\$\{worksheet\.serviceJob\.id\}`\}/);
    assert.ok(!/\/szerviz\//.test(kod(MUNKALAP_RESZLET)));
  });

  /**
   * 6. AZ ÁLLAPOT FELIRATA A KÖZÖS SZÓTÁRBÓL JÖN, MIND A KÉT HELYEN.
   *
   * A portál 2026-09-21-ig a NYERS enum-értéket írta ki (`SIGNED`, `DRAFT`):
   * a szótár az `apps/web`-ben lakott, ahonnan ez a csomag nem importálhat.
   *
   * A LISTA IS MÉRVE, nem csak az adatlap: a hiba ott volt látható először, és
   * egy adatlapra szűkített állítás a listát zölden hagyná.
   */
  it("az állapot felirata a közös szótárból jön, a listán is", () => {
    assert.match(
      olvas(MUNKALAP_RESZLET),
      /worksheetStatusLabel\[current\.status\]/,
    );
    assert.match(olvas(ESZKOZ_LISTA), /worksheetStatusLabel\[sheet\.status\]/);
    /* ES A NYERS ERTEK SEHOL: egy bennmaradt alak a masik helyen allna. */
    assert.doesNotMatch(olvas(ESZKOZ_LISTA), /\{sheet\.status\}/);
  });

  /**
   * POZITÍV KONTROLL: a partner megmaradt műveletei ott vannak, ÉS a két új
   * táblázat tényleg kirajzolódik. Enélkül a fenti négy negatív állítás akkor
   * is zöld lenne, ha a lap üres volna.
   */
  it("az aláírás, a csatolás és a két táblázat megvan", () => {
    const s = olvas(MUNKALAP_RESZLET);
    assert.match(
      s,
      /partnerApi\.signWorksheet\(id, signerUserId, signatureCode\)/,
    );
    assert.match(s, /partnerApi\.uploadWorksheetDocument\(id, file, caption\)/);
    assert.match(s, /<Tetelek lines=\{current\.lines\} \/>/);
    assert.match(s, /<Verziok versions=\{worksheet\.versions\} \/>/);
  });

  /**
   * A MATRICA KÓDJA ÁLL A NÉV ALATT, NEM A BELSŐ ESZKÖZ-SZÁM.
   *
   * Balázs kérése (2026-09-22): a partner a polcon a matricát olvassa le, nem a
   * mi nyilvántartási számunkat. Két helyet nevezett meg, és mind a kettő itt
   * áll: az eszköz-lista és a hibajegy-létrehozás eszköz-csatolása.
   *
   * === MIÉRT A HÍVÁSRA ÁLLÍT, ÉS NEM A KIÍRT MEZŐRE ===
   *
   * A választás (`labelCode ?? assetNumber`) egy tiszta függvényben áll, és
   * annak SAJÁT specje van, valódi viselkedés-állításokkal. Ez a két sor csak
   * azt méri, hogy a felület azt a függvényt hívja -- vagyis a BEKÖTÉST, amit
   * a függvény specje nem tud megmérni.
   *
   * === A HIÁNY-ÁLLÍTÁS IS ITT VAN, ÉS MÉRVE BIZTONSÁGOS ===
   *
   * A `assetNumber` MA egyik fájlban sem szerepel máshol (mérve 2026-09-22,
   * mindkettőben nulla találat), tehát a hiányát állítani nem túl tág. Ha
   * valaki visszaírná a nyers mezőt, ez pirosodik.
   */
  it("az eszköz-lista és a hibajegy-csatolás a MATRICA kódját írja ki", () => {
    for (const ut of [ESZKOZ_LISTA, BEJELENTO]) {
      assert.match(
        kod(ut),
        /eszkozAzonosito\(/,
        `${ut}: nem a közös választó függvényt hívja`,
      );
      assert.doesNotMatch(
        kod(ut),
        /asset\.assetNumber/,
        `${ut}: a nyers belső eszköz-szám került vissza`,
      );
    }
  });

  /**
   * KONTROLL: A HIÁNY-ÁLLÍTÁS TUD-E EGYÁLTALÁN TALÁLNI.
   *
   * Egy `doesNotMatch` akkor is zöld, ha a minta soha semmire nem illeszkedik
   * -- például elgépelt mezőnévre. Ez a sor megmutatja, hogy UGYANAZ a minta
   * egy olyan fájlban, ahol a nyers mező MÉG ott áll, TALÁL is.
   *
   * Az eszköz adatlapja szándékosan maradt ki a körből (Balázs két helyet
   * nevezett meg), tehát ott ma is a belső szám áll -- ez a kontroll
   * természetes pozitív esete. Ha valaha azt is átállítjuk, ez a sor pirosodik,
   * és akkor a kontrollnak új házigazdát kell keresni.
   */
  it("KONTROLL: ugyanaz a minta az eszköz-adatlapon TALÁL", () => {
    assert.match(kod(ESZKOZ_RESZLET), /asset\.assetNumber/);
  });

  /**
   * A HARMADIK HELY: AZ ESZKOZ ADATLAPJA.
   *
   * Itt eddig a `qrToken` allt "QR-azonosito" cim alatt -- egy uuid azon a
   * neven, ahogy a felhasznalo a matricat hivja. Balazs dontese (2026-09-22):
   * "Nekem a matrica kodja kell".
   *
   * A CIMKE IS VALTOZOTT, es ez nem kozmetika: egy jo tartalom rossz cim alatt
   * ugyanaz a csapda marad.
   */
  it("az eszköz-adatlap a MATRICA kódját mutatja, nem a belső tokent", () => {
    assert.match(kod(ESZKOZ_RESZLET), /labelCode/);
    assert.doesNotMatch(
      kod(ESZKOZ_RESZLET),
      /qrToken/,
      "a belso token visszakerult a partner-lapra",
    );
  });

  /**
   * KONTROLL A FENTI HIANY-ALLITASHOZ -- ES CSAK AZT MERI, AMIT A MASIK NEM.
   *
   * Egy `doesNotMatch` akkor is zold, ha a minta soha semmire nem illeszkedik
   * (elgepelt mezonev). Ez a sor megmutatja, hogy a minta TALAL: a fajl NYERS
   * szovegeben a `qrToken` ma is ott all, a sor melletti magyarazatban.
   *
   * ES AZ ELSO ALAKJA HIBAS VOLT, EZERT ALL ITT KIMONDVA. Eloszor ide irtam a
   * `doesNotMatch(kod(...))` allitast is -- vagyis a fenti allitas MASODIK
   * feleT. A kalibracio buktatta le: a kod-beli tokenre MIND A KETTO pirosra
   * ment, holott a kontrollnak ZOLDNEK kell maradnia. Egy kontroll, ami
   * ugyanattol bukik, mint amit igazolnia kell, nem tanu, hanem ismetles.
   */
  it("KONTROLL: a minta TALÁL a nyers fájlban", () => {
    assert.match(olvas(ESZKOZ_RESZLET), /qrToken/);
  });
});
