import { describe, expect, it } from "vitest";

import { cancelledNote } from "./purchase-invoice-detail-page";

/**
 * 2408d6ad (acrobot 28406): a cancel withdraws the incoming invoice's
 * approval, and the image stays on the cancelled invoice. The page says so
 * only when there was an image.
 */
describe("cancelledNote", () => {
  it("CANCELLED-SCAN-NOTE: with an image it says to attach it again; without one it does not", () => {
    const base = { cancelReason: "rossz szállító" };
    expect(
      cancelledNote({
        ...base,
        scans: [
          {
            id: "scan-1",
            fileName: "szamla.pdf",
            sizeBytes: 9,
            createdAt: "2026-10-08T18:00:00.000Z",
          },
        ],
      }),
    ).toContain("ha újra rögzíted, ott is csatold");
    expect(cancelledNote({ ...base, scans: [] })).toBe(
      "rossz szállító. A készlete kiment, a száma újra rögzíthető.",
    );
  });
});
