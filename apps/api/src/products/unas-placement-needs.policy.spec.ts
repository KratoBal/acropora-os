import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

/**
 * AZ UNAS NEM GAZDAJA AZ ELHELYEZESI IGENYEKNEK.
 *
 * A `fenyIgeny` es az `aramlasIgeny` a mi sajat adatunk; az UNAS-bol erkezo
 * frissites nem irhatja es nem szamolhatja ujra. Az allitas ezt a forras
 * SZOVEGEN meri, mert a tiltas azt jelenti, hogy ilyen ut NEM LETEZIK -- egy
 * nem letezo utat viselkedessel nem lehet megmerni.
 *
 * === MIERT KAPOTT POZITIV KONTROLLT (merve 2026-09-22) ===
 *
 * Eddig EGYETLEN, TAGADO allitasa volt, es semmi nem bizonyitotta, hogy a
 * forras egyaltalan beolvasodott. Egy elgepelt ut, egy atnevezett fajl vagy egy
 * atrendezett konyvtar eseten a `doesNotMatch` egy URES vagy ROSSZ szovegen
 * fut le, es OROKRE ZOLD marad -- pont az a fajta allitas, ami nem tud elbukni.
 *
 * A kontroll azert az OSZTALY NEVERE megy, mert az a fajl letezesenek
 * legstabilabb jele: a mezonevek es a fuggvenyek valtozhatnak, az exportalt
 * osztaly neve viszont a hivoi oldalrol is kotott.
 *
 * === ES A KALIBRACIO MEGMUTATTA, HOGY MI A VALODI VESZELY ===
 *
 * NEM az elgepelt ut: arra a `readFile` ENOENT-tel dob, tehat a spec a kontroll
 * NELKUL is piros volt. Merve: `NINCS-ILYEN-FAJL.ts` -> `code: 'ENOENT'`.
 *
 * A veszely az ATNEVEZETT vagy ATHELYEZETT fajl, aminek a helyere MAS kerul.
 * Merve, ugyanarra a letezo, de idegen fajlra (`unas-brand-master.ts`):
 *
 *     a kontrollal    PIROS, "nem a vart forrast olvastam be"
 *     kontroll nelkul ZOLD, 3432 teszt, nulla bukas
 *
 * A tagado allitas egy idegen forrason ugyanis TELJESUL -- es epp ez az az
 * eset, amit semmi nem fogott meg.
 */
const VIZSGALT = "src/imports/unas/unas-apply.repository.ts";

describe("UNAS does not own placement needs", () => {
  it("has no fenyIgeny or aramlasIgeny write/calculation path", async () => {
    const source = await readFile(resolve(process.cwd(), VIZSGALT), "utf8");

    // ISMERT POZITIV KONTROLL: az alabbi tagado allitas egy URES szovegen is
    // teljesulne, tehat onmagaban nem mondana semmit a vilagrol.
    assert.match(
      source,
      /export class UnasApplyRepository\b/,
      `${VIZSGALT}: nem a vart forrast olvastam be`,
    );

    assert.doesNotMatch(source, /\b(?:fenyIgeny|aramlasIgeny)\b/);
  });
});
