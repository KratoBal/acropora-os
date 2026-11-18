import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TICKET_WORDING, ticketHref, ticketRoute } from "./ticket-kind.js";

/*
  A KARBANTARTÁSI LAP A PARTNER PORTÁLON KÜLÖN MENÜPONT (Luca, 2026-11-18 14:50 UTC; acrobot 55980; Balázs 11:31: "a karbantartásnak semmi köze a hibajegyekhez"): a lista és az adatlap
  saját útvonalon és saját szavakkal áll, a hibajegy útvonala és szavai érintetlenek. MI PIROSÍT: ha a karbantartás útvonala a hibajegyeké; ha a karbantartás szövegében a "jegy" szó
  szerepel; ha a hibajegy szövege megváltozik; ha egy szó csak az egyik fajtánál van meg.
*/
describe("a jegy fajtája a partner portálon", () => {
  it("a karbantartás külön útvonal, a hibajegy marad", () => {
    assert.equal(ticketRoute("REPAIR"), "hibajegyek");
    assert.equal(ticketRoute("MAINTENANCE"), "karbantartas");
    assert.equal(ticketHref("REPAIR", "job-1"), "/hibajegyek/job-1");
    assert.equal(ticketHref("MAINTENANCE", "job-1"), "/karbantartas/job-1");
  });

  it("a két szövegkészlet ugyanazokat a kulcsokat tartalmazza", () => {
    assert.deepEqual(
      Object.keys(TICKET_WORDING.MAINTENANCE).sort(),
      Object.keys(TICKET_WORDING.REPAIR).sort(),
    );
  });

  it("a karbantartás szövegében nincs hibajegy-szó, a hibajegyében van", () => {
    for (const [key, text] of Object.entries(TICKET_WORDING.MAINTENANCE))
      assert.doesNotMatch(text, /jegy/i, `MAINTENANCE.${key}: ${text}`);
    assert.match(TICKET_WORDING.REPAIR.back, /Hibajegyek/);
    assert.match(TICKET_WORDING.REPAIR.column, /Hibajegy/);
  });
});
