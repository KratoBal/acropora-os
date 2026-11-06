import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { MegerositesAllapot } from "./megerosites-allapot.tsx";

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
