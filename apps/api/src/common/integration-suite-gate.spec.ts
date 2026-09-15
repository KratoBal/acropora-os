import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A KIHAGYAS-KAPU KALIBRACIOJA, MINDKET IRANYBAN.
 *
 * A kapu (`scripts/integration-suite-gate.mjs`) azt allitja, hogy egy zold
 * futas NEM eleg: meg kell nezni, hogy a suite-ok LE IS FUTOTTAK-e. Egy ilyen
 * allitas csak akkor er valamit, ha meg tud bukni -- ezert minden eset ala
 * bemegy egy rontas, es a kapunak pirosra kell valtania tole.
 *
 * A FIXTURAK NEM KITALALT TAP-SZOVEGEK, HANEM VALODI FUTASOK KIMENETEI. Ez
 * nem ovatoskodas: egy korabbi kalibracioban kitalalt sor-alakra epitettem
 * (`# not ok`, ami nem letezik), es a mero uresen hagyta a nev-listat ugy, hogy
 * a SZAM rendben volt mellette. Itt a teszt LEFUTTATJA a `node --test`-et a
 * sajat mini-specjein, es azt adja a kapunak, amit a futtato tenylegesen irt.
 *
 * AMIT EZ AZ ALAK MEG BIZONYIT: hogy a `# skipped` szamlalo NEM latja a
 * kihagyott SUITE-ot. A masodik eset kimenete sajat kezbol jon, tehat nem kell
 * elhinni a kapu fejlecebe irt merest -- itt all mellette.
 */

function futtat(args: string[]): { kod: number; kimenet: string } {
  try {
    const kimenet = execFileSync(
      process.execPath,
      [
        join(
          process.cwd(),
          "..",
          "..",
          "scripts",
          "integration-suite-gate.mjs",
        ),
        ...args,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { kod: 0, kimenet };
  } catch (hiba) {
    const h = hiba as { status?: number; stdout?: string; stderr?: string };
    return {
      kod: h.status ?? -1,
      kimenet: `${h.stdout ?? ""}${h.stderr ?? ""}`,
    };
  }
}

/**
 * Egy mini munkafa: a `src` ag adja a VART neveket, a `run` ag pedig azt, ami
 * TENYLEG lefut. A kettо szandekosan kulon all -- a kapu epp a kulonbsegukrol
 * szol.
 */
function munkafa(
  specek: { fajl: string; nev: string; hatarolo?: string }[],
  futok: { nev: string; skip?: boolean }[],
) {
  const alap = mkdtempSync(join(tmpdir(), "suite-kapu-"));
  const src = join(alap, "src");
  const run = join(alap, "run");
  mkdirSync(src);
  mkdirSync(run);
  for (const { fajl, nev, hatarolo = '"' } of specek)
    writeFileSync(
      join(src, `${fajl}.integration.spec.ts`),
      `import { describe, it } from "node:test";\ndescribe(${hatarolo}${nev}${hatarolo}, () => {\n  it("x", () => {});\n});\n`,
    );
  const torzs = futok
    .map(
      ({ nev, skip }) =>
        `describe(${JSON.stringify(nev)}${skip ? ", { skip: true }" : ""}, () => {\n  it("x", () => {});\n});`,
    )
    .join("\n");
  writeFileSync(
    join(run, "a.test.mjs"),
    `import { describe, it } from "node:test";\n${torzs}\n`,
  );

  /**
   * A `NODE_TEST_CONTEXT` TOROLVE MEGY LE A GYEREKNEK, ES EZ NEM DISZ.
   *
   * A `node --test` felismeri, ha egy MASIK `node --test` folyamaton belul
   * indul, es ilyenkor nem futtat semmit: "run() is being called recursively
   * within a test file. skipping running files." Nulla `ok` sor, nulla
   * osszegzes -- vagyis a fixtura URESEN jonne vissza, es a kapu joggal
   * pirosodna ra. A kalibracio elso koreben pontosan ez tortent, es a hiba
   * ugy nezett ki, mintha a KAPUVAL lenne baj.
   *
   * MERVE, MINDKET IRANYBAN: a valtozoval beallitva nulla `ok` sor es nincs
   * osszegzes; torolve ket `ok` sor es van osszegzes.
   */
  const gyerekKornyezet = { ...process.env };
  delete gyerekKornyezet.NODE_TEST_CONTEXT;
  let tap = "";
  try {
    tap = execFileSync(
      process.execPath,
      ["--test", "--test-reporter=tap", join(run, "a.test.mjs")],
      { encoding: "utf8", env: gyerekKornyezet },
    );
  } catch (hiba) {
    tap = String((hiba as { stdout?: string }).stdout ?? "");
  }
  const naplo = join(alap, "tap.log");
  writeFileSync(naplo, tap);
  return { src, naplo, tap };
}

describe("integracios suite-kapu", () => {
  it("atengedi azt a futast, ahol minden vart suite lefutott", () => {
    const { src, naplo } = munkafa(
      [
        { fajl: "egy", nev: "ELSO SUITE" },
        { fajl: "ketto", nev: "MASODIK SUITE" },
      ],
      [{ nev: "ELSO SUITE" }, { nev: "MASODIK SUITE" }],
    );
    const { kod, kimenet } = futtat([naplo, "--src", src]);
    assert.equal(kod, 0, kimenet);
    assert.match(kimenet, /minden vart suite lefutott/);
  });

  /**
   * A RONTAS: az egyik suite `{ skip: true }`. ES A LENYEG A MASODIK ALLITAS:
   * ugyanebben a kimenetben a `# skipped` NULLA marad -- vagyis a kezenfekvo
   * szamlalo erre az esetre vak, es a kapu nem rola dont.
   */
  it("pirosra valt egy KIHAGYOTT suite-tol, amit a `# skipped` nem lat", () => {
    const { src, naplo, tap } = munkafa(
      [
        { fajl: "egy", nev: "ELSO SUITE" },
        { fajl: "ketto", nev: "MASODIK SUITE" },
      ],
      [{ nev: "ELSO SUITE" }, { nev: "MASODIK SUITE", skip: true }],
    );
    assert.match(tap, /^# skipped 0$/m);
    assert.match(tap, /ok \d+ - MASODIK SUITE # SKIP/);

    const { kod, kimenet } = futtat([naplo, "--src", src]);
    assert.equal(kod, 1, kimenet);
    assert.match(kimenet, /KIHAGYVA futott/);
    assert.match(kimenet, /MASODIK SUITE/);
  });

  /**
   * A MASIK RONTAS: a spec fajl LETEZIK, de a futasban a neve elo sem fordul.
   * Ez a nemabb eset -- a kimenetben semmi nem utal ra, tehat csak az talalja
   * meg, aki tudja, minek KELLENE ott lennie.
   */
  it("pirosra valt attol a suite-tol, ami el sem indult", () => {
    const { src, naplo } = munkafa(
      [
        { fajl: "egy", nev: "ELSO SUITE" },
        { fajl: "ketto", nev: "EL SEM INDULT SUITE" },
      ],
      [{ nev: "ELSO SUITE" }],
    );
    const { kod, kimenet } = futtat([naplo, "--src", src]);
    assert.equal(kod, 1, kimenet);
    assert.match(kimenet, /NEM JELENT MEG/);
    assert.match(kimenet, /EL SEM INDULT SUITE/);
  });

  /**
   * ES EGY HARMADIK, AMI NEM A FUTASROL SZOL, HANEM A KAPU SAJAT BEMENETEROL:
   * egy behelyettesitett `describe`-nevet nem lehet elore tudni. A kapu ilyenkor
   * MEGALL, ahelyett hogy csendben kihagyna -- kulonben pont egy nem figyelt
   * suite keletkezne, es a kapu zolden allitana, hogy mindent megnezett.
   */
  it("megall, ha egy vart suite nevet nem lehet a forrasbol kiolvasni", () => {
    const { src, naplo } = munkafa(
      [
        { fajl: "egy", nev: "ELSO SUITE" },
        { fajl: "ketto", nev: "SUITE ${valtozo}", hatarolo: "`" },
      ],
      [{ nev: "ELSO SUITE" }],
    );
    const { kod, kimenet } = futtat([naplo, "--src", src]);
    assert.equal(kod, 1, kimenet);
    assert.match(kimenet, /behelyettesitett describe-nev/);
  });

  /**
   * ES A LEGURESEBB ESET: a naploban EGYETLEN osszegzes sincs. Ilyen akkor all
   * elo, ha a futtato el sem jutott a tesztekig -- es a kapu enelkul az ellen is
   * vak lenne, hiszen "nulla vart suite hianyzik" formalisan igaz egy ures
   * kimenetre is.
   */
  it("pirosra valt, ha a naploban egy TAP-osszegzes sincs", () => {
    const { src, naplo, tap } = munkafa(
      [{ fajl: "egy", nev: "ELSO SUITE" }],
      [{ nev: "ELSO SUITE" }],
    );
    const csonka = tap
      .split("\n")
      .filter((s) => !s.startsWith("# ") && !s.startsWith("ok "))
      .join("\n");
    writeFileSync(naplo, csonka);
    const { kod, kimenet } = futtat([naplo, "--src", src]);
    assert.equal(kod, 1, kimenet);
    assert.match(kimenet, /EGYETLEN TAP-osszegzes sincs/);
  });
});
