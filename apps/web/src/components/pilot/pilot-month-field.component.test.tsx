import { fireEvent, render, screen } from "@testing-library/react";
import { PilotMonthField } from "@acropora/ui";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/*
  A MAGYAR HÓNAPVÁLASZTÓ (UI-áttekintés, 3. csomag, 2026-11-03). A natív `type="month"` angolul írt
  ("August 2026"). MI PIROSÍT: ha a hónapok neve nem magyar vagy nem a tizenkettő; ha az `ÉÉÉÉ-HH` érték nem
  jelenik meg a két választón; ha egy félkész választás (csak év / csak hónap) értékként kimegy a hívónak;
  ha a félkész fél elvész a másik kiválasztása előtt; ha az évlistán kívüli érték nem választható.
*/
const NOW = new Date("2026-11-03T10:00:00Z");

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setValue("")}>
        Alaphelyzet
      </button>
      <PilotMonthField
        value={value}
        onChange={setValue}
        aria-label="Hónap"
        now={NOW}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const year = () => screen.getByLabelText("Hónap, év") as HTMLSelectElement;
const month = () => screen.getByLabelText("Hónap, hónap") as HTMLSelectElement;
const out = () => screen.getByTestId("value").textContent;

describe("PilotMonthField", () => {
  it("names the twelve months in Hungarian, and not in English", () => {
    render(<Harness />);
    const names = [...month().options].slice(1).map((o) => o.textContent);
    expect(names).toEqual([
      "január",
      "február",
      "március",
      "április",
      "május",
      "június",
      "július",
      "augusztus",
      "szeptember",
      "október",
      "november",
      "december",
    ]);
    expect(screen.queryByText(/August|November/)).toBeNull();
  });

  it("shows a YYYY-MM value on the two selects", () => {
    render(<Harness initial="2026-08" />);
    expect(year().value).toBe("2026");
    expect(month().value).toBe("08");
    expect(month().selectedOptions[0]!.textContent).toBe("augusztus");
  });

  it("hands the caller YYYY-MM when both are picked, and nothing for a half pick", () => {
    render(<Harness />);
    fireEvent.change(year(), { target: { value: "2026" } });
    expect(out()).toBe("");
    expect(year().value).toBe("2026");
    fireEvent.change(month(), { target: { value: "09" } });
    expect(out()).toBe("2026-09");
  });

  it("keeps the picked half when the other is chosen later, in either order", () => {
    render(<Harness />);
    fireEvent.change(month(), { target: { value: "03" } });
    expect(out()).toBe("");
    expect(month().value).toBe("03");
    fireEvent.change(year(), { target: { value: "2025" } });
    expect(out()).toBe("2025-03");
  });

  it("changing one half of a full value keeps the other", () => {
    render(<Harness initial="2026-08" />);
    fireEvent.change(month(), { target: { value: "11" } });
    expect(out()).toBe("2026-11");
    fireEvent.change(year(), { target: { value: "2024" } });
    expect(out()).toBe("2024-11");
  });

  it("shows empty selects when the caller resets the value from outside after a full pick", () => {
    render(<Harness />);
    fireEvent.change(year(), { target: { value: "2026" } });
    fireEvent.change(month(), { target: { value: "07" } });
    expect(out()).toBe("2026-07");

    fireEvent.click(screen.getByRole("button", { name: "Alaphelyzet" }));
    expect(out()).toBe("");
    expect(year().value).toBe("");
    expect(month().value).toBe("");
  });

  it("offers a year outside the usual range when the value has one", () => {
    render(<Harness initial="2012-05" />);
    expect(year().value).toBe("2012");
    expect([...year().options].map((o) => o.value)).toContain("2012");
  });
});
