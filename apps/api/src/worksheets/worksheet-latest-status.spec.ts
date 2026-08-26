import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * AZ ÁLLAPOT A LEGUTOLSÓ VERZIÓÉ, ÉS EZT AZ ALAKOT KELL ŐRIZNI.
 *
 * A viselkedést adatbázison bizonyítjuk (`worksheets.repository.integration.spec.ts`),
 * mert a `DISTINCT ON` valódi Postgresre való. Az integrációs suite viszont
 * csak külön erre a célra létrehozott adatbázison fut, a `pnpm test` sora
 * pedig nem futtatja: ha csak ott lenne állítás, a szűrő alakja hónapokig
 * mérés nélkül maradhatna.
 *
 * Ez a fájl ezért nem a viselkedést méri, hanem azt az EGY alakot, amitől a
 * DTO szerzője óvott: a `versions: { some: { status } }` feltételt. Az
 * bármelyik KORÁBBI verzióra illeszkedik, tehát egy háromszor átírt, ma már
 * aláírt lap is feljönne „piszkozat" szűrőre. A lista nem látszana hibásnak,
 * csak rossz sorokat tartalmazna -- és pontosan ezért nem szólna senki.
 */

const REPOSITORY = "src/worksheets/worksheets.repository.ts";

/** A tiltott alak: állapotra szűrés BÁRMELYIK verzión. */
const ANY_VERSION_STATUS = /versions:\s*\{\s*some:\s*\{[^}]*\bstatus\b/;

/** A helyes alak jelei: soronként az utolsó verzió, rendezéssel. */
const LATEST_VERSION_QUERY = /DISTINCT ON \("worksheetId"\)/;
const LATEST_VERSION_ORDER = /ORDER BY "worksheetId", "version" DESC/;

/**
 * A forrás, KOMMENTEK NÉLKÜL.
 *
 * Enélkül a keresés a saját magyarázatunkba botlik: a tároló doc-kommentje
 * IDÉZI a tiltott alakot, hogy elmondja, miért tiltott. Egy szövegre futó
 * kereséstől ez találat, tehát a teszt pirosra váltana attól, hogy leírtuk,
 * mit nem csinálunk. A kódot kell keresni, nem a prózát.
 */
function repositorySourceOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function repositorySource(): string {
  return repositorySourceOf(readFileSync(REPOSITORY, "utf8"));
}

/**
 * A KONTROLL A KERESÉSRE. Egy elrontott minta nulla találatot adna, és a
 * tiltást állító teszt zölden azt mondaná, hogy minden rendben.
 */
test("finds the forbidden shape in a sample that has it", () => {
  const sample = `
    const where = {
      versions: { some: { status: query.status } },
    };
  `;

  assert.equal(ANY_VERSION_STATUS.test(sample), true);
  // És ami NEM ez: a keresés a tárgyra, ami ma is megengedett.
  assert.equal(
    ANY_VERSION_STATUS.test(
      "versions: { some: { subject: { contains: query.search } } }",
    ),
    false,
  );
  // A KOMMENTBEN IDÉZETT alak sem találat: a `repositorySource` kiszedi a
  // kommenteket, mielőtt keresnénk. (Ez a teszt első futásán pirosat adott,
  // mert a tároló magyarázata idézi, amit tilt.)
  assert.equal(
    ANY_VERSION_STATUS.test(
      repositorySourceOf("/** versions: { some: { status } } tilos */"),
    ),
    false,
  );
});

test("reads the repository it claims to read", () => {
  const source = repositorySource();

  assert.ok(
    source.length > 5000,
    `A tároló forrása csak ${source.length} karakter. Ez a keresés hibája, nem a tárolóé.`,
  );
  assert.match(source, /async list\(/);
});

test("picks the latest version rather than any version", () => {
  const source = repositorySource();

  assert.match(source, LATEST_VERSION_QUERY);
  // A rendezés nem díszítés: a `DISTINCT ON` AZT a sort tartja meg, amelyik a
  // rendezés szerint az első. Rossz rendezéssel az ELSŐ verzió állapotára
  // szűrnénk, és a lista megint nem látszana hibásnak.
  assert.match(source, LATEST_VERSION_ORDER);
});

test("never filters status on just any version", () => {
  assert.equal(
    ANY_VERSION_STATUS.test(repositorySource()),
    false,
    "A tároló állapotra szűr valamelyik verzión: ez bármelyik KORÁBBI verzióra illeszkedik.",
  );
});
