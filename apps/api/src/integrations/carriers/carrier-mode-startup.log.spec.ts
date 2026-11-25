import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { carrierModeLine } from "./carrier-mode-startup.log.js";

/*
  THE START-UP LINE NAMES THE MODE THE CODE TAKES (acrobot 61511). WHAT TURNS THIS RED: `live-read` named as `live` (the line
  would not tell a read-only switch from a writing one); an unknown setting shown as itself and not as the stub it falls back to;
  a missing setting not shown as the stub; a value that is not a mode word (a key by mistake) written into the log.
*/
describe("the courier mode line at start-up", () => {
  it("names live-read, live, test and the stub as the code takes them", () => {
    assert.equal(
      carrierModeLine({ FOXPOST_API_MODE: "live-read", GLS_API_MODE: "live" }),
      "Futár mód: foxpost=live-read, gls=live",
    );
    assert.equal(
      carrierModeLine({ FOXPOST_API_MODE: "test" }),
      "Futár mód: foxpost=test, gls=stub",
    );
  });

  it("a misspelt setting shows as the stub it falls back to, with what was set", () => {
    assert.equal(
      carrierModeLine({ FOXPOST_API_MODE: "live_read", GLS_API_MODE: "" }),
      'Futár mód: foxpost=stub (beállítva: "live_read"), gls=stub (beállítva: "")',
    );
  });

  it("a value that is not a mode word is not written, only its length", () => {
    const line = carrierModeLine({
      FOXPOST_API_MODE: "sk_live_Ab12Cd34Ef56Gh78",
      GLS_API_MODE: "Live-Read",
    });
    assert.equal(
      line,
      "Futár mód: foxpost=stub (ismeretlen beállítás, 24 karakter), gls=stub (ismeretlen beállítás, 9 karakter)",
    );
    assert.ok(!line.includes("Ab12"));
  });
});
