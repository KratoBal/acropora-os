import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ticketMailContent } from "./ticket-mail.content.js";

const ALAP = {
  recipientName: "Nyitó Nóra",
  jobNumber: "HJ-2026-001",
  title: "Szivattyú zúg",
  description: "Reggel óta hangos, a nagymedencénél.",
  event: "A hibajegyhez tartozó munkalapot aláírták.",
};

describe("a level szovege", () => {
  it("az elore kitoltott resz tartalmazza a cimzettet, a szamot es a leirast", () => {
    const { text } = ticketMailContent(ALAP);
    assert.match(text, /Nyitó Nóra/);
    assert.match(text, /HJ-2026-001/);
    assert.match(text, /Reggel óta hangos/);
    assert.match(text, /munkalapot aláírták/);
  });

  /**
   * AZ EMBER SZAVAI SZO SZERINT MENNEK AT. Ha a kuldo atfogalmazna vagy
   * levagna, a "szemelyes erintettseg" epp az a resz lenne, amiben nem lehet
   * megbizni.
   */
  it("a szabad szoveg SZO SZERINT bekerul", () => {
    const { text } = ticketMailContent({
      ...ALAP,
      freeText: "Holnap reggel kimegyünk, Béla kollégám hívni fogja.",
    });
    assert.ok(
      text.includes("Holnap reggel kimegyünk, Béla kollégám hívni fogja."),
    );
  });

  /**
   * ES HA NINCS, NEM TALALUNK KI HELYETTE SEMMIT. Ez a lenyegi allitas:
   * egy kitalalt udvariassagi mondat pont azt hamisitana meg, amiert a mezo
   * letezik.
   */
  it("szabad szoveg NELKUL a level UGYANAZ, mint ures szabad szoveggel", () => {
    const nelkul = ticketMailContent(ALAP).text;
    const uressel = ticketMailContent({ ...ALAP, freeText: "   " }).text;
    const nullal = ticketMailContent({ ...ALAP, freeText: null }).text;

    assert.equal(nelkul, uressel);
    assert.equal(nelkul, nullal);
  });

  /**
   * A LEGKOZELEBBI TEVESZTES: a hianyzo LEIRAS se szuljon "(nincs)" alaku
   * sort. Egy ilyen sor tobbet allit a semminel: azt mondja, megneztuk es ures.
   */
  it("leiras nelkul nem all ott ures leiras-szakasz", () => {
    const { text } = ticketMailContent({ ...ALAP, description: null });
    assert.ok(!text.includes("A bejelentés szövege"));
    // ES A TOBBI RESZ MEGMARAD: a hiany nem viheti el a jegyszamot.
    assert.match(text, /HJ-2026-001/);
  });
});
