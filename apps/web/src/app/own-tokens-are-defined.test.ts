import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A SAJAT TOKENJEINKRE HIVATKOZO OSZTALY NE LEGYEN NEMA NO-OP.
 *
 * A Tailwind egy nem letezo szinnevre NEM hibazik: egyszeruen nem general
 * szabalyt, es az elem szintelen marad. A `format:check`, a `typecheck`, a
 * `test` es a `build` MIND ZOLD marad folotte -- egy osztalynev sima sztring.
 *
 * Ket kulon uton all elo ugyanez a nema hiba, es MIND A KETTOT mertuk ma:
 *
 *   1. a token DEFINICIOJA kikerul (vagy sosem kerul be), a hivas marad
 *   2. a token a fajlban van, de a `@theme` BLOKKON KIVUL -- akkor sem jon
 *      letre osztaly belole, es ezt a build sem mondja meg, csak a blokk HELYE
 *
 * Ezert a teszt a `@theme` blokk HATARAT szamolja ki, nem a fajlt olvassa.
 */

/**
 * A SAJAT NEVEINK. Kizarolag ezekre merunk, es ez szandekos hatar: a
 * Tailwind sajat skalai (`slate-*`, `emerald-*`, `white`) nincsenek a
 * `@theme`-ben, tehat egy altalanos ellenorzes rajuk hamisan bukna.
 *
 * Ha uj sajat csalad szuletik, IDE is fel kell venni -- amig nincs itt, a
 * teszt hallgat rola. Ez a lista tehat a lefedes HATARA, nem dekoracio.
 */
const CSALAD = ["nav", "brand", "dusk"]; // fokozatos: `brand-700`, `dusk-500`
const ONALLO = ["ink", "muted", "paper", "line", "coral"]; // nincs fokozatuk

/**
 * A KETTO KULON ALL, ES EZT EGY ELSO FUTAS TANITOTTA MEG.
 *
 * Eloszor egyetlen listat hasznaltam, es az `ONALLO` nevekre is engedtem
 * utotagot. Ettol a `text-muted-foreground` a MI `muted` tokenunknek latszott,
 * es tizenharom hamis talalatot adott. Az a nev nem a mienk: shadcn-konvencio.
 *
 * A SZUKITES AZONBAN CSAK ATMENETI VOLT, ES A MINTA MA UJRA TAG. Az `ONALLO`
 * nevek megint vehetnek utotagot -- mert a tizenharom talalat NEM ZAJ VOLT:
 * a `muted-foreground` sehol nem volt definialva, tehat az a tizenharom hely
 * tenyleg szintelen volt. Azota atallt `text-muted`-ra, ugyanebben a korben.
 *
 * ES EZERT KELL A TAG ALAK: egy szukitett minta pont azt a tizenharmat NEM
 * venne eszre, ha visszaszivarog. Azert szukitettem, mert a talalat zajnak
 * LATSZOTT -- es az orzo hatokoret nem szabad ahhoz igazitani, amit epp nem
 * akarunk latni. (acrobot kikotese, 2026-09-15: eloszor a tizenharom hely,
 * AZUTAN a tag minta.)
 *
 * AMI A TAG ALAKKAL EGYUTT SEM LESZ HAMIS: a `text-brand-ink` es a
 * `text-brand-muted` a CSALAD agra illeszkedik, es mind a ketto DEFINIALT --
 * lemerve, ezen kivul nincs mas olyan nev a faban, ami a mi neveinkkel
 * kezdodne es ne lenne a mienk.
 */

function themeBlokk(css: string): string {
  const kezd = css.indexOf("@theme");
  expect(kezd).toBeGreaterThanOrEqual(0);
  let melyseg = 0;
  for (let i = kezd; i < css.length; i += 1) {
    if (css[i] === "{") melyseg += 1;
    else if (css[i] === "}") {
      melyseg -= 1;
      if (melyseg === 0) return css.slice(kezd, i);
    }
  }
  throw new Error("a @theme blokk nem zarodik le");
}

const ELOTAG =
  "bg|text|border|ring|divide|from|to|via|fill|stroke|outline|accent|placeholder|decoration";
const HASZNALAT = new RegExp(
  `\\b(?:${ELOTAG})-((?:(?:${CSALAD.join("|")})-[a-z0-9]+)|(?:(?:${ONALLO.join("|")})(?:-[a-z0-9]+)?))(?![a-z0-9-])`,
  "g",
);

describe("saját színtokenek", () => {
  const gyoker = join(__dirname, "..");
  /*
    A `@theme` BLOKK 2026-09-24-TOL A `packages/ui/src/theme.css`-BEN EL,
    NEM ITT -- lasd ott a teljes indoklast (a partner portal is importalja).
    Ez a teszt tovabbra is az `apps/web/src` FAJLJAIT vizsgalja hasznalatra
    (azok nem koltoztek), csak a BLOKK FORRASA valtozott.
  */
  const css = readFileSync(
    join(gyoker, "..", "..", "..", "packages/ui/src/theme.css"),
    "utf8",
  );
  const blokk = themeBlokk(css);

  const fajlok = readdirSync(gyoker, { recursive: true, encoding: "utf8" })
    .filter((n) => /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n))
    .map((n) => join(gyoker, n));

  it("minden hivatkozott saját név a @theme blokkon BELÜL van definiálva", () => {
    const hianyzo: string[] = [];
    let osszes = 0;
    for (const f of fajlok) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(HASZNALAT)) {
        osszes += 1;
        if (!blokk.includes(`--color-${m[1]}:`))
          hianyzo.push(`${f.replace(gyoker, "")}: ${m[0]}`);
      }
    }
    // POZITIV KONTROLL: ha nulla hivast latnank, a fenti allitas URESEN lenne
    // zold -- pontosan az a "hianyt mero allitas, amit egy ures vilag is
    // kielegit". A szam tehat nem dekoracio, hanem a merés letezese.
    expect(osszes).toBeGreaterThan(20);
    expect(hianyzo).toEqual([]);
  });

  /**
   * ES A BLOKKON KIVULI DEFINICIO IS HIANYNAK SZAMIT. Ez a masodik ut: a nev
   * ott van a fajlban, csak nem ott, ahol osztalyt csinal belole.
   */
  it("a blokk-határ számít, nem a fájl", () => {
    expect(blokk).toContain("--color-nav-active:");
    expect(css.length).toBeGreaterThan(blokk.length); // van a blokkon kivuli resz is
    const blokkonKivul = css.replace(blokk, "");
    expect(blokkonKivul).not.toContain("--color-nav-active:");
  });
});
