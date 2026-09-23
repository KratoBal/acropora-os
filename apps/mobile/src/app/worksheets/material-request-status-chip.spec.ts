import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * BALAZS KEPERNYOFOTOJA, 2026-09-23 20:52: A MUNKALAP ANYAGIGENY-SORAIN A
 * ZOLD ALLAPOT-CIMKE KILOGOTT A KARTYABOL. Szo szerint: "itt kilognak a
 * dolgok jobbra".
 *
 * AZ OK: `<View style={styles.row}>` (flexDirection row, justifyContent
 * space-between) ket gyereket tartalmazott -- egy hosszu byline-t
 * `styles.muted`-del (nincs rajta flex) es a cimke View-t `styles.statusChip`
 * (nincs rajta flexShrink). Egy hosszu byline emiatt a SAJAT termeszetes
 * szelesseget vette fel, es kitolta a cimket a kartyabol.
 *
 * MIERT A FORRAS SZOVEGEBOL: ebben a csomagban nincs komponens-teszt eszkoz
 * (lasd `src/lib/auth/tile-order.spec.ts` ugyanezt a hatart), tehat a
 * kepernyot nem lehet renderelni es tenylegesen lemerni, hogy kilog-e egy
 * elem. Amit meg lehet merni: hogy a FORRAS a helyes flex-tulajdonsagokat
 * hordozza-e -- ha valaki visszavonja a javitast (leveszi a `flex: 1`-et
 * vagy a `flexShrink: 0`-t), ez a teszt piros lesz, meg akkor is, ha a
 * kepernyot soha nem rendereljuk.
 *
 * A ROSSZ IRANYT ALLITJUK (acrobot kikotese, 2026-09-23): nem azt, hogy a
 * cimke "ott van", hanem azt, hogy a byline-nak es a cimkenek EGYUTT olyan
 * flex-tulajdonsaguk van, ami hosszu szoveg mellett sem tolja ki a cimket.
 * Egy allitas, ami csak annyit mondana, hogy "a statusChip stilus letezik",
 * akkor is zold maradna, ha a flex-tulajdonsag hianyzik.
 *
 * A HAROM STATUSCHIP-HELY, ES MELYIKNEL VOLT VALODI HIANY (megmerve, nem
 * feltetelezve):
 *   apps/mobile/src/app/worksheets/index.tsx:388     rowTitle MAR flex:1 --
 *                                                     nem hianyzott semmi
 *   apps/mobile/src/app/worksheets/[id].tsx:862      title MAR flex:1 --
 *                                                     nem hianyzott semmi
 *   apps/mobile/src/app/worksheets/[id].tsx:1976     muted-nek NEM volt
 *                                                     flex-je -- EZ a hiba
 */

/*
  A specek `test-dist/app/worksheets/` alatt futnak (lasd tsconfig.test.json),
  a .tsx forrasok viszont NEM masolodnak at oda -- csak a .spec.ts fajlok
  forditodnak. A `src/lib/auth/tile-order.spec.ts` ugyanezt a hatarat lepi at
  ugyanigy: harom szinttel fel a `test-dist/app/worksheets`-bol
  (`test-dist/app` -> `test-dist` -> `apps/mobile`), onnan vissza a
  `src/app/worksheets`-be, ahol a `.tsx` meg a forras-alakjaban all.
*/
const WORKSHEETS_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "worksheets",
);

function olvas(fajl: string): string {
  const teljes = join(WORKSHEETS_DIR, fajl);
  try {
    return readFileSync(teljes, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${teljes}. Ez a KERESÉS hibája, nem a lefedettségé.`,
    );
  }
}

/** Egy `NEV: { ... }` StyleSheet-bejegyzés szovege, a nev es a zaro `}` kozott. */
function styleBlokk(forras: string, nev: string): string {
  const minta = new RegExp(`\\b${nev}:\\s*\\{([^}]*)\\}`);
  const talalat = forras.match(minta);
  assert.ok(talalat, `nem talaltam "${nev}:" StyleSheet-bejegyzest`);
  const tartalom = talalat[1];
  assert.ok(tartalom !== undefined, `üres csoport "${nev}:" bejegyzésnél`);
  return tartalom;
}

describe("anyagigeny-sor allapot-cimke -- nem logha ki hosszu byline mellett", () => {
  const idForras = olvas("[id].tsx");
  const indexForras = olvas("index.tsx");

  it("POZITÍV KONTROLL: az anyagigeny-sor JSX blokkja tenyleg megvan a forrasban", () => {
    assert.match(
      idForras,
      /materialRequestByline\(request,/,
      "nem talaltam az anyagigeny-sor byline hivasat -- a keresesi minta avult el",
    );
    assert.match(
      idForras,
      /<View style=\{styles\.statusChip\}>/,
      "nem talaltam statusChip View-t -- a keresesi minta avult el",
    );
  });

  it("a javitott hely (worksheets/[id].tsx:~1976): a byline Text mar NEM csak styles.muted-et kap", () => {
    assert.match(
      idForras,
      /style=\{\[styles\.muted, styles\.materialRequestBylineText\]\}/,
      "a byline Text-nek egy nevesitett, flex-et hordozo stilust is kapnia kell a megosztott `muted` mellett",
    );
  });

  it("a javitott hely: a materialRequestBylineText stilus tenylegesen flex: 1-et hordoz", () => {
    const blokk = styleBlokk(idForras, "materialRequestBylineText");
    assert.match(
      blokk,
      /flex:\s*1\b/,
      `materialRequestBylineText nem hordoz flex: 1-et -- talalt tartalom: ${blokk}`,
    );
  });

  it("a javitott hely: a statusChip stilus tenylegesen flexShrink: 0-t hordoz ([id].tsx-ben)", () => {
    const blokk = styleBlokk(idForras, "statusChip");
    assert.match(
      blokk,
      /flexShrink:\s*0\b/,
      `statusChip nem hordoz flexShrink: 0-t -- talalt tartalom: ${blokk}`,
    );
  });

  it("a `muted` KOZOS stilus VALTOZATLAN maradt -- a javitas nem globalis", () => {
    /*
      Acrobot kifejezett kikotese: a `muted` mashol is hasznalt, tehat NEM
      irhato at globalisan. Ha ez az allitas piros lesz, az azt jelenti, hogy
      a javitas a kozos stilusba csuszott bele, es minden mas `muted`
      hasznalatot is erintett.
    */
    const blokk = styleBlokk(idForras, "muted");
    assert.doesNotMatch(
      blokk,
      /flex/,
      `a megosztott "muted" stilus flex-tulajdonsagot kapott -- ez tobb helyet is erint: ${blokk}`,
    );
  });

  it("a masik ket statusChip-hely MAR eleve flex:1-et hordoz a parjan -- nem volt hianyuk", () => {
    /*
      Ez a ket allitas NEM a mai javitas resze -- azt rogziti, amit MEGMERTEM,
      amikor a harom helyet vegignezetem (acrobot kerese szerint), hogy a
      masik ketto miert NEM kapott javitast. Ha valaha valaki lecsupaszitja
      a `title`/`rowTitle` stilust a flex:1-tol, ugyanez a kilogasi hiba
      allna elo ott is, es ez az allitas azt is elkapja.
    */
    const indexRowTitle = styleBlokk(indexForras, "rowTitle");
    assert.match(
      indexRowTitle,
      /flex:\s*1\b/,
      `index.tsx rowTitle elvesztette a flex: 1-et -- ${indexRowTitle}`,
    );

    const idTitle = styleBlokk(idForras, "title");
    assert.match(
      idTitle,
      /flex:\s*1\b/,
      `[id].tsx title elvesztette a flex: 1-et -- ${idTitle}`,
    );
  });
});
