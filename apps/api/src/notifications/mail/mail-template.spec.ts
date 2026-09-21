import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAIL_TEMPLATE_VARIABLES,
  renderMailTemplate,
  unknownTemplateVariables,
} from "./mail-template.js";

const ERTEKEK = {
  cimzett: "Nyitó Nóra",
  jegyszam: "HJ-2026-001",
  jegy_targya: "Szivattyú zúg",
  jegy_leirasa: "Reggel óta hangos.",
};

describe("a valtozo-szotar", () => {
  /**
   * A SZOTAR ES A MOTOR NEM CSUSZHAT EL EGYMASTOL. Ha a felulet kezzel irt
   * listat mutatna, az elso uj valtozonal ketté valna -- es a szerkeszto egy
   * olyan nevet gepelne be, amit a motor nem ismer.
   */
  it("minden meghirdetett valtozot ISMER a motor", () => {
    const sablon = MAIL_TEMPLATE_VARIABLES.map((v) => `{{${v.name}}}`).join(
      " ",
    );
    assert.deepEqual(unknownTemplateVariables(sablon), []);
  });

  it("minden valtozohoz tartozik emberi leiras", () => {
    for (const v of MAIL_TEMPLATE_VARIABLES) {
      assert.ok(v.name.length > 0, "ures nev");
      assert.ok(v.description.length > 0, `nincs leirasa: ${v.name}`);
    }
    // ES A LISTA NEM URES: egy ures szotarra minden fenti allitas zold lenne.
    assert.ok(MAIL_TEMPLATE_VARIABLES.length >= 4);
  });
});

describe("behelyettesites", () => {
  it("az ismert valtozok helyere az ertek kerul", () => {
    const eredmeny = renderMailTemplate(
      "Kedves {{cimzett}}! A {{jegyszam}} ügyében írunk.",
      ERTEKEK,
    );
    assert.deepEqual(eredmeny, {
      ok: true,
      text: "Kedves Nyitó Nóra! A HJ-2026-001 ügyében írunk.",
    });
  });

  it("a szokozos alak is mukodik", () => {
    const eredmeny = renderMailTemplate("{{ cimzett }}", ERTEKEK);
    assert.deepEqual(eredmeny, { ok: true, text: "Nyitó Nóra" });
  });

  /**
   * A LENYEGI ALLITAS: ISMERETLEN VALTOZONAL NEM RENDERELUNK.
   *
   * Se ures string (attol a mondat ERTELMES MARAD, csak mast mond), se nyers
   * `{{...}}` (attol a vevo latja a belso mezonevunket).
   */
  it("ismeretlen valtozonal NEM ad szoveget, hanem megnevezi", () => {
    const eredmeny = renderMailTemplate("Kedves {{cimzet}}!", ERTEKEK);
    assert.equal(eredmeny.ok, false);
    if (eredmeny.ok) return;
    assert.deepEqual(eredmeny.unknown, ["cimzet"]);
  });

  /**
   * MINDEN ELGEPELEST OSSZEGYUJT, NEM CSAK AZ ELSOT. Kulonben a szerkeszto
   * egyesevel, ujrakuldesenkent tudna meg, hany hibaja van.
   */
  it("MINDEN ismeretlen nevet osszegyujt, egyszer-egyszer", () => {
    const eredmeny = renderMailTemplate(
      "{{a}} {{b}} {{a}} {{cimzett}}",
      ERTEKEK,
    );
    assert.equal(eredmeny.ok, false);
    if (eredmeny.ok) return;
    assert.deepEqual([...eredmeny.unknown].sort(), ["a", "b"]);
  });

  /**
   * A LEGKOZELEBBI TEVESZTES: egy VALTOZO NELKULI sablon nem ismeretlen, hanem
   * egyszeruen nem hasznal valtozot. Egy tul szeles orzo itt a rendes sablont
   * utasitana el.
   */
  it("valtozo nelkuli sablon rendben atmegy", () => {
    assert.deepEqual(renderMailTemplate("Tisztelt Ügyfelünk!", ERTEKEK), {
      ok: true,
      text: "Tisztelt Ügyfelünk!",
    });
  });

  /**
   * AZ URES ERTEK NEM ISMERETLEN. A jegy leirasa lehet kitoltetlen: olyankor a
   * valtozo LETEZIK, csak ures -- es a kuldesnek mennie kell.
   */
  it("ures ERTEK mellett kuldunk, csak az ismeretlen NEV allit meg", () => {
    const eredmeny = renderMailTemplate("A leírás: {{jegy_leirasa}}", {
      ...ERTEKEK,
      jegy_leirasa: "",
    });
    assert.deepEqual(eredmeny, { ok: true, text: "A leírás: " });
  });

  /**
   * A BEHELYETTESITETT ERTEK NEM ERTELMEZODIK UJRA. Ha a jegy leirasaba valaki
   * `{{cimzett}}`-et ir, az SZOVEG marad, nem valik valtozova -- kulonben egy
   * kulso adat tudna a sablon mezoit olvasni.
   */
  it("a behelyettesitett ertekben allo {{...}} NEM helyettesitodik be ujra", () => {
    const eredmeny = renderMailTemplate("A leírás: {{jegy_leirasa}}", {
      ...ERTEKEK,
      jegy_leirasa: "{{cimzett}}",
    });
    assert.deepEqual(eredmeny, { ok: true, text: "A leírás: {{cimzett}}" });
  });
});
