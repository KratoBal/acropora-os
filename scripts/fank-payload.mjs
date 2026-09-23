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
 * === A performance/performanceUnitId MAR NEM HIANYZIK -- acrobot harmadik
 *     kore, 2026-09-23 21:45, mert a korabbi korlat (nincs VALODI
 *     UnitOfMeasure-azonositom) megszunt ===
 *
 *   A ketto egyutt mozog (Asset_performance_pairing_check adatbazis-megkotes,
 *   lasd a DTO jegyzetet), es korabban ezert maradt ki mindket mezo -- fel
 *   nem toltott performanceUnitId nelkul a betoltes elbukott volna. A TSV
 *   "M" oszlopa (Teljesitmeny) a SAJAT fejleceben MINDIG m3/h, tehat ez nem
 *   soronkenti feloldas, csak egyetlen ALLANDO (`PERFORMANCE_UNIT_M3PH`,
 *   forras: GET /units-of-measure?kind=PERFORMANCE, acrobot mert erteke).
 *
 * === AMIT A SZKRIPT SOSEM CSINAL, ES NEGY "ALLJON MEG" ESET ===
 *
 *   - nem kuld HTTP-hivast, nem ir semmilyen rendszerbe
 *   - nem sorszamoz: ha egy partnerInternalCode UTKOZIK (ket sor ugyanoda esne
 *     serial nelkul), MEGALL, es kiirja, melyik `sor` szamok utkoznek
 *   - nem valaszt helyszint, ha a kod TOBBSZOR fordul elo a partner
 *     egysegei kozott -- ALLJON MEG, ne talalgasson
 *   - HA --kategoria-terkep MEGVAN ADVA, egy abbol HIANYZO kod is megallasi
 *     ok (acrobot masodik kore, 2026-09-23 21:36): a terkepet nautilus es
 *     acrobot SZO SZERINTI egyezesre epitettek (nem nev-hasonlosagra), es
 *     egy par kodot (a mai peldaban: OCS/HSZ) SZANDEKOSAN nem oldottak fel
 *     talalgatassal -- ha egy sor ilyen kodra fut, a szkript sem talalgat.
 *   - a payload eloallitasa UTAN, meg a kiiras ELOTT, ujra ellenorzi, hogy a
 *     generalt partnerInternalCode ertekek EGYEDIEK -- acrobot sajat szavaival:
 *     "nalam ez egy sor volt, es pont az LSS22-n sult el"
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
// A TSV "M" oszlopa (Teljesitmeny) a SAJAT fejleceben mindig m3/h -- lasd a
// buildAssetPayload jegyzetet arrol, honnan jott ez az azonosito.
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

/** <HELYSZIN>-<KOD>-<SORSZAM>, vagy <HELYSZIN>-<KOD> ha nincs sorszam. */
export function buildPartnerInternalCode(siteCode, deviceCode, serial) {
  return serial
    ? `${siteCode}-${deviceCode}-${serial}`
    : `${siteCode}-${deviceCode}`;
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
    const szam = row.deviceSerial ? pad2(row.deviceSerial) : "";
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
 * EGY TSV-SOR -> `CreateAssetDto`-ALAKU OBJEKTUM. A `categoryId`-t a hivo
 * (`buildSitePayload`) mar feloldva adja at -- itt csak a mezo felvetele
 * tortenik, ha van ertek (nem `null`-lal, mert a DTO `@IsOptional()`-je a
 * hianyzo mezot es a `null`-t masodikent kezeli -- lasd a labelCode
 * jegyzetet asset.dto.ts-ben arrol, mi romlik el, ha ezt osszekeverjuk).
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
  } = ctx;
  const partnerInternalCode = buildPartnerInternalCode(
    siteCode,
    row.deviceCode,
    row.deviceSerial,
  );
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
  if (row.volume) payload.volume = row.volume;
  if (row.powerConsumptionRaw)
    payload.powerConsumptionRaw = row.powerConsumptionRaw;
  /*
    A "M" oszlop (Teljesitmeny) a forras SAJAT fejleceben MINDIG m3/h --
    ezt nem kell soronkent feloldani, csak egyszer, a mertekegyseget adja a
    fejlec maga. acrobot merese, 2026-09-23 21:45: GET
    /units-of-measure?kind=PERFORMANCE (a `kind` kotelezo, nelkule 400), a
    kobmeter/ora azonositoja `uom_perf_m3ph`. Korabban ez a mezo
    SZANDEKOSAN kimaradt, mert nem volt ilyen azonositom -- most mar van.
  */
  if (row.performance) {
    payload.performance = row.performance;
    payload.performanceUnitId = PERFORMANCE_UNIT_M3PH;
  }
  if (categoryId) payload.categoryId = categoryId;
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
}) {
  const { rows } = parseTsv(tsvText);
  const skip = new Set(skipSorok.map(String));
  const { unit, parentCode } = resolveUnit(units, siteCode);

  const siteRows = rows
    .map(toTsvRow)
    .filter((row) => row.site === siteCode && !skip.has(row.sor));

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
    return buildAssetPayload(row, {
      siteCode,
      parentCode,
      unit,
      partnerId,
      ownerType,
      kind,
      categoryMap,
      categoryId,
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

  return {
    payload: entries.map((e) => e.payload),
    hianyzoKategoriaSorok: hianyzoKategoria.map((e) => e.sor),
  };
}

function parseArgs(argv) {
  const args = {
    site: null,
    tsv: FANK_TSV_DEFAULT,
    units: null,
    categoryMap: null,
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

  const { payload, hianyzoKategoriaSorok } = buildSitePayload({
    tsvText,
    units,
    siteCode: args.site,
    skipSorok: args.skip,
    partnerId: args.partner,
    ownerType: args.ownerType,
    kind: args.kind,
    categoryMap,
  });

  if (hianyzoKategoriaSorok.length > 0) {
    process.stderr.write(
      `FIGYELMEZTETES: ${hianyzoKategoriaSorok.length} sorhoz nincs categoryId (nincs --kategoria-terkep, vagy a kod nincs benne) -- sor: ${hianyzoKategoriaSorok.join(
        ", ",
      )}\n`,
    );
  }
  process.stderr.write(
    `${payload.length} eszkoz a(z) ${args.site} helyszinre, ${args.tsv} forrasbol.\n`,
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
