import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A FANK-PAYLOAD SZKRIPT (`scripts/fank-payload.mjs`) KALIBRACIOJA.
 *
 * Acrobot kerese, 2026-09-23 21:20: a szkript egy HELYSZIN-KODBOL allitja elo
 * a betoltesi payloadot -- nem kuld semmit, nem dont sorszamozasrol, es
 * MEGALL minden olyan esetben, amit "ne talalgass" kent nevezett meg (a
 * helyszin-kod nem egyedi, a partnerInternalCode utkozik, hianyzik az
 * eszkoz-kod).
 *
 * UGYANAZ A MINTA, MINT A `meres-kapu.spec.ts`-nel: a szkriptet VALODI
 * ALFOLYAMATKENT hivjuk (`execFileSync`), nem a belso fuggvenyeit importaljuk
 * -- igy az, amit a teszt mer, PONTOSAN az, amit egy hivo a parancssorbol kap.
 *
 * A FIXTURAK KICSIK ES SZINTETIKUSAK, NEM A VALODI TSV. A valodi forras
 * (exchange/FANK-teljes-lista-JAVITOTT-2026-09-23.tsv) az INSTALL SAJAT
 * exchange/ mappajaban el, a repon KIVUL -- egy CI-futason ez a fajl NEM
 * letezik. A `--tsv` kapcsolo pont ezert kapcsolo, nem hardcode: a teszt
 * a sajat, ismert tartalmu TSV-jet adja at.
 */

const SZKRIPT = join(process.cwd(), "..", "..", "scripts", "fank-payload.mjs");

const TSV_FEJLEC =
  "sor\tA|MAT kód / Elektromos\tB|Akvárium / Medence\tC|Eszköz kód\tD|Eszköz sorszám\tE|Beépített eszköz/szerelvény\tF|Beépített eszköz/szerelvény sorszáma\tG|Gyártó\tH|Típus\tI|Részletezés\tJ|Egyedi azonosító (ID, Serial stb.)\tK|Mennyiség (db)\tL|Térfogat (m3)\tM|Teljesítmény (m3/h)\tN|Fogyasztás (össz. kW vagy P1/P2\tO|\tP|\tQ|\tR|\tS|\tT|\tU|\tV|\tW|";

/**
 * Egy szintetikus TSV-sor, a valodi oszlop-sorrenddel (24 oszlop, sok ures).
 * A nem nevesitett mezok uresen maradnak -- pont, ahogy a valodi forrasban is
 * a legtobb sor teszi.
 */
function sor(mezok: {
  sor: string;
  electricalCode?: string;
  site: string;
  deviceCode?: string;
  deviceSerial?: string;
  builtin?: string;
  manufacturer?: string;
  model?: string;
  detail?: string;
  uid?: string;
  volume?: string;
  performance?: string;
  powerConsumptionRaw?: string;
}): string {
  const oszlopok = new Array(24).fill("");
  oszlopok[0] = mezok.sor;
  oszlopok[1] = mezok.electricalCode ?? "";
  oszlopok[2] = mezok.site;
  oszlopok[3] = mezok.deviceCode ?? "";
  oszlopok[4] = mezok.deviceSerial ?? "";
  oszlopok[5] = mezok.builtin ?? "";
  oszlopok[7] = mezok.manufacturer ?? "";
  oszlopok[8] = mezok.model ?? "";
  oszlopok[9] = mezok.detail ?? "";
  oszlopok[10] = mezok.uid ?? "";
  oszlopok[12] = mezok.volume ?? "";
  oszlopok[13] = mezok.performance ?? "";
  oszlopok[14] = mezok.powerConsumptionRaw ?? "";
  return oszlopok.join("\t");
}

const ALAP_TSV = [
  TSV_FEJLEC,
  sor({
    sor: "10",
    electricalCode: "022-3-003 / 62M",
    site: "LSS22",
    deviceCode: "AIP",
    deviceSerial: "01",
    manufacturer: "AIRTECH",
    model: "ASC0315-1-MT221-6",
    uid: "18/09 180136 013 0039",
  }),
  sor({
    sor: "11",
    electricalCode: "022-3-004 / 63M",
    site: "LSS22",
    deviceCode: "AIP",
    deviceSerial: "02",
    manufacturer: "AIRTECH",
    model: "ASC0315-1-MT221-6",
    uid: "18/08 180122 012 0081",
  }),
  // Ket hocserelo, sorszam NELKUL -- a valodi LSS22-n mert utkozes.
  sor({
    sor: "12",
    electricalCode: "022-8-001",
    site: "LSS22",
    deviceCode: "HEX",
    manufacturer: "SONDEX",
    detail: "Hűtési",
    powerConsumptionRaw: "90",
  }),
  sor({
    sor: "13",
    electricalCode: "022-8-002",
    site: "LSS22",
    deviceCode: "HEX",
    manufacturer: "SONDEX",
    detail: "Fűtési",
    powerConsumptionRaw: "95",
  }),
  // Kihagyando sor: nincs eszkoz-kod (pl. "szerte a pinceben" tetel).
  sor({ sor: "14", site: "LSS22", detail: "Szerte a pincében, min." }),
  // Beepitett alkatresz -- van szulo-kod (CPT) ES sajat kod (TRI), a valodi
  // "CPT / TRI" par mintajara.
  sor({
    sor: "15",
    site: "LSS22",
    deviceCode: "CPT",
    deviceSerial: "1",
    builtin: "TRI",
  }),
  // Masik helyszin, hogy a szures tenyleg szurjon.
  sor({
    sor: "20",
    electricalCode: "099-1-001",
    site: "LSS01",
    deviceCode: "PUM",
    manufacturer: "GRUNDFOS",
    performance: "75",
  }),
  // Kerekitheto teljesitmeny -- a valodi ETB/RIV kerekitesi hiba mintajara.
  sor({
    sor: "30",
    site: "LSS98",
    deviceCode: "HSZ",
    performance: "146.69999999999999",
  }),
  // NEM egyetlen szam -- a valodi LSS12 UVF mintajara.
  sor({
    sor: "40",
    site: "LSS99",
    deviceCode: "UVF",
    performance: "175/210",
  }),
  // Terfogat, kerekitheto -- a valodi LSS02/PUF mintajara.
  sor({
    sor: "50",
    site: "LSS97",
    deviceCode: "PUF",
    volume: "9.1999999999999993",
  }),
  // Terfogat, VESZELYES eset -- a valodi LSS10/CPT mintajara: literben all,
  // a mezo pedig mindig m3-ben ert.
  sor({
    sor: "60",
    site: "LSS96",
    deviceCode: "CPT",
    volume: "940 liter",
  }),
].join("\n");

const EGYSEGEK = {
  items: [
    {
      id: "unit-bio",
      parentId: null,
      code: "BIO",
      name: "Biodom",
      isActive: true,
    },
    {
      id: "unit-lss22",
      parentId: "unit-bio",
      code: "LSS22",
      name: "LSS22",
      isActive: true,
    },
    {
      id: "unit-lss01",
      parentId: "unit-bio",
      code: "LSS01",
      name: "LSS01",
      isActive: true,
    },
    {
      id: "unit-lss98",
      parentId: "unit-bio",
      code: "LSS98",
      name: "LSS98",
      isActive: true,
    },
    {
      id: "unit-lss99",
      parentId: "unit-bio",
      code: "LSS99",
      name: "LSS99",
      isActive: true,
    },
    {
      id: "unit-lss97",
      parentId: "unit-bio",
      code: "LSS97",
      name: "LSS97",
      isActive: true,
    },
    {
      id: "unit-lss96",
      parentId: "unit-bio",
      code: "LSS96",
      name: "LSS96",
      isActive: true,
    },
  ],
};

const UUID_AIP = "11111111-1111-4111-8111-111111111111";
const UUID_CPT = "22222222-2222-4222-8222-222222222222";
const UUID_CPT_TRI = "33333333-3333-4333-8333-333333333333";

/**
 * A VALODI FAJL FORMATUMA, NEM JSON (acrobot, MASODSZOR ujraepitve
 * 2026-09-23 21:51): oszlopra igazitott szoveg,
 * "<KOD>  <magyar nev>  <categoryId-UUID>  <honnan>" soronkent. A
 * fejlec-megjegyzesek `#`-tal kezdodnek, es ures sorok is allhatnak --
 * mindkettot at kell ugrania a sorolonak. A parositott kod SZOKOZ NELKUL
 * all a "/" korul ("CPT/TRI", NEM "CPT / TRI" -- az elso valtozat meg igy
 * irta, a masodik mar nem).
 *
 * Az utolso sor SZANDEKOSAN egyetlen szokozzel all a hosszu nev es az UUID
 * kozott -- a valodi fajlban is elofordul ez az igazitas-osszecsuszas
 * (lasd `parseCategoryMap` sajat fejleceben), es a sorolonak EZT is
 * hibatlanul kell kezelnie, a "honnan" oszlopot is helyesen levalasztva
 * MOGULE, nem csak a szep, 2+ szokozos sorokat.
 */
const KATEGORIA_TERKEP = [
  "# FANK kod -> kategoria azonosito, szintetikus teszt-fixtura",
  "",
  `AIP              Légbefúfó, levegőztető szivattyú             ${UUID_AIP}     kategoria-lista (nincs eles eszkoz ezzel a koddal)`,
  `CPT              (MAT) Kompakt szűrő                          ${UUID_CPT}     kategoria-lista, SZO SZERINTI nevegyezes`,
  `CPT/TRI        Csepegtető bioszűrő egy hosszú, zárójeles (pillangó, golyós) leírással ${UUID_CPT_TRI} eles eszkozrol`,
].join("\n");

function mappa(): string {
  return mkdtempSync(join(tmpdir(), "fank-payload-"));
}

function iras(dir: string, nev: string, tartalom: string): string {
  const ut = join(dir, nev);
  writeFileSync(ut, tartalom, "utf8");
  return ut;
}

/**
 * `execFileSync` a SIKERES agon CSAK a stdout-ot adja vissza -- a stderr ott
 * NEM ker vissza sehogy, csak a hibaagon (a catch-blokk `error.stderr`-jeben).
 * Ez pontosan azt a fajta kalibracios csapdat okozta, amit acrobot ma
 * ketszer is megnevezett: egy ASSERTION, ami a HIBAS iranyban jol mukodik,
 * de a SIKERES iranyban vakon "" -et lat, es piros lesz olyankor is, amikor a
 * szkript valojaban jol viselkedett. A `spawnSync` mindket agon EGYFORMAN ad
 * vissza stdout/stderr/status-t, ezert ez, nem az `execFileSync` a helyes
 * eszkoz egy olyan teszthez, ami a stderr-t MINDKET agon vizsgalja.
 */
function futtat(args: string[]): {
  kod: number;
  stdout: string;
  stderr: string;
} {
  const eredmeny = spawnSync(process.execPath, [SZKRIPT, ...args], {
    encoding: "utf8",
  });
  return {
    kod: eredmeny.status ?? 1,
    stdout: eredmeny.stdout ?? "",
    stderr: eredmeny.stderr ?? "",
  };
}

describe("fank-payload: helyszin -> betoltesi payload", () => {
  it("POZITÍV KONTROLL: a sikeres futas tenyleg ket sort ad ki, nem nullat", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout, stderr } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,15",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.equal(kod, 0, `nem 0 kilepes: ${stderr}`);
    const payload = JSON.parse(stdout);
    assert.equal(payload.length, 2, `nem ket sort adott: ${stdout}`);
  });

  it("a bemenet/kimenet sorszama MINDIG ki van irva, es a harom szam osszead", () => {
    /*
      acrobot kikotese, 2026-09-23 22:04, sajat masik hibaja utan (54
      sorbol kevesebb jott ki, es nem tunt fel): a szkript MINDIG irja ki a
      bemeneti/kihagyott/kimeneti szamot, es ezt nem kell kulon kerni. Az
      ALAP_TSV-ben LSS22-nek 6 sora van (10,11,12,13,14,15); ebbol 4-et
      hagyunk ki, tehat 6 - 4 = 2 kell maradjon.
    */
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stderr } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,15",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.equal(kod, 0, stderr);
    assert.match(
      stderr,
      /LSS22: 6 bemeneti sor - 4 kihagyva = 2 kimeneti eszkoz/,
    );
  });

  it("a nev elotagja a szulo egyseg kodja, es az electricalCode a TELJES nyers szoveg", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,15",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.equal(kod, 0);
    const payload = JSON.parse(stdout);
    const elso = payload[0];
    assert.match(elso.name, /^BIO\/LSS22 /);
    assert.equal(elso.electricalCode, "022-3-003 / 62M");
    assert.equal(elso.partnerInternalCode, "LSS22-AIP-01");
    assert.equal(elso.departmentId, "unit-lss22");
    assert.equal(elso.ownerType, "SUPPLIER");
    assert.equal(elso.kind, "EQUIPMENT");
  });

  it("a clientOperationId a MA ESTE MAR BEIMPORTALT nevteret hasznalja, nem a sajatjat", () => {
    /*
      acrobot merese, 2026-09-23 21:45: a ma esti kezi betoltes
      "fank-import:<kisbetus helyszin>:<sor>" alakkal irta be a kilenc
      eszkozt. Ha a szkript egy MASIK elotaggal (a korabbi
      "fank-payload:LSS22:...") futna, egy ismetelt futas NEM ismerne fel a
      mar bent levo sorokat, es duplikatumot hozna letre.
    */
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,15",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.equal(kod, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload[0].clientOperationId, "fank-import:lss22:10");
    assert.equal(payload[1].clientOperationId, "fank-import:lss22:11");
  });

  it("a Teljesitmeny (M oszlop) performance + performanceUnitId parban erkezik, m3/h-ban", () => {
    /*
      acrobot merese, 2026-09-23 21:45: GET /units-of-measure?kind=PERFORMANCE,
      a kobmeter/ora azonositoja uom_perf_m3ph. A TSV "M" oszlopa a sajat
      fejleceben MINDIG m3/h, tehat ez nem soronkenti feloldas.
    */
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout } = futtat(["LSS01", "--tsv", tsv, "--units", units]);
    assert.equal(kod, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].performance, "75");
    assert.equal(payload[0].performanceUnitId, "uom_perf_m3ph");
  });

  it("performance NELKUL a sorban a mezopar KIMARAD, nem ures ertekkel megy", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,15",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.equal(kod, 0);
    const payload = JSON.parse(stdout);
    assert.ok(
      payload.every(
        (p: Record<string, unknown>) =>
          !("performance" in p) && !("performanceUnitId" in p),
      ),
    );
  });

  it("a Teljesitmeny KEREKITHETO tobbtizedes ertek hat tizedesre kerekitve megy be, es jelzve van", () => {
    /*
      acrobot merese, 2026-09-23 22:01: a szolgaltatas sajat
      normalizePerformanceValue mintaja legfeljebb hat tizedest enged
      (^\d{1,13}(?:\.\d{1,6})?$). A valodi forrasban ez a pontos ertek
      (146.69999999999999) hat sort erint, mind UGYANAZT a lebegopontos
      kerekitesi hibat hordozza -- ez KEREKITHETO, nem "ne talalgass" eset.
    */
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout, stderr } = futtat([
      "LSS98",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.equal(kod, 0, stderr);
    const payload = JSON.parse(stdout);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].performance, "146.7");
    assert.equal(payload[0].performanceUnitId, "uom_perf_m3ph");
    assert.match(stderr, /KEREKITVE/);
    assert.match(stderr, /sor 30/);
    assert.match(stderr, /146\.69999999999999/);
    assert.match(stderr, /146\.7/);
  });

  it("a Teljesitmeny NEM EGYETLEN SZAM erteknel MEGALL, nem kerekit es nem talalgat", () => {
    /*
      acrobot merese, 2026-09-23 22:01: a valodi forrasban 16 sor nem
      egyetlen szam (tartomany, tobb ertek, mas mertekegyseg) -- ezeket
      NEM lehet kerekitessel feloldani, mert tobb informaciot hordoznak,
      mint amennyi a mezobe fer.
    */
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout, stderr } = futtat([
      "LSS99",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.notEqual(kod, 0);
    assert.equal(stdout, "");
    assert.match(stderr, /sor 40/);
    assert.match(stderr, /175\/210/);
  });

  it("a Terfogat (L oszlop) UGYANAZZAL a fuggvennyel kerekit, mint a Teljesitmeny", () => {
    /*
      acrobot masodik merese, 2026-09-23 22:02, ugyanabban a korben: a DTO
      sajat jegyzete szerint a volume-ot a kozos normalizeMeasurementValue
      ellenorzi, a performance-szal azonos mintaval -- a valodi LSS02/PUF
      soron ugyanaz a lebegopontos csalad all, mint a performance-nel.
    */
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout, stderr } = futtat([
      "LSS97",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.equal(kod, 0, stderr);
    const payload = JSON.parse(stdout);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].volume, "9.2");
    assert.match(stderr, /KEREKITVE/);
    assert.match(stderr, /sor 50/);
    assert.match(stderr, /Terfogat/);
  });

  it("a Terfogat 'literben all, de m3-nek szant' sora MEGALL -- a legveszelyesebb eset", () => {
    /*
      acrobot sajat szavaival: "ha valaki a betoltes elott csak a 'liter'
      szot vagja le rola, akkor 940 kobmeter menne be 0,94 helyett,
      ezerszeres hiba, es a szam utana teljesen hihetonek latszik". A
      valodi LSS10/CPT sor mintajara -- ez SOSEM automatikus atvaltas.
    */
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout, stderr } = futtat([
      "LSS96",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.notEqual(kod, 0);
    assert.equal(stdout, "");
    assert.match(stderr, /sor 60/);
    assert.match(stderr, /940 liter/);
    assert.match(stderr, /Terfogat/);
  });

  it("a masik helyszin sorai NEM kerulnek bele", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { stdout } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,15",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    const payload = JSON.parse(stdout);
    assert.ok(
      payload.every((p: { partnerInternalCode: string }) =>
        p.partnerInternalCode.startsWith("LSS22-"),
      ),
      `idegen helyszin sora csuszott be: ${stdout}`,
    );
  });

  it("hianyzo eszkoz-kod, kihagyas NELKUL: MEGALL, nem talalgat", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout, stderr } = futtat([
      "LSS22",
      "--kihagy",
      "12,13", // a 14-es (hianyzo kod) sor NINCS kihagyva
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.notEqual(kod, 0);
    assert.equal(stdout, "", "hibas esetben NEM szabad payloadot kiirnia");
    assert.match(stderr, /sor 14/);
  });

  it("UTKOZO partnerInternalCode (ket HEX, sorszam nelkul): MEGALL, megnevezi a sorokat", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout, stderr } = futtat([
      "LSS22",
      "--kihagy",
      "14", // csak a hianyzo-kodu sor van kihagyva, a ket HEX bent marad
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.notEqual(kod, 0);
    assert.equal(stdout, "", "utkozes eseten NEM szabad payloadot kiirnia");
    assert.match(stderr, /LSS22-HEX/);
    assert.match(stderr, /12/);
    assert.match(stderr, /13/);
  });

  it("NEM EGYEDI helyszin-kod a partner egysegei kozott: MEGALL, nem valaszt", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const kettozottEgysegek = {
      items: [
        ...EGYSEGEK.items,
        {
          id: "unit-lss22-masik",
          parentId: "unit-bio",
          code: "LSS22",
          name: "LSS22 (duplikatum)",
          isActive: true,
        },
      ],
    };
    const units = iras(dir, "egysegek.json", JSON.stringify(kettozottEgysegek));
    const { kod, stdout, stderr } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,15",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.notEqual(kod, 0);
    assert.equal(stdout, "");
    assert.match(stderr, /NEM EGYEDI/);
  });

  it("kategoria-terkep NELKUL: figyelmeztet, de NEM allit meg (utolag potolhato)", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout, stderr } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,15",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.equal(kod, 0);
    assert.match(stderr, /FIGYELMEZTETES/);
    const payload = JSON.parse(stdout);
    assert.ok(
      payload.every((p: Record<string, unknown>) => !("categoryId" in p)),
      "categoryId nem maradhat a payloadban kategoria-terkep nelkul",
    );
  });

  it("kategoria-terkeppel: ONALLO eszkoznel roman szam es a terkep magyar neve", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const terkep = iras(dir, "kategoria.txt", KATEGORIA_TERKEP);
    const { kod, stdout, stderr } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,15",
      "--tsv",
      tsv,
      "--units",
      units,
      "--kategoria-terkep",
      terkep,
    ]);
    assert.equal(kod, 0, stderr);
    assert.doesNotMatch(stderr, /FIGYELMEZTETES/);
    const payload = JSON.parse(stdout);
    assert.equal(payload.length, 2);
    assert.equal(
      payload[0].name,
      "BIO/LSS22 Légbefúfó, levegőztető szivattyú I",
    );
    assert.equal(
      payload[1].name,
      "BIO/LSS22 Légbefúfó, levegőztető szivattyú II",
    );
    assert.ok(
      payload.every((p: { categoryId?: string }) => p.categoryId === UUID_AIP),
    );
  });

  it("kategoria-terkeppel: BEEPITETT eszkoznel szulo neve + sajat neve + arab szam, ket jeggyel", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const terkep = iras(dir, "kategoria.txt", KATEGORIA_TERKEP);
    const { kod, stdout, stderr } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,10,11",
      "--tsv",
      tsv,
      "--units",
      units,
      "--kategoria-terkep",
      terkep,
    ]);
    assert.equal(kod, 0, stderr);
    const payload = JSON.parse(stdout);
    assert.equal(payload.length, 1);
    assert.equal(
      payload[0].name,
      "BIO/LSS22 (MAT) Kompakt szűrő Csepegtető bioszűrő egy hosszú, zárójeles (pillangó, golyós) leírással 01",
    );
    assert.equal(payload[0].categoryId, UUID_CPT_TRI);
  });

  it("kategoria-terkep MEGADVA, de egy kod HIANYZIK belole: MEGALL, megnevezi a sort es a kodot", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    // A HEX kod NINCS a KATEGORIA_TERKEP-ben -- pontosan az OCS/HSZ-fele
    // eset, amit acrobot szandekosan nem oldott meg talalgatassal.
    const terkep = iras(dir, "kategoria.txt", KATEGORIA_TERKEP);
    const { kod, stdout, stderr } = futtat([
      "LSS22",
      "--kihagy",
      "14,15,13",
      "--tsv",
      tsv,
      "--units",
      units,
      "--kategoria-terkep",
      terkep,
    ]);
    assert.notEqual(kod, 0);
    assert.equal(stdout, "");
    assert.match(stderr, /sor 12/);
    assert.match(stderr, /HEX/);
  });

  it("a sikeres payload partnerInternalCode ertekei EGYEDIEK -- ugyanaz a vegso ellenorzes, ami acrobotnal egy hibat elkapott", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,15",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.equal(kod, 0);
    const payload = JSON.parse(stdout) as { partnerInternalCode: string }[];
    const kodok = payload.map((p) => p.partnerInternalCode);
    assert.deepEqual([...new Set(kodok)], kodok);
  });

  it("--kind felulirja az EQUIPMENT alapertelmezest", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout } = futtat([
      "LSS22",
      "--kihagy",
      "14,12,13,15",
      "--tsv",
      tsv,
      "--units",
      units,
      "--kind",
      "SENSOR",
    ]);
    assert.equal(kod, 0);
    const payload = JSON.parse(stdout);
    assert.ok(payload.every((p: { kind: string }) => p.kind === "SENSOR"));
  });

  it("--units kapcsolo nelkul MEGALL, es megmondja, mit kell megadni", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const { kod, stderr } = futtat(["LSS22", "--tsv", tsv]);
    assert.notEqual(kod, 0);
    assert.match(stderr, /--units/);
  });

  it("ismeretlen helyszin-kod: MEGALL, nem ad ures payloadot csendben", () => {
    const dir = mappa();
    const tsv = iras(dir, "forras.tsv", ALAP_TSV);
    const units = iras(dir, "egysegek.json", JSON.stringify(EGYSEGEK));
    const { kod, stdout, stderr } = futtat([
      "LSS-NEMLETEZO",
      "--tsv",
      tsv,
      "--units",
      units,
    ]);
    assert.notEqual(kod, 0);
    assert.equal(stdout, "");
    assert.match(stderr, /LSS-NEMLETEZO/);
  });
});
