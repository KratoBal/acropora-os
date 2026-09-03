import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A RUNTIMEVERSION POLICY-JA DONTI EL, MELYIK BUILD KAP EGY OTA FRISSITEST -- ES
 * A ROSSZ VALASZTAS NEMA.
 *
 * A mert allapot (murena, 2026-09-02): a policy `appVersion` volt, a `version`
 * pedig kezzel "0.1.0", es soha nem lett emelve. Ettol mind a nyolc production
 * build (3-tol 10-ig) ugyanazt a runtimeVersion erteket vitte, tehat egy
 * frissites MINDEGYIKNEK felkinalodott.
 *
 * Buildenkent merve: az `expo-image-picker` CSAK a 10-esben van benne, a
 * `@react-native-community/datetimepicker` a 6-tol 10-ig. Egy regebbi buildre
 * kikuldott csomag olyan nativ modult hivna, ami abban a binarisban nincs bent.
 *
 * AMIT EZ AZ ORZO MER, ES AMIT NEM. Azt meri, hogy a policy a NATIV FELULETET
 * koveti (`fingerprint`), nem a kiadasi verziot. Azt NEM meri, hogy egy adott
 * frissites melyik buildhez jut el -- az az EAS oldalan dol el, es innen nem
 * lathato.
 *
 * MIERT ORZO ES NEM EGYSZERI JAVITAS: az `appVersion` policy visszaallitasa egy
 * sor, es a kovetkezmenye csak a KOVETKEZO ota-publikalasnal latszana, egy
 * telefonon, amit nem mi tartunk a kezunkben. Egy nema hiba, aminek egy soros
 * az utja vissza, orzot igenyel.
 */
const APP_CONFIG = "app.config.js";

/**
 * A forrasbol olvassuk, nem a modul betoltesevel: az `app.config.js` az Expo
 * futasido fele nyit, amit a teszt-forditas nem lat. Ugyanaz az indok, mint a
 * `submit-bundle-identifier.spec.ts` fajlban.
 */
function runtimeVersionPolicy(): string {
  const source = readFileSync(APP_CONFIG, "utf8");
  const block = /runtimeVersion:\s*\{([^}]*)\}/.exec(source);
  assert.ok(
    block,
    "nem találtam runtimeVersion blokkot az app.config.js fájlban",
  );
  const match = /policy:\s*"([^"]+)"/.exec(block[1]!);
  assert.ok(match, "a runtimeVersion blokkban nincs policy mező");
  return match[1]!;
}

describe("a runtimeVersion a natív felületet követi", () => {
  /**
   * A KONTROLL: tenyleg kiolvastunk egy erteket. Enelkul egy elrontott minta
   * ures stringet adna, es a lenti allitas "nem appVersion" agya ZOLDEN allna,
   * holott semmit nem olvasott.
   */
  it("kiolvas egy policy értéket a fájlból", () => {
    const policy = runtimeVersionPolicy();
    assert.equal(typeof policy, "string");
    assert.ok(policy.length > 0);
  });

  /**
   * A KONKRET HIBA, ami 2026-09-02-ig fennallt. Kulon allitas a pozitiv
   * mellett, mert mas a teendo: ha valaki az `appVersion`-hoz nyul vissza, azt
   * nem elirasnak kell olvasni, hanem dontesnek -- es akkor ez a fajl mondja
   * meg, mi lett volna a kovetkezmenye.
   */
  it("soha nem esik vissza appVersion policy-ra", () => {
    assert.notEqual(
      runtimeVersionPolicy(),
      "appVersion",
      "az appVersion policy mellett minden build ugyanazt a runtimeVersion értéket viszi, " +
        "és egy OTA frissítés a régi buildeknek is kimegy -- olyan natív modult hívva, " +
        "ami azokban nincs benne",
    );
  });

  it("fingerprint policy-t használ", () => {
    assert.equal(runtimeVersionPolicy(), "fingerprint");
  });
});
