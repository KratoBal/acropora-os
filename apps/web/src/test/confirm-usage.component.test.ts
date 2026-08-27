import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";

import { describe, expect, it } from "vitest";

/**
 * A BÖNGÉSZŐ KÉRDÉSE HELYETT A MIÉNK.
 *
 * A `window.confirm` ablaka egyetlen sorba zsúfolja a szöveget, a gombja pedig
 * „OK": aki megnyomja, nem tudja meg, mibe egyezett bele. A közös
 * `ConfirmDialog` ezért kötelezően három részre bontja a kérdést -- mit
 * teszünk, mi vész el, honnan szerezhető vissza --, és a harmadik azért külön
 * mező, mert épp azt szokás elfelejteni.
 *
 * Ez a teszt nem a szöveget méri (arra a képernyők saját tesztjei valók), hanem
 * a LEFEDETTSÉGET: egy holnap írt új képernyő, ami visszanyúl a böngésző
 * ablakához, ugyanaz a hiba lenne, csak más helyen. A lista ezért nem kézzel
 * karbantartott.
 */

const BROWSER_CONFIRM = /window\s*\.\s*confirm\s*\(|(?<![.\w])confirm\s*\(/;

async function sourceFiles(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("src/**/*.{ts,tsx}"))
    if (!/\.(test|spec)\.tsx?$/.test(entry))
      found.push(entry.replaceAll("\\", "/"));
  return found.sort();
}

describe("megerősítő kérdések", () => {
  /**
   * A KONTROLL A KERESÉSRE. Enélkül egy elrontott minta nulla találatot adna,
   * és a teszt zölden azt állítaná, hogy sehol nincs böngésző-kérdés -- miközben
   * azt jelentené, hogy a keresés romlott el.
   */
  it("finds the browser dialog in a sample that has it", () => {
    expect(BROWSER_CONFIRM.test('if (window.confirm("Biztos?")) run();')).toBe(
      true,
    );
    expect(BROWSER_CONFIRM.test("if (confirm(question)) run();")).toBe(true);
    // És ami NEM böngésző-kérdés: a saját metódusunk ugyanezen a néven.
    expect(BROWSER_CONFIRM.test("void this.confirm();")).toBe(false);
    expect(BROWSER_CONFIRM.test("onClick={() => void confirmDelete()}")).toBe(
      false,
    );
  });

  it("reads the files it claims to read", async () => {
    const files = await sourceFiles();

    // Nulla találat itt zöld lenne, és azt állítaná, hogy minden rendben.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain(
      "src/components/service-assets/asset-detail-page.tsx",
    );
  });

  it("asks with our own dialog everywhere, not with the browser's", async () => {
    const files = await sourceFiles();
    const offenders = files.filter((file) =>
      BROWSER_CONFIRM.test(readFileSync(file, "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * A MASIK IRANY: MINDEN TORLO HIVASNAK LEGYEN KERDESE.
 *
 * A fenti allitas azt tiltja, hogy a bongeszo ablakat hasznaljuk. Amit NEM
 * allit: hogy egy torles egyaltalan kerdez-e. Mert nem allitotta, ket hivasi
 * hely evekig kerdes nelkul torolt (a vonalkod veglegesen, azonnal), es a hiany
 * csak akkor derult ki, amikor valaki OSSZESZAMOLTA a torlo utakat. Egy
 * lefedettsegi hianyt nem szabad szamolasra bizni.
 *
 * A TORLO METODUSOK LISTAJA NEM KEZZEL TARTOTT: a kliens-fajlokbol olvassuk ki,
 * azon az alapon, hogy a metodus torzse `method: "DELETE"` kerest kuld. Egy
 * holnap irt uj torlo vegpont igy MAGATOL bekerul a merésbe -- egy kezzel
 * tartott lista pont akkor maradna el, amikor a legjobban kellene.
 */
const CONFIRM_COMPONENT = /ConfirmDialog/;

/**
 * AKI SAJAT KERDEST HASZNAL, ES MIERT SZABAD NEKI.
 *
 * A partner-torles kerdese ket agra KULONBOZO szoveget mond (fizikai torles
 * vagy toroltre jeloles), es a tervet a SZERVERTOL keri le, mert a kepernyo
 * adata elavulhat, amig a kerdes kint van. A kozos komponens ezt a kettot ma
 * nem tudja; egy "egysegesites" tehat nem javitas lenne, hanem vesztes.
 */
const OWN_QUESTION: Record<string, string> = {
  "src/components/suppliers/partner-delete-button.tsx":
    "Sajat, ketagú kerdes, a szervertol lekert tervvel.",
};

/** A torlo kliens-metodusok neve, a lib/api fajlokbol kiolvasva. */
async function destructiveMethods(): Promise<string[]> {
  const names = new Set<string>();
  for await (const entry of glob("src/lib/api/*.ts")) {
    if (/\.(test|spec)\.ts$/.test(entry)) continue;
    const source = readFileSync(entry, "utf8");
    const starts = [...source.matchAll(/\n {2}(\w+)\s*\(/g)];
    starts.forEach((match, index) => {
      const from = match.index ?? 0;
      const to = starts[index + 1]?.index ?? source.length;
      if (/method:\s*"DELETE"/.test(source.slice(from, to)))
        names.add(match[1]!);
    });
  }
  return [...names].sort();
}

describe("torlo hivasok es a kerdes", () => {
  /**
   * A KONTROLL. Ha a kiolvasas elromlik, nulla torlo metodust talalna, es a
   * lefedettsegi allitas ures halmazon menne vegig -- zolden.
   */
  it("finds the delete methods in the api clients", async () => {
    const methods = await destructiveMethods();

    expect(methods.length).toBeGreaterThanOrEqual(5);
    expect(methods).toContain("removeBarcode");
    expect(methods).toContain("remove");
  });

  it("asks before every delete a screen can start", async () => {
    const methods = await destructiveMethods();
    const calls = new RegExp(`\\.(?:${methods.join("|")})\\s*\\(`);
    const files = await sourceFiles();

    const offenders = files.filter((file) => {
      if (!file.startsWith("src/components/")) return false;
      const source = readFileSync(file, "utf8");
      if (!calls.test(source)) return false;
      if (CONFIRM_COMPONENT.test(source)) return false;
      return !(file in OWN_QUESTION);
    });

    expect(offenders).toEqual([]);
  });

  /**
   * A FALSZIFIKACIO: egy szandekosan kerdes nelkuli torles alaku forras
   * ILLESZKEDJEN a mintara. E nelkul a fenti ures lista azt is jelenthetne,
   * hogy a kereses nem talal semmit.
   */
  it("would notice a delete without a question", async () => {
    const methods = await destructiveMethods();
    const calls = new RegExp(`\\.(?:${methods.join("|")})\\s*\\(`);

    expect(
      calls.test("await productApi.removeBarcode(token, id, other);"),
    ).toBe(true);
    expect(calls.test("await productApi.list(token);")).toBe(false);
  });
});
