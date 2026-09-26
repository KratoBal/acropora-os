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
/*
  A `reference-lists.tsx` 2026-09-24-EN MINDKET LISTAJATOL MEGVALT, ES TOROLVE
  LETT: az eszkoz-lista `asset-list.tsx`-be koltozott (#1042), a munkalap-lista
  pedig `worksheet-list.tsx`-be (ugyanaznap, kulon PR). Mindket koltozes
  ugyanazert tortent: Balazs kerese, hogy a partner listak ugyanugy nezzenek
  ki, mint az app.acropora.hu. A fajlban a koltozes utan mar semmi nem maradt,
  csak ket magyarazo komment -- ezert torlodott, nem hagytuk ures hejnak.

  MIERT KULON KONSTANS MINDKETTONEK: a `sheet`/`worksheet` valtozonev is
  koltozott a mozgassal, tehat egy a regi fajlra maradt allitas a kodtol
  fuggetlenul pirosodna vagy zoldulne.
*/
const ESZKOZ_LISTA = "src/components/asset-list.tsx";
const MUNKALAP_LISTA = "src/components/worksheet-list.tsx";
const ESZKOZ_RESZLET = "src/components/asset-detail.tsx";
const ESZKOZ_UTVONAL = "src/app/(portal)/eszkozok/[id]/page.tsx";
const NAPLO_SOR = "src/lib/naplo-sor.ts";
const MUNKALAP_RESZLET = "src/components/worksheet-detail.tsx";
const PORTAL_SHELL = "src/components/portal-shell.tsx";
const AUTH = "src/components/auth.tsx";
const AQUARIUM_LISTA = "src/components/aquarium-list.tsx";
const AQUARIUM_RESZLET = "src/components/aquarium-detail.tsx";
const AQUARIUM_UJ = "src/components/new-aquarium.tsx";
const AQUARIUM_ESZKOZOK = "src/components/aquarium-assets.tsx";

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
    /*
      A NATÍV `pattern`/`maxLength` A `PilotInput`-RA VÁLTÁSKOR MEGSZŰNT
      (2026-09-25, pilot-aqua átültetés): a komponensnek nincs ilyen propja.
      A HELYETTESÍTŐ VÉDELEM KETTŐS, és mindkettő a SZÁMOT kényszeríti ki,
      nem csak a mező jelenlétét: az `onChange` maga szűri a nem-számjegy
      karaktereket és négyre vágja (`replace(/\D/g, "").slice(0, 4)`), a
      submit gomb pedig letiltva marad, amíg a kód pontosan négy jegyű
      (`signing.code.length === 4`) -- ugyanaz a mérce, mint korábban.
    */
    assert.match(s, /\.replace\(\/\\D\/g, ""\)/);
    assert.match(s, /\.slice\(0, 4\)/);
    assert.match(s, /signing\.code\.length === 4/);
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

  /**
   * A NEM-KÉP TÉTEL LETÖLTHETŐ ÉS MEGNYITHATÓ (Balázs kérése, 2026-09-26).
   *
   * A munkalap PDF-je eddig csak fájlnévként állt a panelen. A panelt a
   * hibajegy, a munkalap és az eszköz lapja is hívja, tehát ez egy helyen
   * javít hármat.
   *
   * MI PIROSÍT:
   * - ha a gombok ága nem a nem-kép (vagy be nem töltött kép) tételre szól;
   * - ha a két gomb nem a `saveBlob`/`showBlob` segédet hívja, hanem például
   *   egy közvetlen `href`-et (az hitelesítés nélkül menne ki, 401);
   * - ha a lap az `await` UTÁN nyílik: az már nem a felhasználó mozdulata,
   *   és a felugró-ablak tiltó elnyeli.
   *
   * A KONTROLL: a betöltő továbbra is CSAK a képeket kéri le előre. Enélkül egy
   * olyan változat is zöld lenne, ami minden PDF-et megnyitáskor letölt.
   */
  it("a nem-kép tétel Letöltés és Megnyitás gombot kap, a segédekkel", () => {
    const s = kod(DOKUMENTUMOK);
    assert.match(
      s,
      /!item\.contentType\.startsWith\("image\/"\) \|\|\s*failed\[item\.id\]/,
    );
    assert.match(s, /fetchFile\(item, "save"\)[\s\S]{0,200}?Letöltés/);
    assert.match(s, /fetchFile\(item, "open"\)[\s\S]{0,200}?Megnyitás/);
    assert.match(s, /saveBlob\(blob, item\.fileName, browserSurface\)/);
    assert.match(
      s,
      /showBlob\(tab, blob, item\.contentType, item\.fileName, browserSurface\)/,
    );
    assert.match(
      s,
      /window\.open\("", "_blank"\)[\s\S]*?await loader\.current\(item\.id\)/,
    );
    assert.doesNotMatch(s, /await[^;]*;[^}]*window\.open/);
    assert.match(
      s,
      /\.filter\(\(item\) => item\.contentType\.startsWith\("image\/"\)\)/,
    );
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
   *
   * === EZ A HELYES ALAK, NEM EGY JOGOSULTSÁG-FÜGGŐ VÁLTOZAT (acrobot, 2026-09-24 09:43) ===
   *
   * Balázs 2026-09-21-i két mondata ("ne tudjon szerkeszteni" + "csak ott
   * ahol jogosultsága van") ELSŐ OLVASATRA jogosultság-alapú megjelenítést
   * sugallhat -- DE a `PARTNER_SERVICE` szerepnek MA MEGVAN a
   * `SERVICE_MANAGE` joga (`auth.ts`), tehát egy jogosultság-alapú
   * megjelenítés MA szerkesztést, QR-cserét és kivezetést adna a
   * partnernek, amit Balázs kifejezetten NEM kért. A helyes olvasat: ez a
   * négy művelet AKKOR IS hiányzik, ha a hívó `SERVICE_MANAGE` joggal bír --
   * ez a lenti négy állítás pontosan ezt méri, mert a kód FELTÉTEL NÉLKÜL
   * nem hívja ezeket a végpontokat, nem egy jogosultság-ág mögé rejtve.
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
    /*
      ES A QR MEGJELENITES+LETOLTES, 2026-09-24 OTA -- ez a `GET :id/qr`
      vegpont, `SERVICE_VIEW`-t ker, nem `SERVICE_MANAGE`-et, tehat MINDEN
      partner felhasznalonak jar. POZITIV KONTROLL, mert kulonben a fenti
      negativ allitasok (nincs szerkesztes/csere/kivezetes/torles) akkor is
      zoldek lennenek, ha ez a kartya sem all a lapon.
    */
    assert.match(olvas(ESZKOZ_RESZLET), /\.assetQr\(id\)/);
    assert.match(olvas(KLIENS), /assetQr: \(id: string\) =>/);
  });

  /**
   * ÉS A LISTÁRÓL ODA IS JUT: a kártya hivatkozás, nem `article`. A hibajegy
   * és a munkalap listája ezt a mintát követi, és a feladatlap is ezt kérte.
   */
  it("a lista kártyája az adatlapra visz", () => {
    assert.match(olvas(ESZKOZ_LISTA), /href=\{`\/eszkozok\/\$\{asset\.id\}`\}/);
  });

  /**
   * A NÉGY KÉPERNYŐKÉP KÖZÖS HIBÁJA: NYERS ENUM A FELHASZNÁLÓNAK.
   *
   * Balázs 2026-09-24-i négy képernyőképe a listán `ACTIVE`/`RETIRED`
   * pirulát mutatott, az adatlapon ugyanígy a fejlécen, az Előzményeken
   * pedig `UPDATED`/`CREATED`-et. Mind a négy ugyanabból a `@acropora/types`
   * szótárból oldódik fel most -- ugyanaz a szótár, amit a belső felület is
   * használ.
   */
  it("a lista magyar státusz-cimkét mutat, nem a nyers enumot", () => {
    assert.match(olvas(ESZKOZ_LISTA), /assetStatusLabel\[asset\.status\]/);
    assert.doesNotMatch(kod(ESZKOZ_LISTA), /\{asset\.status\}/);
  });

  it("az adatlap magyar státusz- és esemény-cimkét mutat, nem a nyers enumot", () => {
    const s = kod(ESZKOZ_RESZLET);
    assert.match(s, /assetStatusLabel\[asset\.status\]/);
    assert.match(s, /assetEventLabel\[esemeny\.type\]/);
    assert.doesNotMatch(s, /\{asset\.status\}/);
    assert.doesNotMatch(s, /\{esemeny\.type\}/);
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
  /*
    2026-09-25-TŐL A GOMBNAK NINCS "document-thumb" OSZTÁLYA (Figma 9. kör,
    a `DocumentPanel` pilot-aqua átállása) -- a `cursor-zoom-in` Tailwind-
    osztály a mérvadó jel, ugyanúgy, ahogy korábban a saját osztálynév volt.
  */
  it("a nagyított kép gombról nyílik, és az Escape zárja", () => {
    const s = olvas(DOKUMENTUMOK);
    assert.match(
      s,
      /onClick=\{\(\) => setNagyitott\(item\.id\)\}[\s\S]{0,200}?cursor-zoom-in/,
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
    assert.match(
      olvas(MUNKALAP_LISTA),
      /worksheetStatusLabel\[worksheet\.status\]/,
    );
    /* ES A NYERS ERTEK SEHOL: egy bennmaradt alak a masik helyen allna. */
    assert.doesNotMatch(olvas(MUNKALAP_LISTA), /\{worksheet\.status\}/);
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

/**
 * AZ "AKVÁRIUMOK" MENÜPONT ÉS ÚTVONAL A SZERVER VÁLASZÁT NÉZI, NEM A
 * FRONTEND SAJÁT, BEÉGETETT JOG-TÁBLÁJÁT (acrobot kérése, msg_id 23542,
 * 2026-09-25).
 *
 * === MIÉRT NEM ELÉG A SZEREP-SZINTŰ JOG ===
 *
 * Az `apps/partner` MINDEN beolvasztáskor AZONNAL élesre települ
 * (ticket.acropora.hu, az állatkert emberei használják), az `apps/api`
 * viszont csak Balázs külön engedélyével. A `PARTNER_SERVICE` szerep MA
 * (ezen a fejlesztői ágon) hordozza az `AQUARIUMS_VIEW` jogot
 * (`packages/types` `auth.ts`), de ez a FRONTEND SAJÁT BUILDJÉNEK a
 * tudása -- ha ez a képernyő előbb megy élesre, mint a #1116 (a jog maga)
 * az API-n, egy `hasPermission()`-re épülő ellenőrzés a régi API mellett
 * IS látszana, és az állatkert egy hibázó menüpontot kapna.
 *
 * A helyes jel a `/auth/me` válaszának `navigation` mezője
 * (`CurrentUserResponse.navigation`, `visibleNavigationFor(role)`-lal
 * SZERVER OLDALON számolva): az mindig azt tükrözi, amit az ÉPPEN FUTÓ
 * API ismer, függetlenül attól, milyen `packages/types` van a frontend
 * buildjébe zárva.
 */
describe("az Akváriumok menüpont és útvonal kapuja", () => {
  it("POZITÍV KONTROLL: a shell és az auth fájl olvasható és nem üres", () => {
    for (const ut of [PORTAL_SHELL, AUTH])
      assert.ok(olvas(ut).length > 500, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * A `partnerApi.me()` A `CurrentUserResponse`-t KÉRI, NEM A PUSZTA
   * `AuthenticatedUser`-t.
   *
   * MI PIROSÍT: ha a típus visszakerülne `AuthenticatedUser`-re -- az a
   * valódi JSON válaszban NEM változtatna semmin (a mező akkor is ott
   * lenne a szerver oldalán), de a TypeScript innentől nem engedné
   * `user.navigation`-t olvasni, tehát a lenti kapu típushibával halna
   * el fordításkor, nem futásidőben.
   */
  it("a partnerApi.me() a CurrentUserResponse típusát kéri", () => {
    assert.match(
      kod(KLIENS),
      /me: \(\) => request<CurrentUserResponse>\("\/auth\/me"\)/,
    );
  });

  /**
   * BEJELENTKEZÉS UTÁN IS A `/auth/me`-BŐL JÖN A FELHASZNÁLÓ, NEM A
   * BEJELENTKEZÉS VÁLASZÁBÓL.
   *
   * MI PIROSÍT: `setUser(result.user)` vagy ehhez hasonló, ami a
   * `/auth/login/password` válaszát tenné a state-be. Az a végpont NEM
   * hordozza a `navigation` mezőt (`auth.controller.ts`
   * `loginWithPassword`, visszatérési típusa `{ user: AuthenticatedUser }`),
   * tehát belépés UTÁN, a következő teljes oldalbetöltésig a kapu hamis
   * negatívot adna akkor is, ha a jog megvan.
   */
  it("bejelentkezés után külön lekéri a /auth/me választ", () => {
    const s = kod(AUTH);
    assert.match(s, /await partnerApi\.login\(email, password\)/);
    assert.match(s, /setUser\(await partnerApi\.me\(\)\)/);
    assert.doesNotMatch(s, /setUser\(result\.user\)/);
  });

  /**
   * A `hasNavigationEntry` A SZERVER `navigation` TÖMBJÉT NÉZI, NEM A
   * SZEREPET ÉS NEM A `hasPermission`-T.
   *
   * MI PIROSÍT: egy `user.role === "PARTNER_SERVICE"` vagy
   * `hasPermission(user.role, ...)` alapú megvalósítás -- mindkettő a
   * FRONTEND saját, beégetett tudását nézné, nem az élesben futó API-ét.
   */
  it("a hasNavigationEntry a user.navigation tömbön keres, nem a szerepen", () => {
    const s = kod(AUTH);
    assert.match(
      s,
      /user\?\.navigation\.some\(\(entry\) => entry\.id === entryId\)/,
    );
    assert.doesNotMatch(s, /hasPermission\(/);
  });

  /**
   * AZ "AKVARISZTIKA" MENÜCSOPORT A `canViewAquariums` VAGY A
   * `canViewCalculators` MÖGÖTT ÁLL, NEM FELTÉTEL NÉLKÜL.
   *
   * A csoport-fejléc 2026-09-25-től KÉT tételt fed (Akváriumok,
   * Kalkulátorok) -- a csoport akkor is látszik, ha a kettő közül csak az
   * egyikhez van jog, ezért a feltétel VAGY-kapcsolat, nem a régi
   * egyszemélyes `canViewAquariums`. A SOROK szűrése (melyik TÉTEL
   * látszik a csoporton belül) külön áll, a következő teszt méri.
   *
   * MI PIROSÍT: ha bármelyik jog-változó eltűnne a feltétel elől -- ez
   * volt a tényleges hiba ezen az ágon, MIELŐTT ezt a kaput megírtuk (a
   * csoport `user.role === "PARTNER_SERVICE"` mögött feltétel nélkül
   * renderelt).
   */
  it("az Akvarisztika menücsoport a canViewAquariums VAGY a canViewCalculators mögött áll", () => {
    const s = kod(PORTAL_SHELL);
    assert.match(
      s,
      /canViewAquariums = hasNavigationEntry\(user, AQUARIUMS_NAV_ENTRY_ID\)/,
    );
    assert.match(
      s,
      /canViewCalculators = hasNavigationEntry\(user, CALCULATORS_NAV_ENTRY_ID\)/,
    );
    assert.match(s, /\{\(canViewAquariums \|\| canViewCalculators\) && \(/);
  });

  /**
   * AZ ÚTVONAL IS VÉDVE VAN, NEM CSAK A MENÜPONT.
   *
   * MI PIROSÍT: ha a kapu csak a menüsorban állna. Egy közvetlen URL-
   * beírás (könyvjelző, korábbi lap) a menüpont hiánya ELLENÉRE elérné a
   * komponenst, ami egy régi API mellett nem létező végpontot hívna.
   */
  it("az /akvariumok útvonal jog nélkül átirányít, nem csak rejtve van a menüben", () => {
    const s = kod(PORTAL_SHELL);
    assert.match(
      s,
      /onAquariumsRoute = pathname\.startsWith\(AKVARIUMOK_HREF\)/,
    );
    assert.match(
      s,
      /!loading && user && !canViewAquariums && onAquariumsRoute/,
    );
    assert.match(s, /router\.replace\("\/hibajegyek"\)/);
  });

  /**
   * KONTROLL: A MENÜCSOPORT-MINTA TALÁL A TÉNYLEGES KIRAJZOLÁSI ALAKON --
   * vagyis a fenti "mögötte áll" állítás nem lenne zöld akkor is, ha a
   * teljes menücsoportot törölnénk.
   *
   * A `.filter(...).map(...)` alak SZÁNDÉKOS, 2026-09-25 óta: a csoport
   * MOST két tételt tart (Akváriumok, Kalkulátorok), és a köztük lévő
   * választás SORONKÉNT, `item.entryId` szerint dől el -- nem a teljes
   * csoport egyetlen kapuján. Ha a `.filter` eltűnne, mindkét tétel
   * megjelenne annak is, akinek csak az egyikhez van joga.
   */
  it("KONTROLL: a menücsoport ténylegesen kirajzolja, és soronként szűri a tételeket", () => {
    const s = kod(PORTAL_SHELL);
    assert.match(
      s,
      /AKVARISZTIKA_MENU\.filter\(\(item\) =>\s*\n\s*hasNavigationEntry\(user, item\.entryId\),?\s*\n\s*\)\.map\(\(item\) => \{/,
    );
  });
});

/**
 * ESZKÖZ AKVÁRIUMHOZ RENDELÉSE/LEVÉTELE -- A KLIENS-OLDALI HÍVÁS ALAKJA.
 *
 * A JOGOSULTSÁG-MECHANIZMUS 2026-09-25-ÖN MEGVÁLTOZOTT (emlék 1843, majd
 * 1847): a végpont NEM dedikált `SERVICE_ASSET_AQUARIUM_ASSIGN` jog alatt
 * áll, hanem `SERVICE_MANAGE`-en, egy felhasználónkénti `ServiceCapability`
 * jelölővel szűkítve a SERVICE-rétegben (lásd `service-assets.service.ts`
 * `assignAquarium()` fejlécét) -- ez a réteg a szerveren mérve az
 * `asset-aquarium-assign-permission.spec.ts`-ben.
 *
 * A PORTÁL-OLDALI UI (a gomb/választó, ami ezt a hívást elsüti) EBBEN A
 * KÖRBEN NINCS BENNE: az `aquarium-detail.tsx` a Portál Akváriumok terv
 * 1. körében (emlék 1847) pilot-stílusra épül újra, ez a munka pedig a
 * 3. kör -- lásd a fájl saját, aktuális fejlécét. Az UI-wiring tesztek
 * (jog-ellenőrzés, gomb/választó feltétel, payload) a 3. körben kerülnek
 * vissza, a NEW detail-page struktúrához igazítva. Ami MOST mérhető, és
 * ami itt marad, az a KLIENS-FÜGGVÉNY alakja -- az a réteg, amit a
 * jövőbeli UI, akárhogy is épül, ugyanígy fog hívni.
 */
describe("eszköz hozzárendelése/levétele egy akváriumról -- kliens hívás", () => {
  it("POZITÍV KONTROLL: a kliens olvasható és nem üres", () => {
    assert.ok(
      olvas(KLIENS).length > 500,
      `${KLIENS}: üres vagy gyanúsan rövid`,
    );
  });

  /**
   * A KLIENS DEDIKÁLT, SZŰK VÉGPONTRA MEGY -- nem az általános
   * `PATCH /service/assets/:id`-re. MI PIROSÍT: ha valaki "egyszerűsítené"
   * a hívást az általános adatlap-frissítő függvényre, ami a portál eddig
   * SOHA nem hívott -- azzal minden más mező is írhatóvá válna.
   */
  it("a kliens a /aquarium al-útvonalra ír, nem az általános PATCH-re", () => {
    const s = kod(KLIENS);
    assert.match(
      s,
      /assignAssetAquarium: \(\s*assetId: string,\s*input: \{ aquariumId: string \| null; expectedUpdatedAt: string \},\s*\) =>/,
    );
    assert.match(s, /\$\{encodeURIComponent\(assetId\)\}\/aquarium/);
    assert.match(s, /method: "PATCH"/);
  });
});

/**
 * AZ AKVÁRIUM LISTA/ADATLAP/ÚJ PILOT-STÍLUSRA VÁLTOTT (emlék 1847,
 * 2026-09-25 16:04 UTC) -- ez a szakasz a kör három saját döntését méri,
 * amik NEM olvashatók le egyszerűen a belső web pilot-lapjainak
 * másolásából.
 */
describe("az Akváriumok pilot-kör 1 saját döntései", () => {
  it("POZITÍV KONTROLL: mind a három fájl olvasható és nem üres", () => {
    for (const ut of [AQUARIUM_LISTA, AQUARIUM_RESZLET, AQUARIUM_UJ])
      assert.ok(olvas(ut).length > 500, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * AZ ADATLAP CSAK-OLVASÓ: NINCS `PilotFormField`/`PilotInput` az
   * akvárium SAJÁT mezőin, és nincs `PATCH` hívás. MI PIROSÍT: ha valaki
   * a belső `pilot-aquarium-editor-page.tsx`-t szó szerint másolná be
   * (az MINDIG szerkeszthető űrlap) -- az a szerveren `requireInternalWriter`
   * miatt minden partner-mentésnél 403-at adna.
   */
  it("az adatlap PilotDataRow-okkal olvas, nem PilotFormField-del szerkeszt", () => {
    const s = kod(AQUARIUM_RESZLET);
    assert.match(s, /PilotDataRow/);
    assert.doesNotMatch(s, /PilotFormField/);
    assert.doesNotMatch(s, /PilotInput/);
    assert.doesNotMatch(s, /method: "PATCH"/);
  });

  /**
   * AZ ÚJ AKVÁRIUM ŰRLAPON NINCS FIZIKAI MÉRET -- Balázs kifejezett kérése
   * erre a körre (emlék 1847): "FIZIKAI MERETEK NINCSENEK". MI PIROSÍT: ha
   * a belső szerkesztő hossz/szélesség/magasság mezői visszakerülnének.
   */
  it("az új akvárium űrlapon nincs hossz/szélesség/magasság mező", () => {
    const s = kod(AQUARIUM_UJ);
    assert.doesNotMatch(s, /lengthCm/);
    assert.doesNotMatch(s, /widthCm/);
    assert.doesNotMatch(s, /heightCm/);
    // POZITÍV KONTROLL: a liter mező viszont MEGVAN.
    assert.match(s, /systemVolumeLiters/);
  });

  /**
   * A LISTÁN NINCS TULAJDON-SZŰRŐ/OSZLOP (Saját/Ügyfél) -- a portálon
   * minden akvárium a hívó SAJÁT ügyfeléé, egy ilyen szűrő semmit nem
   * szűkítene. MI PIROSÍT: ha a belső lista `ownershipType` szűrője
   * (`OWNERSHIP_OPTIONS`/`PilotSegmentedControl` "Tulajdon"-nal) szó
   * szerint bekerülne.
   */
  it("a listán nincs tulajdon szerinti szűrő", () => {
    assert.doesNotMatch(kod(AQUARIUM_LISTA), /ownershipType/);
  });

  /**
   * A LISTA "ÚJ AKVÁRIUM" GOMBJA FELTÉTEL NÉLKÜL JELENIK MEG -- nem
   * `hasPermission`/`AQUARIUMS_MANAGE` mögött, mint a belső lapon. MI
   * PIROSÍT: ha egy jog-ellenőrzés kerülne a gomb elé, ami a `create()`
   * szolgáltatás-réteg tényleges (jog nélküli) engedékenységét hamisan
   * szűkebbnek mutatná.
   */
  it("az Új akvárium gomb feltétel nélkül jelenik meg a listán", () => {
    const s = kod(AQUARIUM_LISTA);
    assert.doesNotMatch(s, /hasPermission/);
    assert.doesNotMatch(s, /AQUARIUMS_MANAGE/);
    assert.match(s, /href="\/akvariumok\/uj"/);
  });
});

/**
 * AZ AKVÁRIUMOK PILOT-KÖR 3: "ESZKÖZÖK A MEDENCÉBEN", HOZZÁRENDELÉSSEL
 * (emlék 1843, 1847, acrobot msg_id 23638/23673/23679).
 *
 * === A GATE A SZERVER SZÁMOLT MEZŐJÉN ÁLL, NEM KLIENS-OLDALI JOGON ===
 *
 * A visszavont korábbi kör (lásd `git show f32acca0` a repóban) még
 * `hasPermission(user, PERMISSIONS.SERVICE_ASSET_AQUARIUM_ASSIGN)`-nal
 * döntött, mert akkor a jog szerep-szintű volt. Balázs pontosítása óta a
 * jog FELHASZNÁLÓNKÉNTI, a session-ben nem érhető el -- a szerver teszi a
 * kiszámolt `canAssignAssets` mezőt az akvárium-adatlap válaszába. MI
 * PIROSÍT: ha a kártya visszatérne a kliens-oldali jog-ellenőrzésre.
 */
describe("az Akváriumok pilot-kör 3 saját döntései", () => {
  it("POZITÍV KONTROLL: a kártya olvasható és nem üres", () => {
    assert.ok(
      olvas(AQUARIUM_ESZKOZOK).length > 500,
      `${AQUARIUM_ESZKOZOK}: üres vagy gyanúsan rövid`,
    );
  });

  it("az adatlap a szerver canAssignAssets mezőjét adja tovább a kártyának", () => {
    const s = kod(AQUARIUM_RESZLET);
    assert.match(s, /<AquariumAssets/);
    assert.match(s, /canAssignAssets=\{aquarium\.canAssignAssets\}/);
  });

  it("a kártya NEM kliens-oldali jog-ellenőrzéssel dönt a hozzárendelésről", () => {
    const s = kod(AQUARIUM_ESZKOZOK);
    assert.doesNotMatch(s, /hasPermission/);
    assert.doesNotMatch(s, /PERMISSIONS\./);
    assert.doesNotMatch(s, /useAuth/);
  });

  /**
   * A HOZZÁRENDELŐ RÉSZ A DOM-BÓL HIÁNYZIK, NEM CSAK CSS-SEL REJTETT -- a
   * `canAssignAssets ?` feltétel MAGÁT A `mt-3 border-t` dobozt zárja körbe.
   *
   * A MINTA A KÖVETKEZŐ JSX-ELEMRE IS NÉZ, NEM CSAK A FELTÉTELRE -- a fájlban
   * a `canAssignAssets ? (` szöveg KÉTSZER fordul elő (az "Eltávolítás" gomb
   * saját, soronkénti ága is ugyanígy kezdődik), egy puszta
   * `/canAssignAssets \? \(/` állítás tehát AZ ELTÁVOLÍTÁS GOMBRA is zölden
   * futna akkor is, ha a hozzárendelő rész feltétel NÉLKÜL renderelődne --
   * kalibrálva: `true ? (` a hozzárendelő ágon a puszta minta mellett is
   * zöld maradt.
   */
  it("a hozzárendelő rész feltételesen renderelődik, nem csak CSS-sel rejtett", () => {
    const s = kod(AQUARIUM_ESZKOZOK);
    assert.match(s, /canAssignAssets \? \(\s*<div className="mt-3 border-t/);
  });

  it("a jelöltek közül kiszűri a már valahova csatolt eszközöket", () => {
    const s = kod(AQUARIUM_ESZKOZOK);
    assert.match(s, /filter\(\(item\) => !item\.aquarium\)/);
  });

  it("a levétel aquariumId: null-t küld", () => {
    const s = kod(AQUARIUM_ESZKOZOK);
    assert.match(
      s,
      /aquariumId: null,\s*\n\s*expectedUpdatedAt: asset\.updatedAt,/,
    );
  });

  it("a hozzárendelés a jelenlegi akvárium id-jét küldi, a jelölt updatedAt-jával", () => {
    const s = kod(AQUARIUM_ESZKOZOK);
    assert.match(
      s,
      /aquariumId,\s*\n\s*expectedUpdatedAt: candidate\.updatedAt,/,
    );
  });
});

/**
 * A "KALKULÁTOROK" BEKÖTÉSE -- FORRÁS-SZÖVEG ALAPÚ, UGYANAZZAL A HATÁRRAL,
 * MINT A FÁJL TÖBBI RÉSZE (ld. a `kod()` fejlécét).
 *
 * A KÉPLETEK SAJÁT, VALÓDI, VISELKEDÉS-ALAPÚ TESZTJE a
 * `packages/aquarium-calc/src/reef-chemistry.test.ts`-ben áll -- ott a
 * SZÁMÍTÁS helyessége van mérve, kézzel számolt referenciaértékekkel. Ez a
 * blokk csak azt méri, hogy a portál oldala a HELYES függvényt, a HELYES
 * mezőkkel hívja, és hogy a márkás termékek NEM kerültek be sehova.
 */
const KALKULATOROK_OLDAL = "src/components/calculators/calculators-page.tsx";
const PORTAL_SHELL_KALKULATOROK = "src/components/portal-shell.tsx";

/*
  A `CalculatorCard` MAGA 2026-09-25-TŐL A `packages/ui`-BAN ÉL, NEM ITT --
  Balázs kérése (a felület-független újrafelhasználhatóság), és a komponens
  MÁR aznap egy MÁSODIK felületre (`apps/web`) is átkerült. A kártya saját
  viselkedését (nincs-adagolás üzenet, nincs `useAuth`/felület-specifikus
  API-hívás) mérő állítások ezért a `packages/ui/src/calculator-card.test.ts`-
  be költöztek, a komponenssel együtt. Ami ITT marad, az a PORTÁL-SPECIFIKUS
  OLDAL (`calculators-page.tsx`) és a `portal-shell.tsx` kötése -- azok
  valóban ennek az appnak a részei.
*/
describe("a Kalkulátorok kötése", () => {
  it("POZITÍV KONTROLL: mindkét fájl olvasható és nem üres", () => {
    for (const ut of [KALKULATOROK_OLDAL, PORTAL_SHELL_KALKULATOROK])
      assert.ok(olvas(ut).length > 500, `${ut}: üres vagy gyanúsan rövid`);
  });

  it("mindhárom kalkulátor a megfelelő @acropora/aquarium-calc függvényt hívja", () => {
    const s = kod(KALKULATOROK_OLDAL);
    assert.match(
      s,
      /import\s*\{\s*\n?\s*alkalinityElevation,\s*\n?\s*calciumElevation,\s*\n?\s*magnesiumElevation,?\s*\n?\s*\}\s*from\s*"@acropora\/aquarium-calc"/,
    );
    assert.match(s, /calciumElevation\(\{/);
    assert.match(s, /magnesiumElevation\(\{/);
    assert.match(s, /alkalinityElevation\(\{/);
  });

  /**
   * A MAGNÉZIUM SÓ-VÁLASZTÁS TÉNYLEG A KÉT TISZTA SÓ KÖZÖTT DÖNT, NEM
   * EGY HARMADIK, MÁRKÁS OPCIÓT VÁLASZT KI CSENDBEN.
   */
  it("a magnézium kártya a választott só szerint MGCL2 vagy MGSO4 sót küld", () => {
    const s = kod(KALKULATOROK_OLDAL);
    assert.match(s, /"MGSO4_HEPTAHYDRATE"/);
    assert.match(s, /"MGCL2_HEXAHYDRATE"/);
  });

  /**
   * A MÁRKÁS TERMÉKEK VÉGLEGESEN KIMARADNAK -- Balázs 2026-09-25-i
   * pontosítása szerint ez NEM "egyelőre hiányzó" adat, hanem soha nem
   * ide való. MI PIROSÍT: ha bárki egy márkanevet (akár csak
   * összehasonlításként, akár kikommentezve) visszaírna.
   */
  it("egyetlen márkás termék neve sem szerepel a kalkulátor-oldal kódjában", () => {
    const oldalNyers = olvas(KALKULATOROK_OLDAL);
    for (const brandName of [
      "Kalkwasser",
      "B-Ionic",
      "Seachem",
      "Reef Builder",
    ]) {
      assert.doesNotMatch(oldalNyers, new RegExp(brandName));
    }
  });

  /**
   * A KIMENET GRAMM, NEM MILLILITER -- eltérés a Figma tervtől, szándékosan
   * (ld. a `reef-chemistry.ts` fejlécét). MI PIROSÍT: ha valaki a Kalcium
   * kártyát visszaállítaná "ml"-re.
   */
  it("mindhárom kalkulátor grammban ad eredményt", () => {
    const s = kod(KALKULATOROK_OLDAL);
    const resultUnitMatches = [...s.matchAll(/resultUnit="([^"]*)"/g)].map(
      (m) => m[1],
    );
    assert.ok(
      resultUnitMatches.length >= 3,
      `csak ${resultUnitMatches.length} resultUnit található, 3 kellene`,
    );
    for (const unit of resultUnitMatches) assert.equal(unit, "g");
  });

  it("az oldal ÚJRAFELHASZNÁLJA a meglévő partnerApi.aquariums/aquariumMeasurements hívást, nem ír újat", () => {
    const s = kod(KALKULATOROK_OLDAL);
    assert.match(s, /partnerApi\s*\n?\s*\.aquariums\(/);
    assert.match(s, /partnerApi\s*\n?\s*\.aquariumMeasurements\(/);
  });

  /**
   * A MENÜPONT ÉS AZ ÚTVONAL-VÉDELEM UGYANAZT A MINTÁT KÖVETI, MINT AZ
   * AKVÁRIUMOKÉ -- ld. `portal-shell.tsx` "calculators" ágának fejlécét.
   */
  it("a portál héja saját nav-bejegyzéssel véd a Kalkulátorok útvonalon, az Akváriumokéval azonos mintán", () => {
    const s = kod(PORTAL_SHELL_KALKULATOROK);
    assert.match(s, /CALCULATORS_NAV_ENTRY_ID\s*=\s*"calculators"/);
    assert.match(s, /canViewCalculators\s*=\s*hasNavigationEntry/);
    assert.match(s, /KALKULATOROK_HREF\s*=\s*"\/kalkulatorok"/);
    assert.match(s, /!canViewCalculators\s*&&\s*onCalculatorsRoute/);
  });
});

/**
 * A "MEGRENDELÉSEK" ÉS A "TELJESÍTÉSI IGAZOLÁSOK" -- Balázs sorrendjének
 * (emlék 1840) 5. része, acrobot jóváhagyása (msg_id 23868, 2026-09-25
 * 22:17 UTC), a `portal-megrendelesek-terv-2026-09-25.md` terv alapján.
 *
 * A HATÁR UGYANAZ, MINT A FÁJL TÖBBI RÉSZÉBEN (ld. a fejlécet): forrás-
 * szöveget mér, nem renderelt képernyőt.
 */
const MEGRENDELES_LISTA = "src/components/maintenance-order-list.tsx";
const MEGRENDELES_RESZLET = "src/components/maintenance-order-detail.tsx";
const IGAZOLAS_LISTA = "src/components/completion-certificate-list.tsx";
const IGAZOLAS_RESZLET = "src/components/completion-certificate-detail.tsx";
const PORTAL_SHELL_MEGRENDELES = "src/components/portal-shell.tsx";

describe("a Megrendelések és Teljesítési igazolások kötése", () => {
  it("POZITÍV KONTROLL: mind a négy fájl olvasható és nem üres", () => {
    for (const ut of [
      MEGRENDELES_LISTA,
      MEGRENDELES_RESZLET,
      IGAZOLAS_LISTA,
      IGAZOLAS_RESZLET,
    ])
      assert.ok(olvas(ut).length > 500, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * ÁR SEHOL. A szerver válasza (`MaintenanceOrderPartnerItem`/
   * `CompletionCertificatePartnerItem`) strukturálisan nem hordoz ár-mezőt,
   * de ez az állítás a FELÜLETET méri: egy jóhiszemű bővítés (pl. a belső
   * lapról átmásolt oszlop) itt buktatná le magát, mielőtt élesedne.
   */
  it("egyik lap sem ír ki árat, áfát vagy nettó/bruttó összeget", () => {
    for (const ut of [
      MEGRENDELES_LISTA,
      MEGRENDELES_RESZLET,
      IGAZOLAS_LISTA,
      IGAZOLAS_RESZLET,
    ]) {
      const s = kod(ut);
      for (const mezo of [
        "unitNet",
        "vatRatePercent",
        "netAmount",
        "vatAmount",
        "grossAmount",
      ])
        assert.ok(!s.includes(mezo), `${ut}: kiírja a(z) ${mezo} mezőt`);
    }
  });

  /**
   * A KIÁLLÍTÁS ÉS A VISSZAVONÁS NINCS A PORTÁLON -- ezek belső,
   * `PARTNERS_MANAGE`-es műveletek maradnak (lásd a szolgáltatás-réteg
   * fejlécét). MI PIROSÍT: ha bármelyik lap kiállító/visszavonó gombot vagy
   * hívást kapna.
   */
  it("a megrendelőlap adatlapja nem kínálja a kiállítást vagy a visszavonást", () => {
    const s = kod(MEGRENDELES_RESZLET);
    assert.ok(
      !/\/revoke|issueMaintenanceOrder|method: "POST".*maintenance-orders"/.test(
        s,
      ),
    );
  });

  /**
   * A LETÖLTÉS A VALÓDI TÁROLT FÁJLTÍPUST KÖVETI, NEM FELTÉTELEZ PDF-ET
   * ELŐRE -- a Figma terv `.pdf` fájlnév-feltevése (`{o.id}-megrendelolap.pdf`)
   * MA HAMIS a generált megrendelőlapra (docx). MI PIROSÍT: ha a lap egy
   * kitalált, `.pdf`-re végződő fájlnevet írna ki a szerver `fileName`
   * mezője helyett.
   */
  it("a megrendelőlap letöltése a szerver fileName/contentType mezőit használja, nem kitalált nevet", () => {
    const s = kod(MEGRENDELES_RESZLET);
    assert.match(s, /generated\.fileName/);
    assert.doesNotMatch(s, /-megrendelolap\.pdf/);
  });

  /**
   * A FELTÖLTŐ KÁRTYA KÉT FELTÉTELHEZ KÖTŐDIK, mindkettő a szervertől jön:
   * az állapot ÉS a `canUploadSigned` képesség-jelző. MI PIROSÍT: ha a
   * kártya feltétel nélkül, vagy csak az egyik feltétellel jelenne meg --
   * az utóbbi minden `SERVICE_MANAGE`-es partner-fióknak megnyitná a
   * feltöltést, holott a kapu felhasználónkénti.
   */
  it("a megrendelőlap feltöltő kártyája az állapot ÉS a canUploadSigned mögött áll", () => {
    const s = kod(MEGRENDELES_RESZLET);
    assert.match(s, /order\.status === "ISSUED" && order\.canUploadSigned/);
  });

  it("a teljesítési igazolás feltöltő kártyája a hiány ÉS a canUploadSigned mögött áll", () => {
    const s = kod(IGAZOLAS_RESZLET);
    assert.match(s, /!hasSignedDocument && certificate\.canUploadSigned/);
  });

  /**
   * AZ IGAZOLÁS LISTÁJA SZÖVEGET ÍR AZ ALÁÍRT PÉLDÁNY OSZLOPBA, NEM
   * JELVÉNYT -- az igazolásnak nincs állapota (lásd a séma fejlécét).
   */
  it("a teljesítési igazolás listája nem jelvénnyel jelzi az aláírt példányt", () => {
    const s = kod(IGAZOLAS_LISTA);
    assert.match(s, /feltöltve/);
    assert.match(s, /még nincs/);
    assert.doesNotMatch(s, /PilotBadge/);
  });

  /**
   * A MENÜPONT ÉS AZ ÚTVONAL-VÉDELEM UGYANAZT A MINTÁT KÖVETI, MINT AZ
   * AKVÁRIUMOKÉ/KALKULÁTOROKÉ -- két KÜLÖN nav-bejegyzés, két KÜLÖN kapu.
   */
  it("a portál héja saját nav-bejegyzéssel véd mindkét útvonalon", () => {
    const s = kod(PORTAL_SHELL_MEGRENDELES);
    assert.match(
      s,
      /MAINTENANCE_ORDERS_NAV_ENTRY_ID\s*=\s*"maintenance-orders"/,
    );
    assert.match(
      s,
      /COMPLETION_CERTIFICATES_NAV_ENTRY_ID\s*=\s*"completion-certificates"/,
    );
    assert.match(s, /canViewMaintenanceOrders\s*=\s*hasNavigationEntry/);
    assert.match(s, /canViewCompletionCertificates\s*=\s*hasNavigationEntry/);
    assert.match(s, /MEGRENDELESEK_HREF\s*=\s*"\/megrendelesek"/);
    assert.match(
      s,
      /TELJESITESI_IGAZOLASOK_HREF\s*=\s*"\/teljesitesi-igazolasok"/,
    );
    assert.match(
      s,
      /!canViewMaintenanceOrders\s*&&\s*onMaintenanceOrdersRoute/,
    );
    assert.match(
      s,
      /!canViewCompletionCertificates\s*&&\s*onCompletionCertificatesRoute/,
    );
  });

  /**
   * A KÉT ÚJ MENÜTÉTEL SORONKÉNT SZŰRVE JELENIK MEG, A HÁROM RÉGI
   * FELTÉTEL NÉLKÜL -- ugyanaz a minta, mint az Akvarisztika csoportnál.
   */
  it("a Műszaki menü a két új tételt entryId szerint szűri", () => {
    const s = kod(PORTAL_SHELL_MEGRENDELES);
    assert.match(
      s,
      /MUSZAKI_MENU\.filter\(\s*\(item\) =>\s*!item\.entryId \|\| hasNavigationEntry\(user, item\.entryId\),\s*\)\.map\(\(item\) => \{/,
    );
    assert.match(s, /entryId:\s*"maintenance-orders"/);
    assert.match(s, /entryId:\s*"completion-certificates"/);
  });
});
