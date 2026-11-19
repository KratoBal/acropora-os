import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import {
  worksheetUnitAllowed,
  worksheetUnitWhere,
} from "./worksheet-unit-scope.js";
import { WorksheetsRepository } from "./worksheets.repository.js";

/*
  A MUNKALAP EGYSÉG-HATÓKÖRE (kártya 5f4af2aa). MI PIROSÍT: egy egységre korlátozott partner a vevő MÁS egységének
  lapját azonosító alapján megkapja (a részletes nézet, a PDF és a többes letöltés mind a `detail`-on át olvas); a saját
  egységének lapja nem jön; az üres egység-halmaz mindent enged; a felhasználó nélküli vevő-hatókör enged; a belsős vagy a
  szállító szűkül; a lista és a sor két külön szabályt követ.
*/
const CUSTOMER: PartnerScope = {
  kind: "customer",
  customerId: "cust-1",
  userId: "partner-1",
};
const INTERNAL: PartnerScope = { kind: "internal" };

describe("worksheetUnitWhere / worksheetUnitAllowed: one rule", () => {
  it("a customer sees only its assigned units, an empty set means nothing", () => {
    assert.deepEqual(worksheetUnitWhere(CUSTOMER, ["unit-a"]), {
      departmentId: { in: ["unit-a"] },
    });
    assert.deepEqual(worksheetUnitWhere(CUSTOMER, []), {
      departmentId: { in: [] },
    });
    assert.equal(worksheetUnitAllowed("unit-a", CUSTOMER, ["unit-a"]), true);
    assert.equal(worksheetUnitAllowed("unit-b", CUSTOMER, ["unit-a"]), false);
    assert.equal(worksheetUnitAllowed("unit-a", CUSTOMER, []), false);
  });

  it("internal and supplier scopes are not narrowed by units", () => {
    for (const scope of [
      INTERNAL,
      { kind: "supplier", supplierId: "sup-1" } as PartnerScope,
    ]) {
      assert.deepEqual(worksheetUnitWhere(scope, []), {});
      assert.equal(worksheetUnitAllowed("unit-b", scope, []), true);
    }
  });
});

describe("WorksheetsRepository.detail: the gate every partner read passes", () => {
  /** The repository with the row and the assigned units given, no database. */
  const repository = (unitOfSheet: string, assigned: string[]) => {
    const repo = new WorksheetsRepository();
    const asked: string[] = [];
    Object.assign(repo, {
      detailRow: async () => ({
        id: "ws-1",
        customerId: "cust-1",
        department: { id: unitOfSheet },
      }),
      assignedUnitIds: async (userId: string) => {
        asked.push(userId);
        return assigned;
      },
    });
    return { repo, asked };
  };

  it("another unit's sheet of the same customer is not found; the own unit's is", async () => {
    const other = repository("unit-b", ["unit-a"]);
    assert.equal(await other.repo.detail("ws-1", CUSTOMER), null);
    assert.deepEqual(other.asked, ["partner-1"]);
    const own = repository("unit-a", ["unit-a"]);
    assert.equal((await own.repo.detail("ws-1", CUSTOMER))?.id, "ws-1");
  });

  it("a customer scope without a user closes, an internal one is not asked about units", async () => {
    const noUser = repository("unit-a", ["unit-a"]);
    assert.equal(
      await noUser.repo.detail("ws-1", {
        kind: "customer",
        customerId: "cust-1",
      }),
      null,
    );
    const internal = repository("unit-b", []);
    assert.equal((await internal.repo.detail("ws-1", INTERNAL))?.id, "ws-1");
    assert.deepEqual(internal.asked, []);
  });

  it("another customer's sheet stays not found, before any unit is read", async () => {
    const foreign = repository("unit-a", ["unit-a"]);
    assert.equal(
      await foreign.repo.detail("ws-1", {
        kind: "customer",
        customerId: "cust-2",
        userId: "partner-1",
      }),
      null,
    );
    assert.deepEqual(foreign.asked, []);
  });
});
