import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  FEDETT_MUTATO_OSZTALYOK,
  FEDETT_OSZTALYOK,
  SHIM_CSS,
} from "./visibility-shim.js";

/**
 * AZ ORZO A LENYEG, NEM A SHIM.
 *
 * Egy shim, ami a mai osztalyokat fedi, holnap CSENDBEN kevesebbet fed -- es
 * onnantol a `toBeVisible` EGYENETLENUL hazudik: egyes esetekben mer, masokban
 * nem. Az egyenetlen hazugsag rosszabb a mainal, ahol legalabb EGYENLETESEN nem
 * mukodik: ma legalabb tudjuk, hogy nem tudjuk.
 *
 * Ezert a shim hatara nem csend, hanem PIROS SOR: ha a forrasban olyan rejto
 * osztaly all, amit a shim nem fed, ez a teszt elbukik, es MEGNEVEZI.
 */

/**
 * A RENDERELT FA TAGABB, MINT A SAJAT CSOMAGOM, ES AZ ORZO ELSO ALAKJA CSAK A
 * SAJATOT OLVASTA.
 *
 * Merve 2026-09-22: a nyolc `app-shell` bukast a `packages/ui/src/sidebar.tsx`
 * `hidden ... lg:flex` sora okozta -- vagyis a kar OTT keletkezett, ahova az
 * orzo nem nezett. Egy orzo, aminek a hatokore szukebb a renderelt fanal,
 * pontosan azt a fajlt hagyja ki, amiben a hiba van.
 */
const FORRAS_FAK = [
  join(process.cwd(), "src"),
  join(process.cwd(), "..", "..", "packages", "ui", "src"),
];

/**
 * Rejto osztalyok, amiket a `toBeVisible` LATNA -- az `sr-only` NEM ilyen.
 *
 * A BAL HATAR NEM `\b`, ES EZ NEM RESZLET. A `\b` a kotojel utan is illeszkedik,
 * tehat az `overflow-hidden` es az `aria-hidden` alakokbol is a puszta
 * `hidden`-t latja -- pedig egyik sem rejt. Merve 2026-09-22: a 76 talalatbol
 * 34 volt ilyen, vagyis a szam 45 szazalekkal volt felfujva, a valos 42.
 *
 * Es a karosabb fele nem a szam: a POZITIV KONTROLLOMAT is kielegitette volna
 * egyetlen `overflow-hidden`. Egy kontroll, amit egy nem-rejto alak elegit ki,
 * nem bizonyitja, hogy a kereses valodi rejto osztalyt megtalal.
 */
const REJTO_MINTA =
  /(?<![-\w:])(?:(?:sm|md|lg|xl|2xl):)?!?(?:hidden|invisible)(?![-\w])/g;

/**
 * A MUTATO IRANY, ES EZ A KAROS FEL.
 *
 * Egy FEDETLEN REJTO osztaly CSENDES: a teszt zold marad, es nem mer. Egy
 * fedetlen MUTATO osztaly HANGOS: a shim eltunteti azt, ami a bongeszoben
 * latszik, es a tesztek pirosra mennek. A ketto ara nem egyforma, de mindketto
 * a shim hatara -- ezert mindketto megnevezve bukik, nem csendben.
 *
 * A kotojeles valtozat (`sm:grid-cols-2`) NEM display-osztaly: a lezaro
 * `(?![-a-z0-9])` pont ezt vagja ki. Nelkule 111 talalat jon 7 helyett.
 */
const MUTATO_MINTA =
  /(?<![-\w])(?:sm|md|lg|xl|2xl):!?(?:inline-flex|inline-block|inline|flex|block|grid|table|contents)(?![-\w])/g;

function forrasFajlok(konyvtar: string): string[] {
  return readdirSync(konyvtar).flatMap((nev) => {
    const ut = join(konyvtar, nev);
    if (statSync(ut).isDirectory()) return forrasFajlok(ut);
    return ut.endsWith(".tsx") || ut.endsWith(".ts") ? [ut] : [];
  });
}

function hasznaltOsztalyok(minta: RegExp): Map<string, string[]> {
  const talalat = new Map<string, string[]>();
  for (const fa of FORRAS_FAK) {
    for (const ut of forrasFajlok(fa)) {
      if (ut.includes("/test/")) continue;
      const szoveg = readFileSync(ut, "utf8");
      for (const [osztaly] of szoveg.matchAll(minta)) {
        const helyek = talalat.get(osztaly) ?? [];
        if (!helyek.includes(ut)) helyek.push(ut);
        talalat.set(osztaly, helyek);
      }
    }
  }
  return talalat;
}

const hasznaltRejtoOsztalyok = () => hasznaltOsztalyok(REJTO_MINTA);
const hasznaltMutatoOsztalyok = () => hasznaltOsztalyok(MUTATO_MINTA);

function fedetlen(
  talalt: Map<string, string[]>,
  fedett: readonly string[],
): string[] {
  return [...talalt.entries()]
    .filter(([osztaly]) => !fedett.includes(osztaly))
    .map(([osztaly, helyek]) => `${osztaly} (${helyek.length} fajlban)`);
}

describe("a lathatosag-shim", () => {
  /**
   * POZITIV KONTROLL, ES ELOL ALL: ha a kereses NULLAT adna (athelyezett fa,
   * elirt minta), a lenti allitas URES halmazon menne vegig es ZOLDET adna --
   * pontosan az a meres, ami nem tud elbukni.
   */
  it("KONTROLL: talal is rejto osztalyt a forrasban", () => {
    const talalt = hasznaltRejtoOsztalyok();

    expect(talalt.size).toBeGreaterThan(0);
    expect(talalt.has("hidden")).toBe(true);
  });

  /**
   * NEGATIV KONTROLL, MERT A POZITIV ONMAGABAN GYENGE.
   *
   * Az `overflow-hidden` es az `aria-hidden` a szoveg szintjen tartalmazza a
   * `hidden` szot, de EGYIK SEM rejt. Ha a minta bal hatara `\b`, mindketto
   * talalat lesz -- es akkor a fenti kontroll akkor is zold, ha a fan EGYETLEN
   * valodi rejto osztaly sincs.
   */
  it("KONTROLL: a nem-rejto alakokat NEM szamolja rejtonek", () => {
    const minta = new RegExp(REJTO_MINTA.source, "g");

    expect("overflow-hidden".match(minta)).toBeNull();
    expect("aria-hidden".match(new RegExp(REJTO_MINTA.source, "g"))).toBeNull();
    expect(
      "sm:overflow-hidden".match(new RegExp(REJTO_MINTA.source, "g")),
    ).toBeNull();
    expect(
      'className="hidden"'.match(new RegExp(REJTO_MINTA.source, "g")),
    ).toEqual(["hidden"]);
  });

  it("MINDEN hasznalt rejto osztalyt FED a shim", () => {
    const hianyzo = fedetlen(hasznaltRejtoOsztalyok(), FEDETT_OSZTALYOK);

    expect(
      hianyzo,
      `Ezeket a rejto osztalyokat a shim NEM fedi, tehat a toBeVisible csendben ` +
        `lathatonak latna oket: ${hianyzo.join(", ")}. ` +
        `Vagy vedd fel a shimbe, vagy mondd ki, miert nem rejt.`,
    ).toEqual([]);
  });

  it("KONTROLL: talal is MUTATO osztalyt a forrasban", () => {
    const talalt = hasznaltMutatoOsztalyok();

    expect(talalt.size).toBeGreaterThan(0);
    expect(talalt.has("lg:flex")).toBe(true);
  });

  it("MINDEN hasznalt MUTATO osztalyt FED a shim", () => {
    const hianyzo = fedetlen(
      hasznaltMutatoOsztalyok(),
      FEDETT_MUTATO_OSZTALYOK,
    );

    expect(
      hianyzo,
      `Ezeket a MUTATO osztalyokat a shim NEM fedi, tehat egy \`hidden ... ` +
        `lg:flex\` alaku elem az asztali nezetben is REJTVE marad, holott a ` +
        `bongeszoben latszik: ${hianyzo.join(", ")}.`,
    ).toEqual([]);
  });

  it("a shim VALOBAN hat: osztallyal rejtett elem NEM lathato", () => {
    render(
      <div className="hidden" data-testid="rejtett">
        x
      </div>,
    );

    expect(screen.getByTestId("rejtett")).not.toBeVisible();
  });

  it("a reszponziv valtozat is hat az alapertelmezett nezeten", () => {
    render(
      <div className="md:hidden" data-testid="reszponziv">
        x
      </div>,
    );

    expect(screen.getByTestId("reszponziv")).not.toBeVisible();
  });

  /**
   * AHOL A SHIM VALOJABAN SZAMIT: A SZEREP-LEKERDEZESEK.
   *
   * A webes speceken NULLA valodi `toBeVisible` hivas all (az egyetlen talalat
   * egy komment). A `getByRole` viszont alapertelmezesben KIHAGYJA azt, ami a
   * hozzaferhetosegi fabol rejtve van -- es a fan 447 szerep-lekerdezes all 56
   * spec-fajlban. A shim nelkul mindegyik olyan elemet is megtalal, amit a
   * hasznalo az adott szelessegen nem lat.
   */
  it("a szerep-lekerdezes sem talalja meg az osztallyal rejtett elemet", () => {
    render(
      <div className="lg:hidden">
        <button type="button">Navigáció megnyitása</button>
      </div>,
    );

    expect(
      screen.queryByRole("button", { name: "Navigáció megnyitása" }),
    ).toBeNull();
  });

  it("KONTROLL: rejto osztaly nelkul a szerep-lekerdezes MEGTALALJA", () => {
    render(
      <div>
        <button type="button">Navigáció megnyitása</button>
      </div>,
    );

    expect(
      screen.getByRole("button", { name: "Navigáció megnyitása" }),
    ).toBeVisible();
  });

  it("KONTROLL: osztaly nelkuli elem tovabbra is LATHATO", () => {
    render(<div data-testid="lathato">x</div>);

    expect(screen.getByTestId("lathato")).toBeVisible();
  });

  it("a shim CSS-e a tablabol kepzodik, nem kezzel irt szoveg", () => {
    // Minden fedett osztalyhoz tartozik szabaly. Ha valaki kezzel bovitene a
    // CSS-t a lista frissitese nelkul, ez a sor jelez.
    for (const osztaly of FEDETT_OSZTALYOK)
      expect(SHIM_CSS).toContain(osztaly.replace(/([:!])/g, "\\$1"));
  });

  /**
   * A `!` MODOSITO KULON OSZTALYNEV, ES A MINTA ELSO ALAKJA ATENGEDTE.
   *
   * A DOM-ban a `lg:!hidden` literalisan ez a nev. Egy `\bhidden\b` alaku
   * kereses viszont a puszta `hidden`-t latja benne, es fedettnek hiszi --
   * pedig a `.lg\:hidden` szabaly NEM hat ra.
   */
  it("a `!` modositos valtozat is FEDVE van", () => {
    render(
      <div className="lg:!hidden" data-testid="fontos">
        x
      </div>,
    );

    expect(screen.getByTestId("fontos")).not.toBeVisible();
  });
});
