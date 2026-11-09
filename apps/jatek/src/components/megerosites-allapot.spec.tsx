import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { MegerositesAllapot } from "./megerosites-allapot.tsx";
import { PROBA_UZENET, probaToken } from "../lib/proba-token.ts";

/*
  WHAT TURNS THIS RED (the confirmation, card 31445d0f, barracuda's #2255 note). The confirmation sent when the page
  LOADS (an effect, or any call outside a click handler): a mail filter that runs JavaScript (Safe Links, corporate
  sandboxes) would then confirm in the address owner's place. The page without its button; a button that submits a
  form on its own; the result sentence shown before anything was clicked.
*/
const FORRAS = readFileSync(
  join(process.cwd(), "src", "components", "megerosites-allapot.tsx"),
  "utf8",
);

describe("a megerősítő gomb", () => {
  it("the first render is the button, with no result sentence and no 'in progress' text", () => {
    const h = renderToStaticMarkup(<MegerositesAllapot token="t" />);
    assert.match(h, /Megerősítem a részvételem/);
    assert.match(h, /<button[^>]*type="button"/);
    assert.doesNotMatch(h, /jatek-uzenet|folyamatban|megerősítve/);
  });

  it("nothing runs on load: no effect in the component, and the only fetch sits inside the click handler", () => {
    assert.doesNotMatch(FORRAS, /useEffect|useLayoutEffect/);
    assert.equal((FORRAS.match(/fetch\(/g) ?? []).length, 1);
    const fuggveny = FORRAS.slice(
      FORRAS.indexOf("async function megerosit()"),
      FORRAS.indexOf("if (allapot.fajta"),
    );
    assert.match(fuggveny, /fetch\(\s*"\/api\/megerosites"/);
    assert.match(FORRAS, /onClick=\{\(\) => void megerosit\(\)\}/);
  });
});

/*
  WHAT TURNS THIS RED (acrobot 44553): the test mail's link opening the real confirmation screen (a button that would POST a
  token to the api), instead of saying that the link works; a real token being taken for a test one.
*/
describe("a próbalevél linkje", () => {
  it("azt írja ki, hogy a link működik, és nem kínál megerősítést", () => {
    const h = renderToStaticMarkup(
      <MegerositesAllapot token="proba.0123456789abcdef01234567" />,
    );
    assert.match(h, /Ez próbalevél volt: a link működik\./);
    assert.equal(PROBA_UZENET, "Ez próbalevél volt: a link működik.");
    assert.doesNotMatch(h, /<button|Erősítsd meg|Megerősítem/);
  });

  it("a valódi token a megerősítő képernyőt kapja a gombbal", () => {
    const h = renderToStaticMarkup(
      <MegerositesAllapot token="valodi-nem-proba" />,
    );
    assert.match(h, /Erősítsd meg a részvételed/);
    assert.match(h, /<button/);
    assert.doesNotMatch(h, /próbalevél/);
  });

  it("csak a pontos előtag számít próbának (a valódi token base64url, pont nélkül)", () => {
    assert.equal(probaToken("proba.abc"), true);
    for (const t of ["proba-abc", "proba", "xproba.abc", "", "Proba.abc"])
      assert.equal(probaToken(t), false, t);
  });
});
