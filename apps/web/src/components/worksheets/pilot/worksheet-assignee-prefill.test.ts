import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maintenanceAssigneePrefill } from "./worksheet-assignee-prefill.js";

/**
 * A KARBANTARTÁSI LAP FELELŐSEI AZ ÚJ MUNKALAPON (kártya d91005e9). MI PIROSÍT: hibajegynél is előtölt; egy kiosztható
 * felelős kimarad vagy egy nem kiosztható bekerül; a kimaradtak nem jönnek vissza névvel; a lap sorrendje elvész; egy
 * kétszer szereplő felelős kétszer kerül a listára.
 */
const assignee = (userId: string) => ({ userId, name: userId.toUpperCase() });
const kolleganak = (...ids: string[]) => ids.map((id) => ({ id }));

describe("maintenanceAssigneePrefill", () => {
  it("a kiosztható felelősök a lap sorrendjében, a többi a kimaradtak között, névvel", () => {
    const result = maintenanceAssigneePrefill({
      kind: "MAINTENANCE",
      jobAssignees: [assignee("anna"), assignee("bela"), assignee("cili")],
      candidates: kolleganak("cili", "anna", "dani"),
    });
    assert.deepEqual(result.selected, ["anna", "cili"]);
    assert.deepEqual(result.dropped, [{ userId: "bela", name: "BELA" }]);
  });

  it("hibajegynél semmi nem töltődik elő", () => {
    for (const kind of ["REPAIR", "", "maintenance"]) {
      assert.deepEqual(
        maintenanceAssigneePrefill({
          kind,
          jobAssignees: [assignee("anna")],
          candidates: kolleganak("anna"),
        }),
        { selected: [], dropped: [] },
      );
    }
  });

  it("felelős nélküli lapnál nincs mit előtölteni", () => {
    assert.deepEqual(
      maintenanceAssigneePrefill({
        kind: "MAINTENANCE",
        jobAssignees: [],
        candidates: kolleganak("anna"),
      }),
      {
        selected: [],
        dropped: [],
      },
    );
  });

  it("egy kétszer szereplő felelős egyszer kerül a listára", () => {
    const result = maintenanceAssigneePrefill({
      kind: "MAINTENANCE",
      jobAssignees: [assignee("anna"), assignee("anna")],
      candidates: kolleganak("anna"),
    });
    assert.deepEqual(result.selected, ["anna"]);
  });

  it("ha senki nem kiosztható, mindenki a kimaradtak között van", () => {
    const result = maintenanceAssigneePrefill({
      kind: "MAINTENANCE",
      jobAssignees: [assignee("anna")],
      candidates: [],
    });
    assert.deepEqual(result, {
      selected: [],
      dropped: [{ userId: "anna", name: "ANNA" }],
    });
  });
});
