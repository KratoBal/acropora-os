import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeTarget } from "./database-target.js";

/**
 * A CÉLZOTT ADATBÁZIS NEVE (a partner-átvezetés CLI és végpontjai, az összevonás előnézete). MI PIROSÍT: ha a jelszó vagy a
 * felhasználó kikerül a kimenetre; ha a host, a port vagy az adatbázis neve hiányzik; ha a hiányzó vagy értelmezhetetlen cím nem
 * mondja ki, hogy ismeretlen.
 */
describe("describeTarget", () => {
  it("names the host, the port and the database, and never the password", () => {
    assert.equal(
      describeTarget(
        "postgresql://user:geheim@db.example.hu:5433/acropora_stage?schema=public",
      ),
      "db.example.hu:5433/acropora_stage",
    );
    assert.equal(
      describeTarget("postgresql://u:p@localhost/acropora"),
      "localhost/acropora",
    );
    assert.doesNotMatch(
      describeTarget("postgresql://user:geheim@db/x"),
      /geheim|user/,
    );
    assert.match(describeTarget(undefined), /nincs DATABASE_URL/);
    assert.match(describeTarget("nem url"), /nem értelmezhető/);
  });
});
