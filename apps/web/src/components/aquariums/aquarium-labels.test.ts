import { describe, expect, it } from "vitest";

import { ownershipLabel } from "./aquarium-labels";

/** acrobot 33818: the list and the detail page badge a shared ReefClub aquarium. */
describe("ownershipLabel", () => {
  it("a shared ReefClub aquarium is a ReefClub akvárium, whatever its ownership type", () => {
    expect(
      ownershipLabel({
        ownershipType: "CUSTOMER",
        reefClubSharedAt: "2026-10-20T18:29:05.000Z",
      }),
    ).toBe("ReefClub akvárium");
  });

  it("without the mark the ownership type decides, as before", () => {
    expect(ownershipLabel({ ownershipType: "CUSTOMER" })).toBe("Ügyfél");
    expect(ownershipLabel({ ownershipType: "OWN" })).toBe("Saját");
  });
});
