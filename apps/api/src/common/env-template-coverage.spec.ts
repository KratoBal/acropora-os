import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * MINDEN KORNYEZETI VALTOZO, AMIT A KOD OLVAS, ALLJON MINDKET SABLONBAN.
 *
 * MIERT KELL EZ. 2026-09-04-ig a Medusa integracio KILENC valtozoja kozul
 * EGYIK SEM allt egyik sablonban sem, holott a kod mindet olvassa. Aki egy
 * telepitest allitott be, a ket fajlbol nem tudhatta meg, mi kell -- es a
 * production sablon fejlece MAGA jelezte ket masik helyen ugyanezt (a
 * `UNAS_ORDER_SYNC_*` es a `NAV_INVOICE_SYNC_*` csaladnal). Harom eset ugyanaz
 * az alak: nem egyszeri figyelmetlenseg, hanem ismetlodo hiba.
 *
 * A LISTA GEPI, NEM KEZZEL KARBANTARTOTT: a fabol jon. Egy kezzel irt lista
 * pontosan az uj esetet hagyna ki -- azt, amiert a halo letezik. (Merve
 * ugyanezen a napon: harom kezzel irt fajlnev-tabla a repoban a regi nevre
 * mutatott egy kiemeles utan, es ZOLD MARADT volna, ha nincs bennuk ismert
 * pozitiv kontroll.)
 *
 * A NEGY HOZZAFERESI ALAK, ES CSAK AZ ELSOT LATJA A SZOKASOS MINTA:
 *
 *   kozvetlen     process.env.NEV
 *   indexelt      env["NEV"]
 *   konstanson at const K = "NEV"; env[K]
 *   osszefuzve    env[`NEV_V${verzio}`]   -- a verzioszam a NEV resze
 *
 * A harmadik NEM elmeleti: kilenc valtozo all igy, koztuk a
 * MEDUSA_STOREFRONT_SALES_CHANNEL_ID. Egy halo, ami csak az elso alakot nezi,
 * TELJESNEK LATSZANA es kilencet nem latna.
 */

/** A repo gyokere: a forditott spec a `test-dist/common/` alatt fut. */
const REPO = new URL("../../../../", import.meta.url).pathname;

const FA = ["apps/api/src", "apps/web/src", "packages"];

/**
 * EZ A FAJL KIMARAD A BEJARASBOL, ES EZT MERES HOZTA ELO, NEM ELOVIGYAZATOSSAG.
 *
 * Az elso futas negy nem letezo valtozot jelentett (`PELDA_KOZVETLEN` es
 * tarsai): a kontroll-teszt MINTAJAT olvasta be sajat magabol. Egy mero, ami a
 * sajat peldait meri, mindig talal valamit.
 *
 * A `PELDA_` elotag kizarasa rossz megoldas lett volna: az egy kezzel
 * karbantartott kivetel, es a kovetkezo pelda mas nevet kapna. A FAJL
 * kizarasa szerkezeti -- es nem veszit el semmit, mert egy halo nem olvas
 * kornyezeti valtozot.
 */
const SAJAT_FAJL = "env-template-coverage.spec.ts";

/**
 * A KOMMENTEKET KI KELL SZURNI, ES EZT NEM ELOVIGYAZATOSSAGBOL IRJUK IDE.
 *
 * Az elso meresem `MEDUSA_` nevu valtozot talalt, ami nem letezik: egy spec
 * KOMMENTJE idezte az `env.MEDUSA_...` alakot egy felsorolasban. Egy halo, ami
 * kommentre riaszt, ugyanolyan haszontalan, mint az, amelyik nem riaszt.
 */
function kodSorok(tartalom: string): string {
  return tartalom
    .split("\n")
    .filter((sor) => !/^\s*(\*|\/\/|\/\*)/.test(sor))
    .join("\n");
}

function tsFajlok(): string[] {
  const talalt: string[] = [];
  const bejar = (ut: string): void => {
    let bejegyzesek;
    try {
      bejegyzesek = readdirSync(ut, { withFileTypes: true });
    } catch {
      return;
    }
    for (const bejegyzes of bejegyzesek) {
      const teljes = `${ut}/${bejegyzes.name}`;
      if (bejegyzes.isDirectory()) {
        if (
          ["node_modules", "dist", "test-dist", ".turbo"].includes(
            bejegyzes.name,
          )
        )
          continue;
        bejar(teljes);
      } else if (
        bejegyzes.name.endsWith(".ts") &&
        bejegyzes.name !== SAJAT_FAJL
      )
        talalt.push(teljes);
    }
  };
  for (const gyoker of FA) bejar(`${REPO}${gyoker}`);
  return talalt.sort();
}

const KOZVETLEN = /(?:process\.)?env(?:ironment)?\.([A-Z][A-Z0-9_]{2,})/g;
const INDEXELT =
  /(?:process\.)?env(?:ironment)?\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\]/g;
const KONSTANS_HIVAS =
  /(?:process\.)?env(?:ironment)?\[\s*([A-Z][A-Za-z0-9_]*)\s*\]/g;
const OSSZEFUZOTT =
  /(?:process\.)?env(?:ironment)?\[\s*`([A-Z][A-Z0-9_]*)\$\{/g;

interface Leletek {
  nevek: Set<string>;
  prefixek: Set<string>;
}

function olvasottValtozok(): Leletek {
  const nevek = new Set<string>();
  const prefixek = new Set<string>();
  const konstansNevek = new Set<string>();
  const szovegek: string[] = [];

  for (const fajl of tsFajlok()) {
    const kod = kodSorok(readFileSync(fajl, "utf8"));
    szovegek.push(kod);
    for (const [, nev] of kod.matchAll(KOZVETLEN)) nevek.add(nev!);
    for (const [, nev] of kod.matchAll(INDEXELT)) nevek.add(nev!);
    for (const [, nev] of kod.matchAll(KONSTANS_HIVAS)) konstansNevek.add(nev!);
    for (const [, nev] of kod.matchAll(OSSZEFUZOTT)) prefixek.add(nev!);
  }

  // A konstansok ERTEKET is fel kell oldani: a `env[K]` alakbol csak a K nev
  // latszik, a valtozo neve a K DEFINICIOJABAN all.
  for (const kod of szovegek)
    for (const konstans of konstansNevek) {
      const minta = new RegExp(
        `\\b${konstans}\\s*(?::[^=]*)?=\\s*["']([A-Z][A-Z0-9_]{2,})["']`,
      );
      const talalat = minta.exec(kod);
      if (talalat) nevek.add(talalat[1]!);
    }

  // Az osszefuzott csalad PREFIXE nem valtozonev: a sablonban a konkret
  // peldany all (`..._V1`), tehat a prefixre nem szabad riasztani.
  for (const prefix of prefixek) nevek.delete(prefix);
  return { nevek, prefixek };
}

/**
 * SZANDEKOSAN NINCS SABLONBAN, ES EZ NEM ADOSSAG.
 *
 * KULON LISTA az `ISMERT_HIANY`-tol, mert a KETTO MAST JELENT: ez azt mondja,
 * hogy nem is kell oda; az azt, hogy kellene, es tartozunk vele. Egy kozos
 * listaban a ketto elrejtene egymast, es az adossag csendben allandova valna.
 */
const SZANDEKOS_KIVETEL = new Set<string>([
  // Csak a tesztek olvassak, futasidoben egyetlen kod-ut sem. A production
  // sablon kommentben KI IS MONDJA, hogy soha ne alljanak be elesben.
  "RUN_DB_INTEGRATION",
  "RUN_BRAND_INTEGRATION",
]);

/**
 * A MAI ADOSSAG, NEVVEL. EZ A LISTA CSAK ROVIDULHET.
 *
 * A halo elso futasa 33 hianyzot talalt. Ha mind riasztana, valaki
 * kikapcsolna az egeszet -- ezert all itt a mai allapot rogzitve, es a halo
 * attol kezdve MINDEN UJAT megfog. A mai adossag felszamolasa kulon munka.
 *
 * ES A LISTA NEM NOHET: egy uj nev ide irasa ugyanaz, mint kikapcsolni a halot
 * arra az egy valtozora. Ha valaki ide ir, azt a PR-ben meg kell indokolnia.
 */
const ISMERT_HIANY = new Set<string>([
  "ACROPORA_AI_ACCESS_TOKEN",
  "ACROPORA_AI_BASE_URL",
  "ACROPORA_AI_PRODUCT_SEARCH_TOKEN_ID",
  "ACROPORA_AI_USER_CONTEXT_TOKEN_ID",
  "ACROPORA_CONTENT_AGENT_TOKEN_IDS",
  "API_KEEP_ALIVE_TIMEOUT_MS",
  "APNS_ENVIRONMENT",
  "APNS_KEY_ID",
  "APNS_PRIVATE_KEY_BASE64",
  "APNS_TEAM_ID",
  "DOCUMENT_STORE_LIMIT_BYTES",
  "NEXT_PROXY_TIMEOUT_MS",
  "RELEASE_COMMIT_SHA",
  "RELEASE_EVIDENCE_EXPECTED_REPOSITORY",
  "RELEASE_EVIDENCE_RESULT_DETAIL_JSON",
  "UNAS_ORDER_DELETION_RECONCILIATION_BASE_BACKOFF_SECONDS",
  "UNAS_ORDER_DELETION_RECONCILIATION_BATCH_SIZE",
  "UNAS_ORDER_DELETION_RECONCILIATION_ENABLED",
  "UNAS_ORDER_DELETION_RECONCILIATION_INTERVAL_MINUTES",
  "UNAS_ORDER_DELETION_RECONCILIATION_LEASE_SECONDS",
  "UNAS_ORDER_DELETION_RECONCILIATION_MAX_BACKOFF_MINUTES",
  "UNAS_ORDER_DELETION_RECONCILIATION_RECHECK_HOURS",
  "UNAS_ORDER_DELETION_RECONCILIATION_STARTUP_DELAY_SECONDS",
  "UNAS_SHOP_TIME_ZONE",
  "UNAS_STOCK_SYNC_WORKER_BASE_BACKOFF_SECONDS",
  "UNAS_STOCK_SYNC_WORKER_BATCH_SIZE",
  "UNAS_STOCK_SYNC_WORKER_ENABLED",
  "UNAS_STOCK_SYNC_WORKER_INTERVAL_SECONDS",
  "UNAS_STOCK_SYNC_WORKER_LEASE_SECONDS",
  "UNAS_STOCK_SYNC_WORKER_MAX_ATTEMPTS",
  "UNAS_STOCK_SYNC_WORKER_MAX_BACKOFF_SECONDS",
  "UNAS_STOCK_SYNC_WORKER_STARTUP_DELAY_SECONDS",
]);

function sablon(nev: string): string {
  return readFileSync(`${REPO}${nev}`, "utf8");
}

/** A kikommentezett alak is szamit: az is MEGNEVEZI a valtozot. */
function allASablonban(valtozo: string, tartalom: string): boolean {
  return new RegExp(
    `^#?\\s*${valtozo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=`,
    "m",
  ).test(tartalom);
}

describe("a kornyezeti sablonok lefedettsege", () => {
  /**
   * A KONTROLL A KERESESRE. Enelkul egy elrontott minta nulla nevet adna, es a
   * halo zolden azt allitana, hogy minden valtozo dokumentalva van -- holott
   * azt jelentene, hogy a kereses romlott el.
   */
  it("megtalalja mind a negy hozzaferesi alakot egy mintan", () => {
    const minta = kodSorok(
      [
        "const a = process.env.PELDA_KOZVETLEN;",
        'const b = env["PELDA_INDEXELT"];',
        'const K = "PELDA_KONSTANSON_AT";',
        "const c = env[K];",
        "const d = environment[`PELDA_PREFIX_V${verzio}`];",
        " * a kommentben allo process.env.PELDA_KOMMENT nem szamit",
      ].join("\n"),
    );
    assert.equal(/PELDA_KOZVETLEN/.test(minta), true);
    assert.equal(/PELDA_KOMMENT/.test(minta), false);

    for (const [, nev] of minta.matchAll(KOZVETLEN))
      assert.equal(nev, "PELDA_KOZVETLEN");
    assert.deepEqual(
      [...minta.matchAll(INDEXELT)].map(([, nev]) => nev),
      ["PELDA_INDEXELT"],
    );
    assert.deepEqual(
      [...minta.matchAll(KONSTANS_HIVAS)].map(([, nev]) => nev),
      ["K"],
    );
    assert.deepEqual(
      [...minta.matchAll(OSSZEFUZOTT)].map(([, nev]) => nev),
      ["PELDA_PREFIX_V"],
    );
  });

  it("tenyleg beolvassa a fat es a ket sablont", () => {
    const fajlok = tsFajlok();
    assert.ok(
      fajlok.length >= 500,
      `Csak ${fajlok.length} TypeScript fajlt talaltam. Ez a bejaras hibaja, nem a lefedettsege.`,
    );

    const { nevek, prefixek } = olvasottValtozok();
    assert.ok(
      nevek.size >= 50,
      `Csak ${nevek.size} kornyezeti valtozot talaltam a kodban. Ez a mintak hibaja.`,
    );
    // Ket ISMERT POZITIV, ket kulonbozo alakbol: az elso kozvetlen olvasas, a
    // masodik CSAK a konstanson at latszik.
    assert.equal(nevek.has("MEDUSA_ADMIN_URL"), true);
    assert.equal(nevek.has("MEDUSA_STOREFRONT_SALES_CHANNEL_ID"), true);
    assert.ok(prefixek.size >= 1);

    for (const fajl of [".env.example", ".env.production.example"])
      assert.ok(sablon(fajl).length > 1000, `${fajl}: ures vagy olvashatatlan`);
  });

  it("minden olvasott valtozo all mindket sablonban", () => {
    const { nevek } = olvasottValtozok();
    const dev = sablon(".env.example");
    const eles = sablon(".env.production.example");

    const hianyzo = [...nevek]
      .filter((nev) => !SZANDEKOS_KIVETEL.has(nev) && !ISMERT_HIANY.has(nev))
      .filter((nev) => !allASablonban(nev, dev) || !allASablonban(nev, eles))
      .sort();

    assert.deepEqual(
      hianyzo,
      [],
      `Ezek a valtozok hianyoznak valamelyik sablonbol: ${hianyzo.join(", ")}. ` +
        `Vedd fel oket a .env.example ES a .env.production.example fajlba is.`,
    );
  });

  /**
   * A KET KIVETEL-LISTA CSAK ROVIDULHET, ES EZT ALLITAS ORZI.
   *
   * Egy nev, ami a listan all, de mar bekerult a sablonokba, CSENDBEN maradna
   * ott -- es a kovetkezo olvaso azt hinne, hogy meg mindig adossag. Ez az
   * allitas kikenyszeriti a takaritast.
   */
  it("a kivetel-listakon nem all olyan nev, ami mar bent van mindket sablonban", () => {
    const dev = sablon(".env.example");
    const eles = sablon(".env.production.example");

    const folosleges = [...ISMERT_HIANY]
      .filter((nev) => allASablonban(nev, dev) && allASablonban(nev, eles))
      .sort();

    assert.deepEqual(
      folosleges,
      [],
      `Ezek mar mindket sablonban allnak, tehat vedd ki oket az ISMERT_HIANY listabol: ${folosleges.join(", ")}`,
    );
  });
});
