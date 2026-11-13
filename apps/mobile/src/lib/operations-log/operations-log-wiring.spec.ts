import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ BEKÖTÉSE A FORRÁSBAN (task os-uzemeltetesi-naplo, S2c). A képernyőre és a natív rétegre (SQLite, kamera) nincs
 * komponens-teszt ebben az appban; amit mérni lehet, az a forrás: azok az összeköttetések, amelyek hiánya NÉMA (a rögzítés elmarad,
 * a kép nem megy fel, a másolat kijelentkezés után is a telefonon marad), és semmi nem piroslik tőle.
 *
 * KÜLÖN ÁLL A KÉT EGYEZTETÉS, AMI A SZERVER-OLDALI KAPUKAT KIEGÉSZÍTI: a küldés előtt a `queueTitle` leválik (a szerver DTO-ja nem
 * ismeri, és a nem ismert mező 400), és a kép szerver-oldali kulcsa a sor-azonosítóból számolt, nem maga a sor-azonosító (az útvonalat
 * hordoz, és a szerver mintájába nem fér).
 */
const SRC = join(__dirname, "..", "..", "..", "src");
const read = (path: string): string => {
  try {
    return readFileSync(join(SRC, path), "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${path}. Ez a KERESES hibaja, nem a lefedettsege.`,
    );
  }
};

const drain = read("lib/offline/use-queue-drain.ts");
const forget = read("lib/offline/forget-offline-data.ts");
const database = read("lib/offline/database.ts");
const layout = read("app/_layout.tsx");
const assetScreen = read("app/assets/[id].tsx");
const record = read("app/operations-log/record.tsx");

describe("az üzemeltetési napló bekötése", () => {
  it("a források betöltődtek", () => {
    // ISMERT POZITIV KONTROLL: ures fajlok mellett minden lenti allitas teljesulne.
    for (const source of [drain, forget, database, layout, assetScreen, record])
      assert.ok(source.length > 500);
  });

  it("a sor mindkét küldési ága ismeri a fajtát: a felvitel és a kép", () => {
    assert.equal(drain.match(/case "operations-entry":/g)?.length, 2);
    assert.match(drain, /return uzemeltetesiBejegyzestKuld\(row\)/);
  });

  it("a `queueTitle` a küldés előtt leválik, és a sor azonosítója a szerver kulcsa", () => {
    const sender = drain.slice(
      drain.indexOf("async function uzemeltetesiBejegyzestKuld"),
    );
    assert.match(sender, /const \{ queueTitle: _queueTitle, \.\.\.input \}/);
    assert.match(sender, /clientOperationId: row\.id/);
    assert.match(sender, /entityId: letrejott\.entry\.id/);
  });

  it("a kép kulcsa a sor-azonosítóból számolt, és a mező kulcsa nélkül a kép nem megy", () => {
    assert.match(
      drain,
      /clientOperationId: operationsPhotoClientKey\(row\.id\)/,
    );
    assert.match(drain, /if \(!payload\.fieldKey\)/);
    // a képernyő online ága ugyanazt a függvényt hívja ugyanarra a sor-azonosítóra
    assert.match(
      record,
      /clientOperationId: operationsPhotoClientKey\(rowId\)/,
    );
  });

  it("a két mentett lista táblája létrejön, és kijelentkezéskor törlődik", () => {
    assert.match(
      database,
      /CREATE TABLE IF NOT EXISTS cached_operations_templates/,
    );
    assert.match(
      database,
      /CREATE TABLE IF NOT EXISTS cached_operations_colleagues/,
    );
    assert.match(forget, /await forgetOperationsLogCache\(\);/);
  });

  it("a képernyő be van jegyezve, és az eszköz lapjáról a jog mögül nyílik", () => {
    assert.match(layout, /name="operations-log\/record"/);
    assert.match(assetScreen, /capabilities\?\.operationsLogRecord &&/);
    assert.match(assetScreen, /pathname: "\/operations-log\/record"/);
    // térerő nélkül is nyílik: nincs `!fromCache` feltétel a szakaszon
    const from = assetScreen.indexOf("capabilities?.operationsLogRecord &&");
    const to = assetScreen.indexOf('<Section title="Üzemeltetési napló">');
    assert.ok(from > 0 && to > from, "a szakasz nem található a forrásban");
    assert.ok(!assetScreen.slice(from, to).includes("!fromCache"));
  });

  it("a képernyő a jog nélkül kidob, és a mentés a sorba állító útvonalon megy", () => {
    assert.match(
      record,
      /if \(!capabilities\?\.operationsLogRecord\) return <Redirect/,
    );
    assert.match(record, /connectivity: deviceConnectivity,/);
    assert.match(record, /enqueueOperationsEntry\(\{/);
  });
});
