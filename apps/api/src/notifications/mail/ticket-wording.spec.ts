import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ticketTemplateWording } from "./ticket-wording.js";

/*
  A KARBANTARTÁSI LAP NEM HIBAJEGY A LEVÉLBEN SEM (Balázs, 2026-11-18; acrobot 55810): a levélsablonok szövege MAINTENANCE-nél "karbantartási lap".
  A sablon SZÖVEGÉN dolgozik (a tárgy, a törzs, a HTML-törzs), a behelyettesítés ELŐTT: a behelyettesített értékek (a jegy címe, a link) érintetlenek.
  MI PIROSÍT: ha a hibajegy szó MAINTENANCE-nél a levélben marad; ha a hibajegy (REPAIR) szövege megváltozik; ha egy ragozott alak (hibajegyhez,
  hibajegyet) rossz alakot ad; ha a nagybetűs "Hibajegy:" kisbetűs lesz; ha a szó része egy másik szónak.
*/
describe("a levélsablon szava a jegy fajtája szerint", () => {
  const text = (value: string) => ticketTemplateWording(value, "MAINTENANCE");

  it("a hibajegy és a ragozott alakjai karbantartási lap lesznek, a nagybetű megmarad", () => {
    assert.equal(
      text("A(z) {{jegyszam}} számú hibajegyhez tartozó munkalapot aláírták."),
      "A(z) {{jegyszam}} számú karbantartási laphoz tartozó munkalapot aláírták.",
    );
    assert.equal(
      text("Új hibajegyet rögzített egy ügyfél."),
      "Új karbantartási lapot rögzített egy ügyfél.",
    );
    assert.equal(
      text("Hibajegy: {{jegy_linkje}}"),
      "Karbantartási lap: {{jegy_linkje}}",
    );
    assert.equal(
      text("a hibajegyről, a hibajegyen, a hibajegynek, a hibajegyek"),
      "a karbantartási lapról, a karbantartási lapon, a karbantartási lapnak, a karbantartási lapok",
    );
  });

  it("a hibajegy (REPAIR) szövege és a nem hibajegy szavak változatlanok; az üres marad üres", () => {
    const original =
      "Új hibajegyet rögzített egy ügyfél. Hibajegy: {{jegy_linkje}}";
    assert.equal(ticketTemplateWording(original, "REPAIR"), original);
    assert.equal(ticketTemplateWording(original, undefined), original);
    assert.equal(text("hibajegykezelő szerepkör"), "hibajegykezelő szerepkör");
    assert.equal(text(""), "");
  });
});
