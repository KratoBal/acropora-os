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
 * === AMI NEM MEREVE VAN, HANEM A LEGJOBB TALALATOM -- JELOLVE ===
 *
 *   name szuffixe          acrobot csak az ELOTAGOT adta meg ("BIO/LSS22 ...").
 *                          Ami a "..." mogott all, azt NEM mondta ki. A
 *                          `buildName()` fuggveny epiti fel a
 *                          <KOD><-SORSZAM> <GYARTO> <TIPUS> alakot -- ez
 *                          egyetlen, jol nevesitett fuggvenyben all, hogy egy
 *                          eltero dontes egy helyen javithato legyen.
 *
 * === AMI SZANDEKOSAN KIMARAD, MERT A FELOLDASAHOZ HIANYZIK A BEMENET ===
 *
 *   categoryId              nautilus kod-kategoria terkepet keszit, MA MEG
 *                           NINCS KESZ (acrobot sajat szavaival). Ha a
 *                           --kategoria-terkep kapcsolo hianyzik, minden sor
 *                           categoryId NELKUL megy ki, es a szkript a stderr-re
 *                           figyelmezteto osszesitot ir -- NEM allit meg,
 *                           mert ez utolag, egy kulon korben potolhato.
 *   performance/            a ketto egyutt mozog (Asset_performance_pairing_check
 *   performanceUnitId       adatbazis-megkotes, lasd a DTO jegyzetet), es a
 *                           performanceUnitId egy VALODI UnitOfMeasure-azonosito
 *                           kell legyen. Ennek feloldasahoz nincs bemenetem,
 *                           tehat a TSV "M" oszlopat (Teljesitmeny, m3/h)
 *                           EZ A SZKRIPT NEM IRJA KI -- felteves helyett
 *                           kihagyja.
 *
 * === AMIT A SZKRIPT SOSEM CSINAL ===
 *
 *   - nem kuld HTTP-hivast, nem ir semmilyen rendszerbe
 *   - nem sorszamoz: ha egy partnerInternalCode UTKOZIK (ket sor ugyanoda esne
 *     serial nelkul), MEGALL, es kiirja, melyik `sor` szamok utkoznek
 *   - nem valaszt helyszint, ha a kod TOBBSZOR fordul elo a partner
 *     egysegei kozott -- ALLJON MEG, ne talalgasson
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
 *   --kategoria-terkep <ut> opcionalis JSON: {"<ESZKOZ_KOD>": "<categoryId>"}.
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
 * A NEV -- AZ ELOTAG MEREVE VAN (acrobot), A SZUFFIX A LEGJOBB TALALATOM.
 * Lasd a fajl fejlecenek "AMI NEM MEREVE VAN" szakaszat.
 */
export function buildName(parentCode, siteCode, row) {
  const kodResz = row.deviceSerial
    ? `${row.deviceCode}-${row.deviceSerial}`
    : row.deviceCode;
  const reszletek = [row.manufacturer, row.model].filter(Boolean).join(" ");
  const farok = [kodResz, reszletek].filter(Boolean).join(" ");
  return `${parentCode}/${siteCode} ${farok}`.trim();
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
 * EGY TSV-SOR -> `CreateAssetDto`-ALAKU OBJEKTUM. A `categoryMap` opcionalis:
 * ha a sor eszkoz-kodja nincs benne, a categoryId mezo KIMARAD (nem `null`
 * ertekkel megy, mert a DTO `@IsOptional()`-je a hianyzo mezot es a `null`-t
 * masodikent kezeli -- lasd a labelCode jegyzetet asset.dto.ts-ben arrol, mi
 * romlik el, ha ezt osszekeverjuk).
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
  } = ctx;
  const partnerInternalCode = buildPartnerInternalCode(
    siteCode,
    row.deviceCode,
    row.deviceSerial,
  );
  const payload = {
    clientOperationId: `fank-payload:${siteCode}:${row.sor}`,
    ownerType,
    ownerId: partnerId,
    departmentId: unit.id,
    kind,
    name: buildName(parentCode, siteCode, row),
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
  const categoryId = categoryMap?.[row.deviceCode];
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

  const entries = siteRows.map((row) =>
    buildAssetPayload(row, {
      siteCode,
      parentCode,
      unit,
      partnerId,
      ownerType,
      kind,
      categoryMap,
    }),
  );

  const collisions = findPartnerCodeCollisions(entries);
  if (collisions.length > 0) {
    const reszletek = collisions
      .map((c) => `  ${c.code}  <-  sor ${c.sorok.join(", ")}`)
      .join("\n");
    throw new FankPayloadError(
      `Utkozo partnerInternalCode ertekek a(z) ${siteCode} helyszinen -- ez a szkript nem sorszamoz, a dontes a hivoe:\n${reszletek}`,
    );
  }

  const hianyzoKategoria = entries.filter((e) => !e.payload.categoryId);

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
    ? readJson(args.categoryMap, "--kategoria-terkep")
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
