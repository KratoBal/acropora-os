import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { aquariumAlertsWidget } from "./aquarium-alerts-widget";
import { aquariumEquipmentWidget } from "./aquarium-equipment-widget";
import { waterValuesWidget } from "./water-values-widget";

describe("az akvárium-widgetek", () => {
  it("a figyelmeztetés a paramétert, az akváriumot és a mért értéket írja ki, a régi mérést külön", () => {
    const { Body } = aquariumAlertsWidget;
    render(
      <Body
        data={{
          checked: 3,
          outOfRangeCount: 1,
          staleCount: 2,
          staleAfterDays: 14,
          items: [
            {
              aquariumId: "a1",
              aquariumName: "Kitalált Reef 450",
              parameterCode: "FOSZFAT",
              value: 0.18,
              min: 0,
              max: 0.1,
              measuredAt: "2026-09-30T08:00:00Z",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/· Kitalált Reef 450/)).toBeTruthy();
    expect(screen.getByText("0,18")).toBeTruthy();
    expect(screen.getByText("Nincs friss mérés (14 napon belül)")).toBeTruthy();
  });

  it("csak akkor üres, ha nincs eltérés és régi mérés sem", () => {
    const base = {
      checked: 2,
      outOfRangeCount: 0,
      staleCount: 0,
      staleAfterDays: 14,
      items: [],
    };
    expect(aquariumAlertsWidget.emptyMessage(base)).toBe(
      "Minden friss mérés céltartományon belül van.",
    );
    expect(
      aquariumAlertsWidget.emptyMessage({ ...base, staleCount: 1 }),
    ).toBeNull();
    expect(aquariumAlertsWidget.emptyMessage({ ...base, checked: 0 })).toBe(
      "Nincs látható akvárium.",
    );
  });

  it("a vízértékek arányát a cél nélküli mérés nem javítja fel", () => {
    const { Body } = waterValuesWidget;
    render(
      <Body
        data={{
          aquariumCount: 3,
          freshCount: 3,
          staleAfterDays: 14,
          parameters: [
            {
              code: "KH",
              inRange: 1,
              outOfRange: 1,
              noTarget: 1,
              notMeasured: 0,
            },
            {
              code: "FOSZFAT",
              inRange: 0,
              outOfRange: 0,
              noTarget: 3,
              notMeasured: 0,
            },
            {
              code: "NITRAT",
              inRange: 2,
              outOfRange: 0,
              noTarget: 0,
              notMeasured: 1,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("1/2")).toBeTruthy(); // KH: the target-less one is not in the ratio
    expect(screen.getByText("nincs adat")).toBeTruthy(); // PO4: no target anywhere
    expect(screen.getByText("2/2")).toBeTruthy();
  });

  it("az eszköz-karbantartás a lejártat külön mutatja", () => {
    const { Body } = aquariumEquipmentWidget;
    render(
      <Body
        data={{
          windowDays: 14,
          overdue: 1,
          dueSoon: 2,
          soonest: [
            {
              assetId: "e1",
              assetName: "Kitalált szivattyú",
              aquariumName: "Minta Nano",
              nextServiceAt: "2026-10-07",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Lejárt")).toBeTruthy();
    expect(screen.getByText("esedékes 14 napon belül")).toBeTruthy();
    expect(screen.getByText(/okt\. 7\./)).toBeTruthy();
  });
});
