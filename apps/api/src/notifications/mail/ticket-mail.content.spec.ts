import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { richHtmlToText, sanitizeRichHtml } from "@acropora/rich-text";

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

/**
 * A KERET HTML-IKRE (2026-09-26): a szoveges vetulete PONTOSAN a szoveges
 * level. Ha a ketto elcsuszna, a levelezo a HTML-t mutatja, a masik
 * alternativa pedig mast mondana -- es egyik sem hibazna.
 */
describe("a keret HTML-ikre", () => {
  const ALAP = {
    recipientName: "Nyitó <Nóra> & Tsa",
    jobNumber: "HJ-2026-001",
    title: "Szivattyú zúg",
    event: "Aláírták a lapot.",
    eventHtml: "<p><strong>Aláírták</strong> a lapot.</p>",
  };

  for (const [nev, bemenet] of [
    ["leiras es szabad szoveg nelkul", { ...ALAP, description: null }],
    [
      "leirassal es tobbsoros szabad szoveggel",
      {
        ...ALAP,
        description: "Reggel óta\nhangos.",
        freeText: "Holnap megyünk.\nÜdv",
      },
    ],
  ] as const)
    it(`a HTML szoveges vetulete a szoveges level (${nev})`, () => {
      const level = ticketMailContent(bemenet);
      assert.ok(level.html);
      assert.equal(richHtmlToText(level.html), level.text);
    });

  it("a kodbol jovo nev escape-elve all, a HTML tiszta", () => {
    const level = ticketMailContent({ ...ALAP, description: null });
    assert.ok(
      level.html?.startsWith("<p>Kedves Nyitó &lt;Nóra&gt; &amp; Tsa!</p>"),
    );
    assert.equal(sanitizeRichHtml(level.html ?? ""), level.html);
  });

  it("eventHtml nelkul nincs html kulcs", () => {
    const { eventHtml: _nincs, ...szoveges } = ALAP;
    void _nincs;
    assert.equal(
      "html" in ticketMailContent({ ...szoveges, description: null }),
      false,
    );
  });
});
