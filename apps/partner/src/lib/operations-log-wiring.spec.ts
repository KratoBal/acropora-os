import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ PARTNER-OLDALÁNAK BEKÖTÉSE A FORRÁSBAN (task os-uzemeltetesi-naplo, S5). A képernyőre nincs komponens-teszt a
 * partner appban; amit mérni lehet, az a forrás: azok az összeköttetések, amelyek hiánya vagy tévedése NÉMA (a menüpont nem jelenik
 * meg; az oldal a BELSŐ végpontot hívná, amelyik kollégák nevét és belső megjegyzést ad; a képernyő kiírná, ki végezte).
 *
 * A SZŰRÉS A SZERVEREN DŐL EL (a partner végpont már szűrt választ ad), ezért itt nem a szűrést mérjük, hanem azt, hogy a képernyő
 * NEM hív belső végpontot, és NEM tartalmaz olyan mezőt, amelyet a partner nézet nem hordoz.
 */
// a futtatás a csomag gyökeréből indul (mint a `portal-wiring.spec.ts`-nél): az útvonalak a `src` alatt állnak
const read = (path: string): string => {
  try {
    return readFileSync(`src/${path}`, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: src/${path}. Ez a KERESES hibaja, nem a lefedettsege.`,
    );
  }
};

const api = read("lib/api.ts");
const shell = read("components/portal-shell.tsx");
const report = read("components/operations-log-report.tsx");
const page = read("app/(portal)/uzemeltetesi-naplo/page.tsx");

describe("az üzemeltetési napló partner-oldala", () => {
  it("a források betöltődtek", () => {
    for (const source of [api, shell, report, page])
      assert.ok(source.length > 100);
  });

  it("a kliens csak a partner végpontokat hívja, a belsőket nem", () => {
    const calls: string[] = [];
    const pattern = /(\/operations-log\/[^`"?]*)/g;
    for (let match = pattern.exec(api); match; match = pattern.exec(api))
      calls.push(match[1]!);
    assert.ok(calls.length >= 3, `operations-log hívások: ${calls.length}`);
    for (const call of calls)
      assert.match(call, /^\/operations-log\/partner\//, call);
  });

  it("a menüpont a szerver `navigation` válaszát nézi, és az útvonal létezik", () => {
    assert.match(shell, /entryId:\s*"operations-log-partner"/);
    assert.match(shell, /href:\s*"\/uzemeltetesi-naplo"/);
    assert.match(page, /OperationsLogReport/);
  });

  it("a képernyő nem ír ki kollégát, belső megjegyzést vagy belső jegyállapotot", () => {
    for (const forbidden of [
      "performers",
      "participantNames",
      "internalNote",
      "INTERNAL_STATUS",
      "WAITING_FOR_PARTS",
    ])
      assert.equal(report.includes(forbidden), false, forbidden);
    // a jegy állapota a partner-feliratból jön
    assert.match(report, /PARTNER_STATUS_LABELS/);
  });

  it("a PDF a partner végponton át jön, a fájl neve a hónapot hordozza", () => {
    assert.match(report, /operationsLogReportPdfBlob\(/);
    assert.match(report, /uzemeltetesi-naplo-\$\{month\}\.pdf/);
  });
});
