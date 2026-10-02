import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  baseDomainOf,
  manufacturerSites,
  sourceUrlProblem,
} from "./enrichment-sources.js";

const SITES = {
  manufacturer: ["gyarto.example.invalid"],
  supplier: "beszallito.example.invalid",
};

// PD-013 calibration: a URL outside the four allowed sources is refused.
describe("a négy engedélyezett forrás, és semmi más", () => {
  it("a két kereskedő a saját domainjén és aldomainjén olvasható", () => {
    assert.equal(
      sourceUrlProblem(
        "BULK_REEF_SUPPLY",
        "https://www.bulkreefsupply.com/p/1",
        SITES,
      ),
      null,
    );
    assert.equal(
      sourceUrlProblem(
        "MARINE_AQUATICS",
        "https://marine-aquatics.eu/x",
        SITES,
      ),
      null,
    );
    assert.equal(
      sourceUrlProblem(
        "MARINE_AQUATICS",
        "https://shop.marine-aquatics.eu/x",
        SITES,
      ),
      null,
    );
  });

  it("más hoszt, hasonló név, vagy rossz fajta: elutasítva", () => {
    for (const [kind, url] of [
      ["BULK_REEF_SUPPLY", "https://bulkreefsupply.com.evil.example/p"],
      ["BULK_REEF_SUPPLY", "https://notbulkreefsupply.com/p"],
      ["BULK_REEF_SUPPLY", "https://marine-aquatics.eu/p"],
      ["MARINE_AQUATICS", "https://marine-aquatics.eu.example/p"],
      ["MANUFACTURER", "https://www.bulkreefsupply.com/p"],
      ["SUPPLIER", "https://gyarto.example.invalid/p"],
    ] as const)
      assert.equal(sourceUrlProblem(kind, url, SITES), "HOST_NOT_ALLOWED", url);
  });

  it("csak https, hitelesítő adat és saját port nélkül, IP-cím nem", () => {
    assert.equal(
      sourceUrlProblem(
        "BULK_REEF_SUPPLY",
        "http://www.bulkreefsupply.com/p",
        SITES,
      ),
      "NOT_HTTPS",
    );
    assert.equal(
      sourceUrlProblem(
        "BULK_REEF_SUPPLY",
        "https://a:b@www.bulkreefsupply.com/p",
        SITES,
      ),
      "BAD_URL",
    );
    assert.equal(
      sourceUrlProblem(
        "BULK_REEF_SUPPLY",
        "https://www.bulkreefsupply.com:8443/p",
        SITES,
      ),
      "BAD_URL",
    );
    assert.equal(
      sourceUrlProblem("SUPPLIER", "https://10.0.0.1/p", SITES),
      "BAD_URL",
    );
    assert.equal(sourceUrlProblem("SUPPLIER", "nem url", SITES), "BAD_URL");
  });

  it("gyártói vagy beszállítói oldal csak ismert saját oldal mellett", () => {
    const none = { manufacturer: [], supplier: null };
    assert.equal(
      sourceUrlProblem(
        "MANUFACTURER",
        "https://gyarto.example.invalid/p",
        none,
      ),
      "NO_MANUFACTURER_SITE",
    );
    assert.equal(
      sourceUrlProblem(
        "SUPPLIER",
        "https://beszallito.example.invalid/p",
        none,
      ),
      "NO_SUPPLIER_SITE",
    );
    assert.equal(
      sourceUrlProblem(
        "MANUFACTURER",
        "https://www.gyarto.example.invalid/p",
        SITES,
      ),
      null,
    );
    assert.equal(
      sourceUrlProblem(
        "SUPPLIER",
        "https://beszallito.example.invalid/p",
        SITES,
      ),
      null,
    );
  });

  it("a gyártó oldala a márka weboldala és a UNAS link; kereskedőre mutató link nem az", () => {
    assert.deepEqual(
      manufacturerSites(
        "https://www.gyarto.example.invalid",
        "https://gyarto.example.invalid/x",
      ),
      ["gyarto.example.invalid"],
    );
    assert.deepEqual(
      manufacturerSites(null, "https://www.bulkreefsupply.com/p"),
      [],
    );
    assert.equal(
      baseDomainOf("gyarto.example.invalid"),
      "gyarto.example.invalid",
    );
    assert.equal(baseDomainOf("ftp://x.example.invalid"), null);
  });
});
