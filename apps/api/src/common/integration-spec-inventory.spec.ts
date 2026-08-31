import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * A KERDES MEGVALTOZOTT, ES EZ A LENYEG.
 *
 * A `test:integration` szkript 2026-08-31-ig KEZZEL FELIROTT fajllistabol
 * dolgozott, es ez a fajl azt allitotta, hogy minden lemezen levo spec szerepel
 * benne. A lista viszont EGYETLEN sor volt a `package.json`-ban, tehat minden
 * ag, ami uj integracios specet hozott, UGYANABBA a sorba irt: aznap NEGY
 * utkozesunk volt belole, mind ugyanott, es egyik sem tartalmi.
 *
 * A szkript mostantol FELDERIT (`find`), tehat egy uj spec felvetele nem
 * modositja a `package.json`-t -- az utkozes nem kezelhetobb lett, hanem nem
 * keletkezik. Ettol viszont a regi kerdes ("fel van-e veve?") ertelmet vesztette:
 * a valasz szerkezetileg mindig igen.
 *
 * AMIT HELYETTE KERDEZUNK: MIERT NINCS egy spec a kozos futasban. Ma egy
 * kizaras van (a `brands`, mert sajat kornyezeti valtozot kivan), es a kizart
 * halmaznak PONTOSAN azzal kell egyeznie, aminek sajat szkriptje van.
 *
 * ES A HARMADIK ALLITAS AZ, AMI A JOVOT VEDI. A felderites MINDENT lefuttat,
 * amit talal: az elso olyan spec, ami kulon kornyezetet igenyel, CSENDBEN
 * bekerulne a kozos futasba, es ott hasalna el. Merve 2026-08-31: a huszonharom
 * integracios spec kozul PONTOSAN EGY hivatkozik kozvetlenul `process.env`-re
 * (a `brands`, a `RUN_BRAND_INTEGRATION` miatt); a masik huszonketto a kozos
 * kapun (`integrationDatabaseGate(process.env)`) at olvas, amit a kozos szkript
 * kielegit. Vagyis a kozvetlen `process.env` hivatkozas PONTOS jelzes arra, hogy
 * egy spec tobbet kiván a kozosnel -- es az ilyen speceknek a kizart halmazban a
 * helyuk.
 */

const PACKAGE_JSON = "package.json";
const SPEC_ROOT = "src";
const COMMON_SCRIPT = "test:integration";

function specsOnDisk(directory = SPEC_ROOT): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return specsOnDisk(path);
      return path.endsWith(".integration.spec.ts") ? [path] : [];
    })
    .sort();
}

function scripts(): Record<string, string> {
  return (
    JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;
}

/** Amit a kozos szkript a `find` `! -name` feltételeivel KIHAGY. */
function excludedFromCommonRun(): string[] {
  const command = scripts()[COMMON_SCRIPT] ?? "";
  return [...command.matchAll(/! -name '([\w./-]+)'/g)]
    .map((match) => match[1] ?? "")
    .filter(Boolean)
    .sort();
}

/** Egy spec neve `test-dist` alakban, ahogy a szkriptek hivatkoznak ra. */
const compiledName = (path: string) =>
  path.split("/").pop()?.replace(/\.ts$/, ".js") ?? "";

/**
 * A KONTROLL, ES ELOL ALL. Egy leltar, ami URES halmazt vet ossze egy
 * szaballyal, ROSSZ OKBOL megy at: nem talal szabalytalan specet, mert nem talal
 * specet. Ez a sor szol eloszor, ha a fajlok elmozdulnak.
 */
test("megtalálja a specet és a szkriptet, amit összevet", () => {
  assert.ok(
    specsOnDisk().length >= 20,
    `Csak ${specsOnDisk().length} integrációs specet találtam; a keresés valószínűleg elavult.`,
  );
  assert.ok(
    scripts()[COMMON_SCRIPT]?.includes("find test-dist"),
    `A ${COMMON_SCRIPT} szkript nem felderítéssel dolgozik; ez a fájl a felderítést őrzi.`,
  );
});

/**
 * AMI KULON KORNYEZETET KIVAN, AZ NEM MEHET A KOZOS FUTASBA. A kozvetlen
 * `process.env` hivatkozas a jelzes: a tobbi spec a kozos kapun at olvas.
 */
test("ami saját környezeti változót olvas, az ki van zárva a közös futásból", () => {
  const excluded = new Set(excludedFromCommonRun());
  const needsOwnEnv = specsOnDisk().filter((path) =>
    /process\.env\.[A-Z_]+/.test(readFileSync(path, "utf8")),
  );
  assert.ok(
    needsOwnEnv.length > 0,
    "Egyetlen spec sem olvas közvetlenül környezeti változót; a minta valószínűleg elavult.",
  );
  assert.deepEqual(
    needsOwnEnv.filter((path) => !excluded.has(compiledName(path))),
    [],
    "Ezek a specek saját környezeti változót olvasnak, mégis a közös futásban vannak.",
  );
});

/**
 * ES A MASIK IRANY: amit kizarunk, annak LEGYEN hol futnia. Egy kizaras, amihez
 * nem tartozik szkript, ugyanaz a nema kiesés, ami ellen ez a fajl eredetileg
 * keszult -- csak a masik oldalrol.
 */
test("minden kizárt specet futtat egy saját szkript", () => {
  const all = Object.entries(scripts())
    .filter(([name]) => name !== COMMON_SCRIPT)
    .map(([, command]) => command)
    .join("\n");
  const homeless = excludedFromCommonRun().filter(
    (name) => !all.includes(name),
  );
  assert.deepEqual(
    homeless,
    [],
    "Ezek a specek ki vannak zárva a közös futásból, és egyetlen másik szkript sem futtatja őket.",
  );
});
