import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A PARTNER ADATLAPJAI (picasso képernyő-leltár, 4. pont, P4 és P7; acrobot 62248).
 *
 * P4: a jobb oszlop adatsorai a `PilotDataRow` alap 180 px-es címkéjével álltak egy 280-300 px-es oszlopban: az értéknek ~60 px
 * maradt, a "KT-2026-005" és a "Nincs megadva" három sorra tört. Mostantól a jobb oszlop 340 px, a sorai a belső web 110 px-es
 * címkéjével állnak. P7: a felső felirat (eyebrow) minden adatlapon az objektum száma, ahogy a hibajegy, a munkalap, a megrendelés
 * és a teljesítési igazolás lapján, és az OS-ben; két lap eddig szót írt ("AKVÁRIUM", "ESZKÖZ").
 *
 * A HATÁR: forrást olvas (a csomagban nincs renderelő, lásd portal-wiring.spec.ts). MI PIROSIT: egy jobb-oszlopos adatsor 110 px-es
 * címke nélkül; a jobb oszlop 340 px-nél keskenyebb; a felső felirat helyén szó áll a szám helyett.
 */
const read = (name: string) =>
  readFileSync(`src/components/${name}.tsx`, "utf8");

/** The data rows from a card header to the end of the file (the right column is the page's last column). */
function rowsAfter(source: string, header: string): string[] {
  const at = source.indexOf(header);
  assert.ok(at >= 0, `missing card header: ${header}`);
  return source.slice(at).match(/<PilotDataRow[^>]*?(?:\/>|>)/gs) ?? [];
}

describe("P4: a jobb oszlop adatsorai nem törnek", () => {
  for (const [name, header] of [
    ["worksheet-detail", '<PilotCardHeader title="Munkalap adatai" />'],
    ["ticket-detail", "<PilotCardHeader title={words.caseDataTitle} />"],
    ["aquarium-detail", '<PilotCardHeader title="Alapadatok" />'],
  ] as const) {
    it(`${name}: a jobb oszlop 340 px, minden sora 110 px-es címkével`, () => {
      const source = read(name);
      assert.match(source, /lg:grid-cols-\[1fr_340px\]/);
      const rows = rowsAfter(source, header);
      assert.ok(rows.length > 0, `${name}: no data rows found`);
      for (const row of rows)
        assert.match(row, /labelWidth="110px"/, `${name}: ${row.slice(0, 80)}`);
    });
  }
});

describe("P7: a felső felirat az objektum száma", () => {
  const EYEBROW =
    /<p className="mb-1 text-\[10px\] font-bold uppercase tracking-widest text-pilot-grey-400">\s*([^<]+?)\s*<\/p>/;
  for (const [name, expected] of [
    ["aquarium-detail", "{aquarium.aquariumNumber}"],
    ["asset-detail", "{asset.assetNumber}"],
    ["ticket-detail", "{ticket.jobNumber}"],
    ["completion-certificate-detail", "{certificate.number}"],
    ["maintenance-order-detail", "{order.number}"],
    ["worksheet-detail", '{worksheet.number ?? "PISZKOZAT"}'],
  ] as const) {
    it(`${name}: ${expected}`, () => {
      const eyebrow = read(name).match(EYEBROW)?.[1];
      assert.equal(eyebrow, expected);
    });
  }
});
