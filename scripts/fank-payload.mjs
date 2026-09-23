#!/usr/bin/env node
/**
 * EGY HELYSZIN-KODBOL ELOALLITJA A BETOLTESI PAYLOADOT -- NEM KULDI EL.
 *
 * Acrobot kerese, 2026-09-23 21:20: Balazs ket helyszint kert ma este (LSS23,
 * LSS22), mindkettot kezzel toltotte be, es a menet ISMETLODO volt: minden
 * lepese megkereshetetlen. Ez a szkript a forras TSV-bol es a partner
 * helyszin-listajabol (`GET /suppliers/<partner-id>/units`) allitja elo a
 * `CreateAssetDto`-alaku sorokat egy adott helyszinre -- kiirja OKET, nem kuld
 * semmit sehova, es nem dont sorszamozasrol.
 *
 * === AMI MEREVE VAN, NEM TALALVA (a payload-mezok forrasa) ===
 *
 *   ownerType/ownerId      SUPPLIER / cmt34n8s20009pg07pg8kwue1 -- acrobot
 *                          kozvetlen kozlese
 *   departmentId           a talalt helyszin (unit) SAJAT id-je -- a
 *                          `SuppliersController.units()` valasza flat listat
 *                          ad {id, parentId, code, name, isActive} alakban
 *                          (lasd apps/api/src/suppliers/suppliers.repository.ts,
 *                          `units()`), es az `Asset.departmentId` UGYANERRE a
 *                          `WorksheetDepartment` tablara mutat (lasd
 *                          apps/api/src/service-assets/dto/asset.dto.ts
 *                          departmentId jegyzetet: "A partner ALEGYSEGE").
 *   electricalCode         a TSV "A" oszlopanak TELJES szovege, valtoztatas
 *                          nelkul (pl. "022-3-003 / 62M") -- acrobot
 *                          kozvetlen kozlese, letezo eszkozon visszamerve.
 *   partnerInternalCode    <HELYSZIN>-<KOD>-<SORSZAM>, vagy <HELYSZIN>-<KOD>
 *                          ha a forrasban nincs sorszam (TSV "D" oszlop) --
 *                          acrobot kozvetlen kozlese.
 *   kind                   "EQUIPMENT" -- EZ NEM ACROBOT KOZLESE, hanem a MAR
 *                          MEGLEVO termek-alapertelmezes: a web
 *                          (asset-editor-page.tsx:75) es a mobil
 *                          (assets/new.tsx:149) felvitel is EBBOL indul.
 *                          Felulirhato --kind kapcsoloval.
 *
 * === A NEV -- ACROBOT MASODIK KOREBEN MEREVE, VALODI BETOLTESBOL (LSS07) ===
 *
 *   Ket kulon szabaly, a szam ket kulon alakjaval -- lasd `buildName()` sajat
 *   fejleceben a teljes indoklast:
 *     ONALLO eszkoz:    <szulo>/<helyszin> <magyar eszkoznev> <ROMAI szam>
 *     BEEPITETT eszkoz: <szulo>/<helyszin> <szulo neve> <sajat neve> <ARAB, 2 jegy>
 *   A magyar nevek a kategoria-terkepbol jonnek (`--kategoria-terkep`) --
 *   terkep nelkul a nyers kod marad a nev helyen.
 *
 *   EGYETLEN NYITOTT PONT MARADT: a BEEPITETT ag konkret osszefuzesi alakjat
 *   ("szulo neve" + "sajat neve" + szam, szokozzel elvalasztva) csak KET
 *   PELDABOL vezettem le, es a masodik pelda ("Homokszűrő szivattyú 01")
 *   Hungaria neve NEM szerepel szo szerint a mai kategoria-terkepben -- tehat
 *   ez a resz VALSZINU, nem bizonyitott ugyanugy, mint a fenti tobbi. Ha egy
 *   BEEPITETT eszkozos helyszinen a kiirt nev nem egyezik a valodi mintaval,
 *   ezt a fuggvenyt kell ujra megnezni, nem a tobbit.
 *
 * === A SORSZAM FORRASA -- D (ONALLO) VAGY F (BEEPITETT), NAUTILUS MERESE
 *     ES KETSZERES FUGGETLEN VISSZAMERES, 2026-09-23 21:xx-22:12 ===
 *
 *   D (Eszkoz sorszam)             ONALLO soron: partnerInternalCode +
 *                                  name sorszama (roman).
 *   F (Beepitett szerelveny        BEEPITETT soron: partnerInternalCode +
 *     sorszama)                    name sorszama (2 jegyu arab). Nautilus
 *                                  sajat merese: F nelkul a valodi LSS21
 *                                  543/544. sora utkozott volna (ket VPU
 *                                  egy CPT alatt). Murena fuggetlenul,
 *                                  masik helyszinen (ETB 612-614) UGYANERRE
 *                                  a hianyra futott -- ket kulon meres,
 *                                  ugyanaz az eredmeny.
 *
 *   A D (Eszkoz sorszam) EGY BEEPITETT SORON -- MEGOLDVA, acrobot masodik,
 *   fuggetlen visszameres kore, 2026-09-23 22:38 (barracuda fuggetlenul,
 *   a forras fejlecebol kiindulva, UGYANAZT a bontast merte -- ket
 *   fuggetlen meresen all a szabaly). A valodi forrasban 130 beepitett
 *   soron D IS ki van toltve; a sejtes, hogy ez NEM gyermek-sorszam, hanem
 *   azt mondja meg, MELYIK SZULO-PELDANY(OK) ala tartozik a gyermek,
 *   MEGERSITVE: 114/130 sornal a szulo-peldany(ok) TENYLEGESEN letezik
 *   (letezenek) a listaban ONALLO sorkent (108 sor egyetlen D-erteket
 *   visel, 6 sor "01/02" alaku ketto D-erteket -- ez utobbi egy gyermek,
 *   ami EGYSZERRE ket fizikai szulohoz tartozik, acrobot dontese,
 *   2026-09-23 22:54, a valodi LSS12/HSZ/PUM 318-323. sorara). A tobbi 16
 *   sorhoz NINCS onallo sor (a D legalabb egyik reszehez) ugyanazzal a
 *   C-vel a helyszinen -- ezt acrobot Balazs ele viszi. `buildSitePayload`
 *   a 114 sort atengedi (a D MINDEN resze bekerul
 *   `buildPartnerInternalCode` C-utani szegmensebe, a forras sajat
 *   sorrendjeben, kotojellel osszekapcsolva), a masik 16-ot tovabbra is
 *   MEGALLASI OKKENT kezeli -- lasd ott a reszletes indoklast.
 *
 * === AMI SZANDEKOSAN KIMARAD, MERT A FELOLDASAHOZ HIANYZIK A BEMENET ===
 *
 *   categoryId              A --kategoria-terkep NELKUL meg mindig kimarad
 *                           minden sorbol (a kod-kategoria terkep egy masik
 *                           helyszinen, egy masik korben keszult el -- ha
 *                           MEGSEM adod at, ez a viselkedes az alapertelmezes,
 *                           es a szkript csak FIGYELMEZTET, nem all meg,
 *                           mert ez utolag potolhato). --kategoria-terkep
 *                           MEGADASA UTAN viszont MAR NEM ez a viselkedes --
 *                           lasd a "STOP" listat lejjebb.
 *
 * === A performance/performanceUnitId -- acrobot harmadik ES NEGYEDIK kore ===
 *
 *   A ketto egyutt mozog (Asset_performance_pairing_check adatbazis-megkotes,
 *   lasd a DTO jegyzetet). A performanceUnitId `PERFORMANCE_UNIT_M3PH`
 *   allando (forras: GET /units-of-measure?kind=PERFORMANCE, acrobot mert
 *   erteke, 2026-09-23 21:45) -- DE EZ A DEFAULT NEM ELLENORZOTT SORONKENT:
 *   a TSV "M" oszlop FEJLECE m3/h-t mond, a CELLAK kozott viszont acrobot
 *   ket olyat talalt (2026-09-23 22:01), ami MAS mertekegyseget visel
 *   ("50-160 l", "50-160l/min") -- a fejlec tehat NEM garancia minden
 *   sorra, csak a tobbsegre. Ma ez azert nem okoz csendes hibat, mert
 *   mindket sor amugy is elbukik az ALAK-ellenorzesen (lasd lent) -- de ha
 *   valaha egy MAS mertekegysegu cella egyetlen tiszta szamot tartalmazna,
 *   azt ez a szkript NEM venne eszre. Ez a lapon nyitva marad, nem
 *   javitas.
 *
 *   A performance ERTEKE NEM SZABAD SZOVEG: a szolgaltatas a kozos
 *   `normalizeMeasurementValue`-val ellenorzi (`^\d{1,13}(?:\.\d{1,6})?$` --
 *   egy szam, legfeljebb hat tizedessel), es ami nem ilyen, arra 400-at ad.
 *   Acrobot lemerte a teljes forras "M" oszlopat ezen a mintan: 136 kitoltott
 *   cellabol 114 at megy, 22 nem. Ket kulon eset, ket kulon feloldassal:
 *     KEREKITHETO (6 sor, "146.69999999999999" alaku): UGYANAZ a szam, csak
 *       tobb, mint hat tizedesre irva -- `normalizeMeasurementValue()` hat
 *       tizedesre kerekiti, es a szkript KULON kilistazza, melyik sorokon
 *       tortent (lasd `buildSitePayload`), hogy ez LATHATO maradjon.
 *     NEM EGYETLEN SZAM (16 sor, pl. "175/210", "31-29-26", "45 (40)",
 *       "50-160 l"): tobb ertek, tartomany, vagy nem m3/h mertekegyseg --
 *       ezeket NEM lehet kerekitessel vagy talalgatassal egyetlen szamma
 *       alakitani. Ugyanaz a "ne talalgass" szabaly vonatkozik rajuk, mint
 *       a hianyzo kategoriara: a szkript MEGALL, es megnevezi a sorokat --
 *       acrobot dontse el helyszinenkent, melyik ertek menjen be es mi
 *       keruljon a description-be.
 *
 * === A volume -- UGYANAZ A FUGGVENY, UGYANAZ A KET ESET, acrobot negyedik
 *     kore, 2026-09-23 22:02 (ugyanabban a korben, mint a performance) ===
 *
 *   A DTO sajat jegyzete szo szerint kimondja: a volume-ot a kozos
 *   `normalizeMeasurementValue` ellenorzi, ugyanugy, mint a performance-ot --
 *   tehat ugyanaz a fuggveny, ugyanaz a ket kimenet. A teljes forras "L"
 *   oszlopat (Terfogat) lemerve: 59 kitoltott cellabol 53 at megy, 6 nem --
 *   3 KEREKITHETO (ugyanaz a lebegopontos csalad, mint a performance-nel),
 *   1 NEM SZAM ("TRI" -- valaki harom betut irt a terfogat-oszlopba), es 2
 *   MERTEKEGYSEG-GYANUS.
 *
 *   A LEGVESZELYESEBB SOR A TELJES SZKRIPTBEN: "940 liter" (LSS10). A
 *   `volume` mezo MINDIG m3-ben ert (DTO jegyzet), a cella viszont literben
 *   all -- ha valaki csak a "liter" szot vagna le a szamrol, 940 KOBMETER
 *   menne be 0,94 helyett, EZERSZERES hiba, es a szam utana tokeletesen
 *   hihetonek latszana. Ezert ez SEM automatikus atvaltas: a szkript ezt a
 *   fajta sort is a "NEM egyetlen szam" agon MEGALLITJA (a "liter" szo
 *   miatt a `normalizeMeasurementValue` amugy sem engedne at), es acrobot
 *   donti el helyszinenkent, mi legyen az atvaltott ertek.
 *
 * === AMIT A SZKRIPT SOSEM CSINAL, ES NYOLC "ALLJON MEG" ESET ===
 *
 *   - nem kuld HTTP-hivast, nem ir semmilyen rendszerbe
 *   - HA EGY BEEPITETT SORON D (Eszkoz sorszam) LEGALABB EGY RESZEHEZ NINCS
 *     ugyanazzal a C-vel onallo szulo-sor a helyszinen, MEGALL -- lasd a
 *     fajl elejen "A SORSZAM FORRASA" szakaszat. Ahol MINDEN resz talal
 *     szulot (egyetlen D-ertek, vagy "01/02" alaku ketto, mindket resz
 *     letezo szulore mutatva), a szkript mar feloldja: a D MINDEN resze
 *     bekerul a partnerInternalCode-ba, a forras sajat sorrendjeben.
 *   - nem sorszamoz: ha egy partnerInternalCode UTKOZIK (ket sor ugyanoda esne
 *     serial nelkul), MEGALL, es kiirja, melyik `sor` szamok utkoznek
 *   - nem valaszt helyszint, ha a kod TOBBSZOR fordul elo a partner
 *     egysegei kozott -- ALLJON MEG, ne talalgasson
 *   - HA --kategoria-terkep MEGVAN ADVA, egy abbol HIANYZO kod is megallasi
 *     ok (acrobot masodik kore, 2026-09-23 21:36): a terkepet nautilus es
 *     acrobot SZO SZERINTI egyezesre epitettek (nem nev-hasonlosagra), es
 *     egy par kodot (a mai peldaban: OCS/HSZ) SZANDEKOSAN nem oldottak fel
 *     talalgatassal -- ha egy sor ilyen kodra fut, a szkript sem talalgat.
 *   - HA A TELJESITMENY (M oszlop) VAGY A TERFOGAT (L oszlop) TOBB, MINT EGY
 *     SZAM -- tartomany, tobb ertek vagy nem a vart mertekegyseg (acrobot
 *     harmadik es negyedik kore, 2026-09-23 22:01-22:02, EGY korben) --
 *     MEGALL, es megnevezi a sorokat, mezonevvel egyutt. Amit KEREKITHET
 *     (ugyanaz a szam, csak tul sok tizedessel), azt kerekiti ES kulon
 *     jelzi -- ez NEM megallasi ok, csak lathato valtoztatas.
 *   - a payload eloallitasa UTAN, meg a kiiras ELOTT, ujra ellenorzi, hogy a
 *     generalt partnerInternalCode ertekek EGYEDIEK -- acrobot sajat szavaival:
 *     "nalam ez egy sor volt, es pont az LSS22-n sult el"
 *   - HA --meglevo-eszkozok MEGVAN ADVA, es egy BEEPITETT sor EGYETLEN,
 *     NEM osszetett D-erteku szuloje NINCS a fajlban MAR LETEZO eszkozkent,
 *     MEGALL -- lasd `resolveParentAssetId` fejleceben (acrobot masodik
 *     kore, 2026-09-23 23:31). A szkript itt sem talal ki azonositot.
 *
 * === A BEMENET/KIMENET SORSZAMA MINDIG OSSZE VAN VETVE -- acrobot kikotese,
 *     2026-09-23 22:04, egy SAJAT masik hibaja utan (54 sorbol kevesebb jott
 *     ki, es nem tunt fel) ===
 *
 *   Minden futas a stderr-re irja: "<helyszin>: N bemeneti sor - K kihagyva
 *     = M kimeneti eszkoz". Ez NEM opcionalis reszlet, hanem a legrosszabb
 *     fajta hibat fogja meg: amikor a szkript nem hibazik, csak CSENDBEN
 *     kevesebbet ad ki. Ha valaha N-K != M, `buildSitePayload` MEGALL --
 *     ez belso ellentmondas, sosem szabadna elofordulnia, de ha megis, a
 *     hivo NE kuldje el a payloadot.
 *
 * HASZNALAT:
 *   node scripts/fank-payload.mjs LSS22 --kihagy 563 \
 *     --units exchange/fank-units.json
 *   (vagy a bash burok: scripts/fank-payload.sh LSS22 --kihagy 563 ...)
 *
 * KAPCSOLOK:
 *   --tsv <ut>              alapertelmezes: a telepites sajat
 *                           exchange/FANK-teljes-lista-JAVITOTT-2026-09-23.tsv
 *                           fajlja (lasd FANK_TSV_DEFAULT lent) -- EZ
 *                           UZEMELTETOI ALAPERTELMEZES, NEM TERMEK-UT: masik
 *                           telepitesen --tsv nelkul nem fog talalni semmit.
 *   --units <ut>            KOTELEZO. A `GET /suppliers/<partner>/units`
 *                           JSON valasza ({"items":[{id,parentId,code,name,
 *                           isActive}, ...]}), fajlba mentve -- ez a szkript
 *                           nem er el elo API-t.
 *   --kategoria-terkep <ut> opcionalis, DE HA MEGADOD, MINDEN kodot fednie
 *                           kell -- lasd a "STOP" listat fent. Formatum:
 *                           oszlopra igazitott szoveg, egy sor egy kodra,
 *                           "<KOD>  <magyar nev>  <categoryId-UUID>  <honnan>"
 *                           alakban (pl. exchange/FANK-kod-kategoria-
 *                           azonositok-2026-09-23.txt). A KOD sima
 *                           eszkoz-kod, vagy "<SZULO>/<SAJAT>" par beepitett
 *                           alkatreszre (SZOKOZ NELKUL a "/" korul). A `#`-tal
 *                           kezdodo sorok fejlec-megjegyzesek.
 *   --kihagy <sor[,sor...]> a TSV "sor" oszlopanak ertekei, amiket ki kell
 *                           hagyni -- ismetelheto, vagy vesszovel elvalasztva.
 *   --meglevo-eszkozok <ut> opcionalis. `{"items":[{"partnerInternalCode",
 *                           "id"},...]}` alaku JSON -- MAR LETEZO, valodi
 *                           eszkozok listaja (pl. egy korabbi futas mar
 *                           elkuldott es visszaigazolt payloadjabol). HA
 *                           MEGADOD, egy BEEPITETT sor (E kitoltve) EGYETLEN,
 *                           NEM osszetett D-erteku szuloje ebbol oldodik fel
 *                           `parentAssetId`-kent -- lasd `resolveParentAssetId`
 *                           fejleceben, miert csak ez az egy eset probalkozik,
 *                           es miert STOP, ha a szulo nincs a listaban. E
 *                           NELKUL a viselkedes BETUre a regi: semmilyen sor
 *                           sem kap `parentAssetId`-t.
 *   --partner <id>          alapertelmezes: cmt34n8s20009pg07pg8kwue1 (FANK).
 *   --kind <ASSET_KIND>     alapertelmezes: EQUIPMENT.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Lasd a fejlec "AMI NEM MEREVE VAN" szakaszat: ez UZEMELTETOI, telepites-
// specifikus alapertelmezes, nem termek-ut.
export const FANK_TSV_DEFAULT =
  "/home/marveen/marveen/exchange/FANK-teljes-lista-JAVITOTT-2026-09-23.tsv";
export const FANK_PARTNER_DEFAULT = "cmt34n8s20009pg07pg8kwue1";
export const ASSET_KIND_DEFAULT = "EQUIPMENT";
// A TSV "M" oszlopa (Teljesitmeny) a SAJAT fejleceben m3/h-t mond -- DE ez
// FEJLEC-SZINTU allitas, nem soronkent ellenorzott. Lasd a fajl fejlecenek
// "performance/performanceUnitId" szakaszat: acrobot ket olyan cellat
// talalt, ami MAS mertekegyseget visel, es amit ma csak a szam-alak
// ellenorzese fog meg, nem ez az allando maga.
export const PERFORMANCE_UNIT_M3PH = "uom_perf_m3ph";

export class FankPayloadError extends Error {}

/** Egyszeru TSV-sorolo: idezojel nelkuli, tab-elvalasztott sorok. */
export function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((line) => line.split("\t"));
  return { header, rows };
}

const COLUMN = {
  sor: 0,
  electricalCode: 1,
  site: 2,
  deviceCode: 3,
  deviceSerial: 4,
  builtin: 5,
  builtinSerial: 6,
  manufacturer: 7,
  model: 8,
  detail: 9,
  uid: 10,
  quantity: 11,
  volume: 12,
  performance: 13,
  powerConsumptionRaw: 14,
};

function cell(row, index) {
  const value = row[index];
  return typeof value === "string" ? value.trim() : "";
}

/** Egy TSV-sor a mezonevekre bontva -- nyers szoveg, meg nem ertelmezve. */
export function toTsvRow(row) {
  return {
    sor: cell(row, COLUMN.sor),
    electricalCode: cell(row, COLUMN.electricalCode),
    site: cell(row, COLUMN.site),
    deviceCode: cell(row, COLUMN.deviceCode),
    deviceSerial: cell(row, COLUMN.deviceSerial),
    builtin: cell(row, COLUMN.builtin),
    builtinSerial: cell(row, COLUMN.builtinSerial),
    manufacturer: cell(row, COLUMN.manufacturer),
    model: cell(row, COLUMN.model),
    detail: cell(row, COLUMN.detail),
    uid: cell(row, COLUMN.uid),
    volume: cell(row, COLUMN.volume),
    performance: cell(row, COLUMN.performance),
    powerConsumptionRaw: cell(row, COLUMN.powerConsumptionRaw),
  };
}

/**
 * A KATEGORIA-TERKEP SAJAT KULCSA EGY SORHOZ. ONALLO sornal (nincs beepitett
 * alkatresz) a sima eszkoz-kod; BEEPITETT sornal a "<SZULO>/<SAJAT>" alak --
 * SZOKOZ NELKUL a "/" korul, pontosan ahogy a kategoria-terkep MASODIK,
 * javitott valtozata hasznalja (pl. "CPT/CAR"). Az ELSO valtozat meg
 * szokozzel irta ("CPT / TRI") -- acrobot ujraepitese, 2026-09-23 21:51,
 * ezt is megvaltoztatta.
 */
export function categoryKeyFor(row) {
  return row.builtin ? `${row.deviceCode}/${row.builtin}` : row.deviceCode;
}

const ROMAN_TABLE = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/** Arab -> roman szamalak, csak pozitiv egeszekre. */
export function toRoman(n) {
  let num = n;
  let out = "";
  for (const [value, symbol] of ROMAN_TABLE) {
    while (num >= value) {
      out += symbol;
      num -= value;
    }
  }
  return out;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

// A SZOLGALTATAS SAJAT `normalizePerformanceValue` fuggvenyenek mintaja --
// acrobot merese, 2026-09-23 22:01. UGYANEZ A FUGGVENY ellenorzi a `volume`
// mezot IS a szerver oldalon (lasd a DTO sajat jegyzetet: "az ALAKOT a
// szolgaltatas ellenorzi a kozos normalizePerformanceValue fuggvennyel,
// ugyanugy, mint a volume-nal") -- acrobot masodik merese, 2026-09-23
// 22:02, ugyanabban a korben, ezert EGY fuggveny szolgalja ki mindket
// mezot, nem ket kulon masolat.
const MEASUREMENT_VALUE_RE = /^\d{1,13}(?:\.\d{1,6})?$/;

/**
 * EGY NYERS CELLA (M vagy L oszlop) -> ERVENYES ERTEK, VAGY `null`, HA NEM
 * AZ. Ket kimenet lehetseges:
 *   { value, rounded: false }  mar eleve megfelel a mintanak, valtozatlan
 *   { value, rounded: true }   szam volt, de tobb mint hat tizedessel --
 *                              hat tizedesre kerekitve (acrobot dontese,
 *                              mert a hat a sema sajat pontossaga, nem egy
 *                              itt valasztott szam)
 *   null                       NEM egyetlen szam (tobb ertek, tartomany,
 *                              mertekegyseg a szamban stb.) -- ezt a hivo
 *                              NEM kerekitheti es NEM talalgathatja.
 */
export function normalizeMeasurementValue(raw) {
  if (MEASUREMENT_VALUE_RE.test(raw)) return { value: raw, rounded: false };
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  const kerekitve = Math.round(num * 1e6) / 1e6;
  const asString = String(kerekitve);
  if (!MEASUREMENT_VALUE_RE.test(asString)) return null;
  return { value: asString, rounded: true };
}

const CATEGORY_LINE_RE = /^(\S+)\s{2,}(.*)$/;
const UUID_SEARCH_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * A KATEGORIA-TERKEP FAJL SOROLASA -- NEM JSON, HANEM OSZLOPRA IGAZITOTT
 * SZOVEG (nautilus + acrobot kozos munkaja, 2026-09-23, MASODSZOR
 * ujraepitve 21:51-kor). Egy sor:
 * "<KOD>  <MAGYAR NEV>  <categoryId-UUID>  <honnan>". A KOD vagy sima
 * eszkoz-kod, vagy "<SZULO>/<SAJAT>" par -- SZOKOZ NELKUL a "/" korul (az
 * elso valtozat meg szokozzel irta, lasd `categoryKeyFor`). `#`-tal kezdodo
 * vagy ures sorok fejlec-megjegyzesek, at vannak ugorva.
 *
 * A POZICIONALIS OSZLOP-SZELESSEG NEM MEGBIZHATO: hosszabb magyar neveknel a
 * nev es az UUID kozotti tavolsag EGYETLEN szokozre eshet ossze (mert az
 * igazitas a rovidebb nevekhez van szabva), tehat egy "2+ szokoz" alapu
 * hasabolas a nev-UUID hataron elvagna a nevet. Ezert a sorolas az UUID-t a
 * SAJAT ALAKJABOL keresi meg a sorban (nem a vegen, mert a "honnan" oszlop
 * MOGOTTE all), es minden, ami elotte/utana marad, nev/honnan.
 *
 * A "HONNAN" OSZLOPOT A SOROLAS MEGORZI (`entry.honnan`), de MA egyetlen
 * hivo sem hasznalja -- a mezo a kesobbi diagnosztikahoz all keszen, nem
 * ELVARAS. acrobot sajat hibaja (2026-09-23 21:51) eppen abbol jott, hogy
 * a "honnan" erteket egy SZURESI ALLAPOTBOL (talalt-e azonositot) vezette
 * le, nem egy VALODI forras-oszlopbol -- ez a mezo most mar NAUTILUS sajat
 * oszlopabol jon, es ez a sorolo csak atveszi, nem szamolja ki.
 */
export function parseCategoryMap(text) {
  const map = {};
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const kodMatch = CATEGORY_LINE_RE.exec(raw.trimEnd());
    if (!kodMatch)
      throw new FankPayloadError(
        `A kategoria-terkep egy sora nem ertelmezheto (kod, majd legalabb ket szokoz vart): ${JSON.stringify(
          raw,
        )}`,
      );
    const kod = kodMatch[1];
    const rest = kodMatch[2].trim();
    const uuidMatch = UUID_SEARCH_RE.exec(rest);
    if (!uuidMatch)
      throw new FankPayloadError(
        `A kategoria-terkep "${kod}" soraban nem talaltam categoryId-UUID-t: ${JSON.stringify(
          raw,
        )}`,
      );
    const name = rest.slice(0, uuidMatch.index).trim();
    const honnan = rest.slice(uuidMatch.index + uuidMatch[0].length).trim();
    map[kod] = { name, categoryId: uuidMatch[0], honnan: honnan || null };
  }
  return map;
}

/**
 * A HELYSZIN EGYSEGE -- EGYEDISEG-ELLENORZESSEL. Acrobot kikotese: ha a kod
 * tobbszor fordul elo, a szkript ALLJON MEG, ne valasszon.
 */
export function resolveUnit(units, siteCode) {
  const matches = units.filter((u) => u.code === siteCode);
  if (matches.length === 0)
    throw new FankPayloadError(
      `Nincs "${siteCode}" kodu helyszin a partner egysegei kozott.`,
    );
  if (matches.length > 1)
    throw new FankPayloadError(
      `A "${siteCode}" kod NEM EGYEDI a partner egysegei kozott (${matches.length} talalat: ${matches
        .map((u) => u.id)
        .join(
          ", ",
        )}). Ez a szkript nem valaszt -- oldd fel a kollekziot a forrasban.`,
    );
  const unit = matches[0];
  if (!unit.parentId)
    throw new FankPayloadError(
      `A "${siteCode}" helyszinnek nincs szuloje (parentId hianyzik) -- a nev elotagja igy nem allithato elo.`,
    );
  const parent = units.find((u) => u.id === unit.parentId);
  if (!parent)
    throw new FankPayloadError(
      `A "${siteCode}" helyszin szuloje (${unit.parentId}) nem szerepel az egyseg-listaban.`,
    );
  return { unit, parentCode: parent.code };
}

/**
 * ONALLO SOR: <HELYSZIN>-<KOD>-<SORSZAM>, vagy <HELYSZIN>-<KOD> ha nincs
 * sorszam (D oszlop).
 *
 * BEEPITETT SOR: <HELYSZIN>-<KOD>[-<D>]-<SAJAT KOD>-<SORSZAM>, vagy a
 * sorszam nelkuli alak -- nautilus merese (agents/nautilus/fank-oszlop-terkep-
 * 2026-09-23.md): "E ... szerepe: ... a partnerInternalCode gyermek-
 * szegmense", es "F ... amikor egy szulo alatt TOBB azonos E-kodu gyermek
 * all... ez kulonbozteti meg oket. A partnerInternalCode ... sorszam-
 * reszebe megy." A sajat kod (E) NELKUL ket KULONBOZO gyermek (pl. egy TRI
 * es egy VAL) ugyanazon szulo alatt UGYANAZT a kodot kapna -- ezt a
 * korabbi valtozat helytelenul csinalta, csak C-t es D-t hasznalt.
 *
 * A SORSZAM FORRASA A BEEPITETT AGON F (`row.builtinSerial`), NEM D --
 * nautilus lemerte, hogy F=01/02 kulonbozteti meg a ket azonos-kodu
 * gyermeket (pl. ket VPU egy CPT alatt), es hogy F NELKUL a valodi LSS21
 * 543/544. sora utkozott volna.
 *
 * A D (`row.deviceSerial`) EGY BEEPITETT SORON MOST MAR BEKERUL A KOD C-UTANI
 * SZEGMENSEBE, acrobot masodik, fuggetlen visszameres kore, 2026-09-23
 * 22:38: a D itt nem gyermek-sorszam, hanem azt mondja meg, MELYIK
 * SZULO-PELDANY ala tartozik a gyermek. `buildSitePayload` mar csak azokat
 * a sorokat engedi ide, ahol a D minden resze (lasd lejjebb) egyertelmuen
 * egy letezo ONALLO szulo-sorra mutat (lasd ott a "beepitettD" ellenorzest)
 * -- e nelkul egy helyszinen tobb egyforma C-kodu szulo eseten a gyermek
 * CSENDBEN a rossz szulo ala kerulne (ugyanaz a C, ugyanaz az E/F, de mas
 * fizikai szulo-peldany).
 *
 * A D OSSZETETT ALAKJA ("01/02"): acrobot dontese, 2026-09-23 22:54,
 * LSS12/HSZ/PUM valodi sorain lemerve (318-323. sor) -- egy gyermek
 * EGYSZERRE tartozhat KET fizikai szulohoz (itt: egy szivattyu ket
 * homokszuro kozott). A kod MINDKET szulot viseli, a FORRAS SAJAT
 * SORRENDJEBEN, kotojellel osszekapcsolva (`LSS12-HSZ-01-02-PUM-01`) --
 * NEM csak az elsot, mert a partnerInternalCode kereshetu mezo, es a
 * masodik szulora keresve is elo kell jonnie a gyermeknek. Utkozes ebbol
 * nem szarmazhat: a gyermek-szegmens (E) helyen mindig BETUS eszkozkod all
 * (PUM, FIB, SKI...), szam soha, tehat a D-D-E hatar egyertelmu.
 */
export function buildPartnerInternalCode(siteCode, row) {
  if (row.builtin) {
    const szuloReszek = row.deviceSerial
      ? row.deviceSerial
          .split("/")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const szuloSzegmens = [row.deviceCode, ...szuloReszek].join("-");
    const base = `${siteCode}-${szuloSzegmens}-${row.builtin}`;
    // pad2, UGYANUGY, mint a nev arab-szamos resze -- a valodi forras F
    // ertekei mar eleve ket jegyuek (01/02), de ne fugjon ettol.
    return row.builtinSerial ? `${base}-${pad2(row.builtinSerial)}` : base;
  }
  return row.deviceSerial
    ? `${siteCode}-${row.deviceCode}-${row.deviceSerial}`
    : `${siteCode}-${row.deviceCode}`;
}

/**
 * A MEGLEVO-ESZKOZOK FAJL SOROLASA -- `{"items":[{"partnerInternalCode","id"},...]}`
 * alaku JSON, UGYANOLYAN "lementett API-valasz" jellegu bemenet, mint a
 * `--units`. A `GET /service/assets`-bol (vagy egy korabbi futas mar
 * elkuldott es visszaigazolt payloadjabol) allithato ossze, es KIZAROLAG
 * arra szolgal, hogy egy BEEPITETT sor `parentAssetId`-jet fel lehessen
 * oldani egy MAR LETEZO, valodi eszkozre -- lasd `resolveParentAssetId`
 * fejleceben, MIERT nem probalja a szkript kitalalni ezt az azonositot.
 */
export function parseExistingAssetsMap(json) {
  const parsed = typeof json === "string" ? JSON.parse(json) : json;
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const map = new Map();
  for (const item of items) {
    if (!item.partnerInternalCode || !item.id) continue;
    map.set(item.partnerInternalCode, item.id);
  }
  return map;
}

/**
 * EGY BEEPITETT SOR SZULOJENEK `parentAssetId`-JE -- ACROBOT MASODIK KORE,
 * 2026-09-23 23:31, A NAUTILUS MERESE UTAN: a szkript korabbi valtozata a
 * gyermek-eszkozt SOSEM kototte ossze a szuloevel az `Asset` tablan (a
 * `partnerInternalCode` csak SZOVEGKENT hordozza a szulo kodjat) -- ez
 * lapos betoltest adott, es a MEGLEVO betoltesekben (ETB-hat, RIV-28) ezt
 * csak KEZI, mar letezo eszkozre mutato `parentAssetId` potolta.
 *
 * A SZKRIPT TOVABBRA IS "NE TALALGASS": `parentAssetId`-t KIZAROLAG akkor
 * ad, ha a szulo egy MAR LETEZO, valodi eszkozkent szerepel a hivo altal
 * atadott `--meglevo-eszkozok` fajlban (lasd `parseExistingAssetsMap`). A
 * szkript soha nem talalhat ki azonositot, es KET ESETBEN SZANDEKOSAN NEM
 * IS PROBALKOZIK (nem STOP, egyszeruen `attempted: false`):
 *
 *   D URES (pl. "HSZ/VPU" a ma esti ETB/RIV meresen): a gyermek egyetlen
 *     konkret szulo-peldanyhoz SEM koto egyertelmuen -- a helyszinen tobb
 *     azonos-kodu szulo allhat, es ures D-vel nem donthetu el, melyikhez
 *     tartozik.
 *   D OSSZETETT ("01/02"): a gyermek EGYSZERRE ket fizikai szulohoz
 *     tartozik (lasd `buildPartnerInternalCode` fejleceben, LSS12/HSZ/PUM
 *     318-323. sora) -- egy valodi `Asset.parentAssetId` viszont EGYETLEN
 *     idegen kulcs, tehat nem lehet mindket szulot beirni. Ez a szkript nem
 *     valaszt a ketto kozul, es nem probal parentAssetId-t adni.
 *
 * HA `existingAssets` MAP NINCS ATADVA (a hivo nem adta meg
 * `--meglevo-eszkozok`-ot), a fuggveny MINDIG `attempted: false`-szal ter
 * vissza -- ez a visszafele-kompatibilitas ara: a kapcsolo nelkuli futas
 * BETUre ugyanazt adja, mint korabban, es a meglevo 20 teszt egyike sem
 * fugg ettol a viselkedestol.
 */
export function resolveParentAssetId(siteCode, row, existingAssets) {
  if (!row.builtin || !row.deviceSerial || !existingAssets)
    return { attempted: false };
  const reszek = row.deviceSerial
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (reszek.length !== 1) return { attempted: false };
  const szuloKod = buildPartnerInternalCode(siteCode, {
    deviceCode: row.deviceCode,
    deviceSerial: reszek[0],
    builtin: "",
  });
  const parentAssetId = existingAssets.get(szuloKod);
  return { attempted: true, szuloKod, parentAssetId: parentAssetId ?? null };
}

/**
 * A NEV -- ACROBOT LEMERTE, VALODI BETOLTESBOL (LSS07, 2026-09-23 21:36).
 * Ket kulon szabaly, es a kulonbseg NEM veletlen:
 *
 *   ONALLO eszkoz (nincs beepitett alkatresz -- row.builtin ures):
 *     <SZULO>/<HELYSZIN> <magyar eszkoznev> <ROMAI szam>
 *     pl. "BIO/LSS07 Hőcserélő I.", "BIO/LSS07 Szivattyú II."
 *
 *   BEEPITETT eszkoz (row.builtin nem ures):
 *     <SZULO>/<HELYSZIN> <szulo magyar neve> <sajat magyar neve> <ARAB szam, 2 jeggyel>
 *     pl. "BIO/LSS07 Csepegtető bioszűrő szivattyú 01"
 *
 * A szam MINDKET esetben ugyanabbol a forrasbol jon (TSV "D" oszlop,
 * Eszköz sorszám), csak MAS szamalakban -- ha a sorban nincs sorszam, a
 * szam egyszeruen kimarad (ugyanaz a mintak, mint a partnerInternalCode-nal:
 * tobb egyforma kodu sor sorszam nelkul UTKOZESKENT all meg, nem itt).
 *
 * A MAGYAR NEVEK a kategoria-terkepbol jonnek (`categoryMap`,
 * ld. `parseCategoryMap`): ONALLO sornal a sima kod bejegyzese, BEEPITETT
 * sornal EGYSZERRE a szulo sima bejegyzese ES a "szulo / sajat" par
 * bejegyzese. Terkep NELKUL (meg nincs kesz -- lasd a fajl fejlecet) a nyers
 * kod marad a nev helyen, ugyanugy, mint korabban.
 */
export function buildName(parentCode, siteCode, row, categoryMap) {
  const elotag = `${parentCode}/${siteCode}`;
  if (row.builtin) {
    const szuloNev = categoryMap?.[row.deviceCode]?.name ?? row.deviceCode;
    const sajatNev = categoryMap?.[categoryKeyFor(row)]?.name ?? row.builtin;
    // A szam forrasa F (builtinSerial), NEM D -- lasd buildPartnerInternalCode
    // jegyzetet, nautilus merese ugyanerre a szabalyra.
    const szam = row.builtinSerial ? pad2(row.builtinSerial) : "";
    const farok = [szuloNev, sajatNev, szam].filter(Boolean).join(" ");
    return `${elotag} ${farok}`.trim();
  }
  const eszkozNev = categoryMap?.[row.deviceCode]?.name ?? row.deviceCode;
  const szam = row.deviceSerial ? toRoman(Number(row.deviceSerial)) : "";
  const farok = [eszkozNev, szam].filter(Boolean).join(" ");
  return `${elotag} ${farok}`.trim();
}

/**
 * UTKOZES-ELLENORZES: minden olyan partnerInternalCode csoport, aminek
 * TOBB MINT EGY tagja van. A hivo dontse el, mit kezd veluk -- ez a fuggveny
 * csak megnevezi oket.
 */
export function findPartnerCodeCollisions(items) {
  const bySor = new Map();
  for (const item of items) {
    const list = bySor.get(item.partnerInternalCode) ?? [];
    list.push(item.sor);
    bySor.set(item.partnerInternalCode, list);
  }
  const collisions = [];
  for (const [code, sorok] of bySor) {
    if (sorok.length > 1) collisions.push({ code, sorok });
  }
  return collisions;
}

/**
 * EGY TSV-SOR -> `CreateAssetDto`-ALAKU OBJEKTUM. A `categoryId`-t ES a
 * `performanceValue`-t a hivo (`buildSitePayload`) mar feloldva adja at --
 * itt csak a mezo felvetele tortenik, ha van ertek (nem `null`-lal, mert a
 * DTO `@IsOptional()`-je a hianyzo mezot es a `null`-t masodikent kezeli --
 * lasd a labelCode jegyzetet asset.dto.ts-ben arrol, mi romlik el, ha ezt
 * osszekeverjuk).
 */
export function buildAssetPayload(row, ctx) {
  const {
    siteCode,
    parentCode,
    unit,
    partnerId,
    ownerType,
    kind,
    categoryMap,
    categoryId,
    performanceValue,
    volumeValue,
    parentAssetId,
  } = ctx;
  const partnerInternalCode = buildPartnerInternalCode(siteCode, row);
  const payload = {
    // "fank-import", NEM "fank-payload" -- acrobot merese, 2026-09-23 21:45:
    // a ma esti kezi betoltes MAR ezzel az elotaggal es KISBETUS
    // helyszin-kodadal irta be a kilenc eszkozt. Ket kulonbozo elotag ket
    // kulon idempotencia-nevteret jelentene: egy ismetelt futas nem ismerne
    // fel, hogy a sor mar bent van, es duplikatumot hozna letre.
    clientOperationId: `fank-import:${siteCode.toLowerCase()}:${row.sor}`,
    ownerType,
    ownerId: partnerId,
    departmentId: unit.id,
    kind,
    name: buildName(parentCode, siteCode, row, categoryMap),
    partnerInternalCode,
  };
  if (row.electricalCode) payload.electricalCode = row.electricalCode;
  if (row.manufacturer) payload.manufacturer = row.manufacturer;
  if (row.model) payload.model = row.model;
  if (row.uid) payload.serialNumber = row.uid;
  if (row.detail) payload.description = row.detail;
  if (volumeValue) payload.volume = volumeValue;
  if (row.powerConsumptionRaw)
    payload.powerConsumptionRaw = row.powerConsumptionRaw;
  if (performanceValue) {
    payload.performance = performanceValue;
    payload.performanceUnitId = PERFORMANCE_UNIT_M3PH;
  }
  if (categoryId) payload.categoryId = categoryId;
  if (parentAssetId) payload.parentAssetId = parentAssetId;
  return { sor: row.sor, partnerInternalCode, payload };
}

/**
 * A TELJES MENET EGY HELYSZINRE. Dobja a `FankPayloadError`-t minden olyan
 * esetben, amit acrobot "ALLJON MEG"-kent nevezett meg -- a hivo (main)
 * ilyenkor NEM ir ki payloadot.
 */
export function buildSitePayload({
  tsvText,
  units,
  siteCode,
  skipSorok,
  partnerId,
  ownerType,
  kind,
  categoryMap,
  existingAssets,
}) {
  const { rows } = parseTsv(tsvText);
  const skip = new Set(skipSorok.map(String));
  const { unit, parentCode } = resolveUnit(units, siteCode);

  const allSiteRows = rows.map(toTsvRow).filter((row) => row.site === siteCode);
  const siteRows = allSiteRows.filter((row) => !skip.has(row.sor));
  const kihagyottSorSzama = allSiteRows.length - siteRows.length;

  const hianyzoKod = siteRows.filter((row) => !row.deviceCode);
  if (hianyzoKod.length > 0)
    throw new FankPayloadError(
      `A(z) ${siteCode} helyszin ezen soraihoz nincs eszkoz-kod, es nincsenek kihagyva sem: sor ${hianyzoKod
        .map((r) => r.sor)
        .join(
          ", ",
        )}. Vagy add hozza --kihagy kapcsoloval, vagy ird be a hianyzo kodot a forrasba.`,
    );

  /*
    D (Eszkoz sorszam) EGY BEEPITETT SORON -- acrobot masodik, fuggetlen
    visszameres kore, 2026-09-23 22:38, a valodi (javitott) TSV egeszen:
    a D itt NEM gyermek-sorszam, hanem azt mondja meg, MELYIK SZULO-PELDANY
    ala tartozik a gyermek (a sejtes, amit a szkript korabban csak
    megallaskent kezelt, ALLT: 114/130 sorban a szulo-peldany TENYLEGESEN
    letezik a listaban ONALLO sorkent, ugyanazzal a C-D parral). Barracuda
    fuggetlenul, a forras fejlecebol kiindulva, UGYANAZT a 108+6+16 bontast
    merte -- ket fuggetlen meresen all a szabaly.
    Ket alesetre bomlik, es a szkript csak a MASODIKON all meg:
      114 sor   a D EGY VAGY KET erteket visel ("01", vagy "01/02" alakban),
                ES a D MINDEN resze talal ugyanazon a helyszinen ONALLO sort
                ugyanazzal a C-vel -- a szulo-peldany(ok) azonosithato(k), a
                D MINDEN resze bekerul buildPartnerInternalCode C-utani
                szegmensebe, a forras sajat sorrendjeben (acrobot dontese,
                2026-09-23 22:54, a valodi LSS12/HSZ/PUM 318-323. sorara:
                egy gyermek EGYSZERRE tartozhat KET fizikai szulohoz, es a
                kod MINDKETTOT viseli, mert a partnerInternalCode kereshetu
                mezo -- csak az elso szulo ala tenne a masodik szulora
                keresest hasztalanna).
      16 sor    a D-hez (vagy annak legalabb egy reszehez) NINCS onallo sor
                ugyanazzal a C-vel a helyszinen -- a szulo-peldany nem
                azonosithato. Acrobot ezt kulon viszi Balazs ele
                (exchange/FANK-NYITOTT-KERDESEK-BALAZSNAK.md), a szkript itt
                MEGALL.
  */
  const standaloneSzuloKulcsok = new Set(
    allSiteRows
      .filter((row) => !row.builtin && row.deviceSerial)
      .map((row) => `${row.deviceCode}\u0000${row.deviceSerial}`),
  );
  const dBeepitettSoron = siteRows.filter(
    (row) => row.builtin && row.deviceSerial,
  );
  const dMegoldhatatlan = [];
  for (const row of dBeepitettSoron) {
    const reszek = row.deviceSerial
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    const hianyzoReszek = reszek.filter(
      (resz) => !standaloneSzuloKulcsok.has(`${row.deviceCode}\u0000${resz}`),
    );
    if (hianyzoReszek.length > 0) {
      dMegoldhatatlan.push({
        row,
        ok: `NINCS onallo sor a kovetkezo D-ertek(ek)hez: ${hianyzoReszek.join(", ")} -- a szulo-peldany nem azonosithato`,
      });
    }
  }
  if (dMegoldhatatlan.length > 0) {
    const reszletek = dMegoldhatatlan
      .map(
        ({ row: r, ok }) =>
          `  sor ${r.sor}: D="${r.deviceSerial}", E="${r.builtin}", F="${r.builtinSerial || "(ures)"}" -- ${ok}`,
      )
      .join("\n");
    throw new FankPayloadError(
      `A(z) ${siteCode} helyszin alabbi beepitett sorain a D (Eszkoz sorszam) nem old fel egyertelmuen egyetlen szulo-peldanyt -- ez a szkript nem talalgat:\n${reszletek}`,
    );
  }

  /*
    A KATEGORIA-FELOLDAS KET, MEREVEN KULONBOZO VISELKEDESSEL JAR, es ez
    SZANDEKOS (acrobot kikotese, 2026-09-23 21:36):
      terkep NELKUL   -- meg nincs kesz (nautilus dolgozik rajta), a
                         categoryId minden soron kimarad, es a hivo csak
                         FIGYELMEZTETEST kap, NEM allunk meg.
      terkep MEGADVA  -- ATTOL kezdve a terkep a tekintelyes forras, es egy
                         benne HIANYZO kod (pl. a ma este megismert OCS/HSZ
                         eset, amit acrobot SZANDEKOSAN nem oldott meg
                         talalgatassal) MEGALLASI ok, ugyanugy, mint a masik
                         harom "ne talalgass" eset.
  */
  const kategoriaHianyok = [];
  /*
    A TELJESITMENY (M oszlop) ES A TERFOGAT (L oszlop) EGYARANT EGYETLEN
    SZAM KELL LEGYEN -- acrobot merese, 2026-09-23 22:01-22:02, egy korben:
    mindket mezot a szolgaltatas UGYANAZZAL a mintaval ellenorzi
    (`normalizeMeasurementValue`, lasd sajat fejleceben). Ket kulon eset,
    ket kulon kezeles, MINDKET mezore egyformán: a KEREKITHETO (tul sok
    tizedesjegy, ugyanaz a szam) csak jelzett, a NEM EGYETLEN SZAM (tobb
    ertek, tartomany, mas mertekegyseg -- pl. "940 liter" a volume-nal)
    megallasi ok, mint a hianyzo kategoria.
  */
  const MEASUREMENT_FIELDS = [
    {
      mezo: "performance",
      ctxKey: "performanceValue",
      label: "Teljesitmeny (M oszlop)",
    },
    { mezo: "volume", ctxKey: "volumeValue", label: "Terfogat (L oszlop)" },
  ];
  const meresHianyok = [];
  const meresKerekitve = [];
  /*
    A GYERMEK-SOR `parentAssetId`-JE -- acrobot masodik kore, 2026-09-23
    23:31, a nautilus-fele probafutas leletere ("nulla parentAssetId barhol
    a generator kimeneteben"). Lasd `resolveParentAssetId` sajat fejleceben
    a HARMAT: mikor probal a szkript feloldani, mikor hagyja szandekosan
    kihagyva (ures vagy osszetett D), es mikor allitja meg a futast (a
    szulo NEM szerepel a `--meglevo-eszkozok` fajlban).
  */
  const parentAssetIdHianyzik = [];
  const entries = siteRows.map((row) => {
    let categoryId;
    if (categoryMap) {
      const kulcs = categoryKeyFor(row);
      const bejegyzes = categoryMap[kulcs];
      if (bejegyzes) {
        categoryId = bejegyzes.categoryId;
      } else {
        kategoriaHianyok.push({ sor: row.sor, kulcs });
      }
    }
    const szuloFeloldas = resolveParentAssetId(siteCode, row, existingAssets);
    if (szuloFeloldas.attempted && !szuloFeloldas.parentAssetId) {
      parentAssetIdHianyzik.push({
        sor: row.sor,
        szuloKod: szuloFeloldas.szuloKod,
      });
    }
    const meresErtekek = {};
    for (const { mezo, ctxKey, label } of MEASUREMENT_FIELDS) {
      const nyers = row[mezo];
      if (!nyers) continue;
      const normalizalt = normalizeMeasurementValue(nyers);
      if (normalizalt === null) {
        meresHianyok.push({ sor: row.sor, label, nyers });
      } else {
        meresErtekek[ctxKey] = normalizalt.value;
        if (normalizalt.rounded)
          meresKerekitve.push({
            sor: row.sor,
            label,
            nyers,
            kerekitve: normalizalt.value,
          });
      }
    }
    return buildAssetPayload(row, {
      siteCode,
      parentCode,
      unit,
      partnerId,
      ownerType,
      kind,
      categoryMap,
      categoryId,
      parentAssetId: szuloFeloldas.parentAssetId,
      ...meresErtekek,
    });
  });

  if (categoryMap && kategoriaHianyok.length > 0) {
    const reszletek = kategoriaHianyok
      .map((h) => `  sor ${h.sor}: "${h.kulcs}"`)
      .join("\n");
    throw new FankPayloadError(
      `A kategoria-terkep nem fedi az alabbi kodokat a(z) ${siteCode} helyszinen -- ez a szkript nem talalgat:\n${reszletek}`,
    );
  }

  if (existingAssets && parentAssetIdHianyzik.length > 0) {
    const reszletek = parentAssetIdHianyzik
      .map(
        (h) =>
          `  sor ${h.sor}: kerestem "${h.szuloKod}", nincs a --meglevo-eszkozok fajlban`,
      )
      .join("\n");
    throw new FankPayloadError(
      `A(z) ${siteCode} helyszin alabbi gyermek-sorai olyan szulore mutatnak, ami NEM szerepel MAR LETEZO eszkozkent a --meglevo-eszkozok fajlban -- ez a szkript nem talal ki azonositot:\n${reszletek}`,
    );
  }

  if (meresHianyok.length > 0) {
    const reszletek = meresHianyok
      .map((h) => `  sor ${h.sor} (${h.label}): "${h.nyers}"`)
      .join("\n");
    throw new FankPayloadError(
      `Az alabbi sorokon egy mert ertek NEM egyetlen szam -- ez a szkript nem kerekit es nem talalgat, a dontes a hivoe:\n${reszletek}`,
    );
  }

  const collisions = findPartnerCodeCollisions(entries);
  if (collisions.length > 0) {
    const reszletek = collisions
      .map((c) => `  ${c.code}  <-  sor ${c.sorok.join(", ")}`)
      .join("\n");
    throw new FankPayloadError(
      `Utkozo partnerInternalCode ertekek a(z) ${siteCode} helyszinen -- ez a szkript nem sorszamoz, a dontes a hivoe:\n${reszletek}`,
    );
  }

  const hianyzoKategoria = categoryMap
    ? []
    : entries.filter((e) => !e.payload.categoryId);

  /*
    A BEMENETI ES A KIMENETI SORSZAM OSSZEVETESE -- acrobot kikotese,
    2026-09-23 22:04, egy sajat masik hibaja utan (54 sorbol kevesebb jott
    ki, es ez akkor sem tunt fel): "a bemenet es a kimenet sorszamat
    osszevetni... egy szamlalo, ami minden futas vegen ket szamot egymas
    melle tesz, mind a ket esetet megfogja, es nem kell hozza emlekezni
    ra." A varakozas: pontosan annyi eszkoz megy ki, ahany a helyszin
    TSV-sora, minus a --kihagy-gyal kihagyottak. Ha ez NEM egyezik, valami
    csendben elnyelt egy sort -- ez a legrosszabb fajta hiba, mert nem
    hibazik, csak kevesebb lesz (acrobot sajat szavaival).
  */
  if (entries.length !== siteRows.length) {
    throw new FankPayloadError(
      `Belso ellentmondas: ${siteRows.length} bemeneti sorbol ${entries.length} kimeneti eszkoz lett a(z) ${siteCode} helyszinen -- ez a szamnak EGYEZNIE kellene. Ne kuldd el ezt a payloadot.`,
    );
  }

  return {
    payload: entries.map((e) => e.payload),
    hianyzoKategoriaSorok: hianyzoKategoria.map((e) => e.sor),
    meresKerekitve,
    bemenetiSorSzam: allSiteRows.length,
    kihagyottSorSzama,
    kimenetiEszkozSzam: entries.length,
  };
}

function parseArgs(argv) {
  const args = {
    site: null,
    tsv: FANK_TSV_DEFAULT,
    units: null,
    categoryMap: null,
    existingAssets: null,
    skip: [],
    partner: FANK_PARTNER_DEFAULT,
    ownerType: "SUPPLIER",
    kind: ASSET_KIND_DEFAULT,
  };
  const rest = [...argv];
  while (rest.length > 0) {
    const tok = rest.shift();
    switch (tok) {
      case "--tsv":
        args.tsv = rest.shift();
        break;
      case "--units":
        args.units = rest.shift();
        break;
      case "--kategoria-terkep":
        args.categoryMap = rest.shift();
        break;
      case "--meglevo-eszkozok":
        args.existingAssets = rest.shift();
        break;
      case "--kihagy":
        args.skip.push(
          ...String(rest.shift())
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        break;
      case "--partner":
        args.partner = rest.shift();
        break;
      case "--owner-type":
        args.ownerType = rest.shift();
        break;
      case "--kind":
        args.kind = rest.shift();
        break;
      default:
        if (tok.startsWith("--"))
          throw new FankPayloadError(`Ismeretlen kapcsolo: ${tok}`);
        if (args.site)
          throw new FankPayloadError(
            `Csak egy helyszin-kod adhato meg (mar van: ${args.site}, ujabb: ${tok}).`,
          );
        args.site = tok;
    }
  }
  if (!args.site)
    throw new FankPayloadError(
      "Add meg a helyszin kodjat, pl.: fank-payload.sh LSS22",
    );
  if (!args.units)
    throw new FankPayloadError(
      "A --units kapcsolo kotelezo: a GET /suppliers/<partner>/units valaszat mentsd fajlba, es add at az utjat.",
    );
  return args;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new FankPayloadError(
      `Nem tudtam beolvasni (${label}): ${path} -- ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

export function main(argv) {
  const args = parseArgs(argv);
  const tsvText = (() => {
    try {
      return readFileSync(args.tsv, "utf8");
    } catch (cause) {
      throw new FankPayloadError(
        `Nem tudtam beolvasni a forras TSV-t: ${args.tsv} -- ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  })();
  const unitsJson = readJson(args.units, "--units");
  const units = Array.isArray(unitsJson.items) ? unitsJson.items : [];
  const categoryMap = args.categoryMap
    ? parseCategoryMap(
        (() => {
          try {
            return readFileSync(args.categoryMap, "utf8");
          } catch (cause) {
            throw new FankPayloadError(
              `Nem tudtam beolvasni (--kategoria-terkep): ${args.categoryMap} -- ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            );
          }
        })(),
      )
    : null;
  const existingAssets = args.existingAssets
    ? parseExistingAssetsMap(
        readJson(args.existingAssets, "--meglevo-eszkozok"),
      )
    : null;

  const {
    payload,
    hianyzoKategoriaSorok,
    meresKerekitve,
    bemenetiSorSzam,
    kihagyottSorSzama,
    kimenetiEszkozSzam,
  } = buildSitePayload({
    tsvText,
    units,
    siteCode: args.site,
    skipSorok: args.skip,
    partnerId: args.partner,
    ownerType: args.ownerType,
    kind: args.kind,
    categoryMap,
    existingAssets,
  });

  if (hianyzoKategoriaSorok.length > 0) {
    process.stderr.write(
      `FIGYELMEZTETES: ${hianyzoKategoriaSorok.length} sorhoz nincs categoryId (nincs --kategoria-terkep, vagy a kod nincs benne) -- sor: ${hianyzoKategoriaSorok.join(
        ", ",
      )}\n`,
    );
  }
  if (meresKerekitve.length > 0) {
    const reszletek = meresKerekitve
      .map(
        (k) => `  sor ${k.sor} (${k.label}): "${k.nyers}" -> "${k.kerekitve}"`,
      )
      .join("\n");
    process.stderr.write(
      `KEREKITVE (hat tizedesre, a sema sajat pontossagara): ${meresKerekitve.length} sor\n${reszletek}\n`,
    );
  }
  /*
    A BEMENET/KIMENET OSSZEVETESE MINDIG KIIRODIK, ne csak hibas esetben --
    acrobot kerese: ezt ne kelljen kulon kikerni, es ne lehessen elfelejteni
    megnezni. A hivo sajat szamitasa (hany sort szant --kihagy-nak) itt
    osszevethető a szkript sajat szamlalasaval.
  */
  process.stderr.write(
    `${args.site}: ${bemenetiSorSzam} bemeneti sor - ${kihagyottSorSzama} kihagyva = ${kimenetiEszkozSzam} kimeneti eszkoz (${args.tsv}).\n`,
  );
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  return 0;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof FankPayloadError) {
      process.stderr.write(`fank-payload: ${error.message}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
