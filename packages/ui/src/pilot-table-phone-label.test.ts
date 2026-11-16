import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A TELEFONOS KÁRTYA CÍMKÉJÉNEK OSZTÁLYA NEM ÁLLHAT SABLON-ÁG MELLETT (stage 390 px, 2026-11-13).
 *
 * A Tailwind a forrásszövegből szedi ki az osztályneveket. A `max-md:before:content-[attr(data-label)]${...}` alakból a név nem
 * kerül ki (a szomszédos `${` miatt), ezért a partner portál kártyáin a "FELADAT / TARTAM / VÍZÓRA" feliratok hiányoztak. A webes
 * alkalmazásban a név csak azért volt meg, mert egy webes tesztfájl külön is leírja. A mérés a FORRÁSSZÖVEG: a név saját, idézett
 * szövegként áll, és sehol nem követi közvetlenül `${`.
 */
const source = readFileSync(join(process.cwd(), "src", "pilot-os.tsx"), "utf8");
const CLASS_NAME = "max-md:before:content-[attr(data-label)]";

describe("a PilotDataTable telefonos címke-osztálya", () => {
  it("saját, idézett szövegként áll a forrásban", () => {
    assert.ok(
      source.includes(`"${CLASS_NAME}"`),
      `a(z) "${CLASS_NAME}" nem áll külön idézett szövegként`,
    );
  });

  it("sehol nem követi közvetlenül sablon-ág (`${`), mert azt a Tailwind nem veszi ki", () => {
    assert.equal(source.includes(`${CLASS_NAME}$` + "{"), false);
  });
});
