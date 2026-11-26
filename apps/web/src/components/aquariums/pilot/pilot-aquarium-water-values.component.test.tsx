import { render, screen } from "@testing-library/react";
import type { AquariumMeasurementOccasion } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotAquariumWaterValues } from "./pilot-aquarium-water-values";

/*
  AZ AKVÁRIUM VÍZÉRTÉKEINEK GÖRBÉJE (picasso képernyő-leltár, P6; ugyanaz a kód a partner portálon): egy mérésnél eddig üres hely
  állt (a görbe két ponttól rajzolódik), állandó értéknél pedig a vonal a doboz alján, a kitöltés szélén futott, és üres sávnak
  látszott. MI PIROSÍT: egy mérésnél nincs mondat; állandó értéknél a vonal nem középen áll; változó értéknél nem a teljes magasságot
  járja be.
*/
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
const api = vi.hoisted(() => ({ listMeasurements: vi.fn() }));
vi.mock("@/lib/api/aquariums", () => ({ aquariumsApi: api }));

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const occasion = (
  id: string,
  days: number,
  value: number,
): AquariumMeasurementOccasion =>
  ({
    id,
    measuredAt: daysAgo(days),
    values: [{ parameterCode: "HOMERSEKLET", value }],
  }) as AquariumMeasurementOccasion;

const draw = async (occasions: AquariumMeasurementOccasion[]) => {
  api.listMeasurements.mockResolvedValue({ occasions });
  const view = render(
    <PilotAquariumWaterValues
      token="t1"
      aquariumId="aq-1"
      canSendEmail={false}
    />,
  );
  return view;
};
const ys = (container: HTMLElement) =>
  (container.querySelector("polyline")?.getAttribute("points") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((pair) => Number(pair.split(",")[1]));

beforeEach(() => api.listMeasurements.mockReset());

describe("PilotAquariumWaterValues görbéje", () => {
  it("egy mérésnél kimondja, hogy még nincs görbe", async () => {
    const { container } = await draw([occasion("o1", 1, 25)]);
    expect(
      await screen.findByText(
        "Egy mérésből még nincs görbe, a második után jelenik meg.",
      ),
    ).toBeTruthy();
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("állandó értéknél a vonal középen áll, nem a doboz alján", async () => {
    const { container } = await draw([
      occasion("o2", 1, 25),
      occasion("o1", 5, 25),
    ]);
    await screen.findByText(/elmúlt 90 nap/);
    expect(ys(container)).toEqual([32, 32]);
  });

  it("változó értéknél a teljes magasságot bejárja", async () => {
    const { container } = await draw([
      occasion("o2", 1, 26),
      occasion("o1", 5, 24),
    ]);
    await screen.findByText(/elmúlt 90 nap/);
    expect(ys(container)).toEqual([64, 0]);
  });
});
