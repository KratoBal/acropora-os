import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  forgetSessionValues,
  rememberSessionValue,
  sessionKey,
  sessionValue,
} from "./session-memory";

/**
 * A LISTÁK SZŰRÉSE A MUNKAMENET IDEJÉRE (acrobot 26167). A képernyő-horog
 * (`useSessionState`) ezt a tiszta modult hívja; a telefon tesztsorában nincs
 * renderelő, tehát a szabály itt mérhető.
 *
 * MI PIROSÍT: ha egy újra felépülő lista az alapértelmezésről indulna a
 * megjegyzett szűrés helyett; ha két felhasználó vagy két lista szűrése
 * összekeveredne.
 */
afterEach(forgetSessionValues);

describe("a szűrés a munkamenet idejére", () => {
  it("az első felépülés az alapértelmezést kapja, a következő a megjegyzettet", () => {
    const key = sessionKey("u-1", "worksheets", "status");
    assert.equal(sessionValue(key, "DRAFT"), "DRAFT");
    rememberSessionValue(key, null);
    // egy újra felépülő képernyő ugyanezt kérdezi
    assert.equal(sessionValue(key, "DRAFT"), null);
  });

  it("felhasználónként és listánként külön", () => {
    rememberSessionValue(sessionKey("u-1", "service-jobs", "scope"), "all");
    assert.equal(
      sessionValue(sessionKey("u-2", "service-jobs", "scope"), "open"),
      "open",
    );
    assert.equal(
      sessionValue(sessionKey("u-1", "worksheets", "scope"), "open"),
      "open",
    );
    assert.equal(
      sessionValue(sessionKey("u-1", "service-jobs", "scope"), "open"),
      "all",
    );
  });
});
