import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maintenanceDoneFromDetail } from "./maintenance-state-from-detail";
import type { ServiceJobTimelineEntry } from "./types";

/*
  A MENTETT LISTASOR KÉSZSÉGE A RÉSZLETLAPBÓL (acrobot 56224: offline másolat). A részletlap írja a listasort, és a belső részletlap NEM küldi a `maintenanceDone` mezőt (csak a partner változata): enélkül egy megnyitott
  kész karbantartási lap ISMERETLEN készségű sorrá válna a másolatban. MI PIROSÍT: ha a hibajegy kap készséget; ha az összes munkalap aláírva nem kész; ha egy nem aláírt lap mellett kész; ha lap nélküli lap kész; ha az ismeretlen
  státuszú lap kitalált értéket ad a korábbi sor helyett; ha a korábbi érték elvész, amikor a részletlap nem tud újat adni.
*/
function sheet(
  id: string,
  status?: "DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED",
): ServiceJobTimelineEntry {
  return {
    kind: "worksheet",
    at: "2026-11-18T08:00:00.000Z",
    sortKey: id,
    worksheet: {
      id,
      number: null,
      subject: `Lap ${id}`,
      createdAt: "2026-11-18T08:00:00.000Z",
      handedOverAt: null,
      ...(status === undefined ? {} : { status }),
    },
  };
}

const statusRow: ServiceJobTimelineEntry = {
  kind: "status",
  at: "2026-11-18T08:00:00.000Z",
  sortKey: "s",
};

describe("a karbantartás készsége a részletlapból", () => {
  it("minden munkalap aláírva: kész", () => {
    assert.equal(
      maintenanceDoneFromDetail(
        {
          kind: "MAINTENANCE",
          timeline: [statusRow, sheet("a", "SIGNED"), sheet("b", "SIGNED")],
        },
        undefined,
      ),
      true,
    );
  });

  it("egy nem aláírt munkalap mellett folyamatban van", () => {
    for (const open of ["DRAFT", "AWAITING_SIGNATURE", "REJECTED"] as const)
      assert.equal(
        maintenanceDoneFromDetail(
          {
            kind: "MAINTENANCE",
            timeline: [sheet("a", "SIGNED"), sheet("b", open)],
          },
          true,
        ),
        false,
        open,
      );
  });

  it("munkalap nélkül nem kész", () => {
    assert.equal(
      maintenanceDoneFromDetail(
        { kind: "MAINTENANCE", timeline: [statusRow] },
        true,
      ),
      false,
    );
  });

  it("ha egy lap státusza nincs a részletlapon, a korábbi sor értéke marad, és ha az sincs, ismeretlen", () => {
    const timeline = [sheet("a", "SIGNED"), sheet("b")];
    assert.equal(
      maintenanceDoneFromDetail({ kind: "MAINTENANCE", timeline }, true),
      true,
    );
    assert.equal(
      maintenanceDoneFromDetail({ kind: "MAINTENANCE", timeline }, false),
      false,
    );
    assert.equal(
      maintenanceDoneFromDetail({ kind: "MAINTENANCE", timeline }, undefined),
      undefined,
    );
  });

  it("a hibajegynek nincs készsége, akkor sem, ha minden lapja aláírt", () => {
    assert.equal(
      maintenanceDoneFromDetail(
        { kind: "REPAIR", timeline: [sheet("a", "SIGNED")] },
        true,
      ),
      undefined,
    );
  });
});
