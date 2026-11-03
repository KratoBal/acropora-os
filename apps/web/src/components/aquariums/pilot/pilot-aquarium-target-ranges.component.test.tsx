import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PilotAquariumTargetRanges } from "./pilot-aquarium-target-ranges";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/*
  A CÉLTARTOMÁNY SOROK MEZŐI EGY OSZLOPBAN ÁLLNAK (acrobot, stage e2264431, 1440 px): a "Magnézium (mg/l)" sorban a
  "Tól / Ig" mezők kb. 5 px-szel jobbra csúsztak, mert a címke hosszabb volt, és a flex sor a hosszabb címke miatt a
  mezőket is zsugorította. A mezők most nem zsugorodnak (`shrink-0`), a címke zsugorodhat (`min-w-0`): minden sorban a
  mezők ugyanott kezdődnek. A happy-dom nem számol elrendezést, az állítás az osztályokra szól.
  MI PIROSÍT: ha egy sor mezője újra zsugorodhat, vagy a címke nem zsugorodhat.
*/
describe("PilotAquariumTargetRanges rows", () => {
  it("keeps the Tól / Ig fields from shrinking, and lets the label shrink instead", () => {
    render(
      <PilotAquariumTargetRanges
        waterType="TENGERI"
        draft={{}}
        onChange={() => undefined}
      />,
    );
    const rows = screen
      .getAllByPlaceholderText("Tól")
      .map((input) => input.parentElement!);
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) {
      const inputs = row.querySelectorAll("input");
      expect(inputs).toHaveLength(2);
      for (const input of inputs) {
        expect(input.classList.contains("shrink-0")).toBe(true);
        expect(input.classList.contains("w-20")).toBe(true);
      }
      const label = row.querySelector("span.flex-1")!;
      expect(label.classList.contains("min-w-0")).toBe(true);
    }
  });
});
