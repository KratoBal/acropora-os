import { describe, expect, it } from "vitest";

import { maintenanceAssigneePrefill } from "./worksheet-assignee-prefill";

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
    expect(result.selected).toEqual(["anna", "cili"]);
    expect(result.dropped).toEqual([{ userId: "bela", name: "BELA" }]);
  });

  it("hibajegynél semmi nem töltődik elő", () => {
    for (const kind of ["REPAIR", "", "maintenance"])
      expect(
        maintenanceAssigneePrefill({
          kind,
          jobAssignees: [assignee("anna")],
          candidates: kolleganak("anna"),
        }),
      ).toEqual({ selected: [], dropped: [] });
  });

  it("felelős nélküli lapnál nincs mit előtölteni", () => {
    expect(
      maintenanceAssigneePrefill({
        kind: "MAINTENANCE",
        jobAssignees: [],
        candidates: kolleganak("anna"),
      }),
    ).toEqual({ selected: [], dropped: [] });
  });

  it("egy kétszer szereplő felelős egyszer kerül a listára", () => {
    const result = maintenanceAssigneePrefill({
      kind: "MAINTENANCE",
      jobAssignees: [assignee("anna"), assignee("anna")],
      candidates: kolleganak("anna"),
    });
    expect(result.selected).toEqual(["anna"]);
  });

  it("ha senki nem kiosztható, mindenki a kimaradtak között van", () => {
    expect(
      maintenanceAssigneePrefill({
        kind: "MAINTENANCE",
        jobAssignees: [assignee("anna")],
        candidates: [],
      }),
    ).toEqual({ selected: [], dropped: [{ userId: "anna", name: "ANNA" }] });
  });
});
