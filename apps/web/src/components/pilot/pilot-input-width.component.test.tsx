import { render } from "@testing-library/react";
import { PilotInput, splitWidthClasses } from "@acropora/ui";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/*
  A HÍVÓ SZÉLESSÉGE FELÜLÍRJA AZ ALAP `w-full`-T (UI-áttekintés, 2026-11-03; acrobot: a céltartományok "Tól / Ig" mezői
  soronként más szélességűek, a dátumszűrők teljes szélességűek). A beviteli mező `w-full`-t viselt, és a hívó `w-20` /
  `w-[150px]` osztálya ugyanarra az elemre került: a kettő közül a CSS sorrendje döntött. MI PIROSÍT: ha a mező `w-full`-t visel
  a hívó szélességével együtt; ha az alap `w-full` hiányozna szélesség nélkül; ha a dátummező burkolója nem a hívó szélességét
  kapja (a burkoló is `w-full` volt, ezért a mező egy flex sorban teljes szélességű maradt).
*/
describe("splitWidthClasses", () => {
  it("takes the width classes, with variants, and leaves min/max widths and the rest", () => {
    expect(splitWidthClasses("w-20 text-right text-xs")).toEqual({
      width: "w-20",
      rest: "text-right text-xs",
    });
    expect(splitWidthClasses("h-10 w-[150px] md:w-40")).toEqual({
      width: "w-[150px] md:w-40",
      rest: "h-10",
    });
    expect(splitWidthClasses("min-w-[220px] max-w-md flex-1")).toEqual({
      width: "",
      rest: "min-w-[220px] max-w-md flex-1",
    });
    expect(splitWidthClasses(undefined)).toEqual({ width: "", rest: "" });
  });
});

describe("PilotInput width", () => {
  it("fills its container by default", () => {
    const { container } = render(<PilotInput value="" aria-label="a" />);
    expect(container.querySelector("input")!.classList.contains("w-full")).toBe(
      true,
    );
  });

  it("takes the caller's width instead of w-full", () => {
    const { container } = render(
      <PilotInput value="" aria-label="a" className="w-20 text-right" />,
    );
    const input = container.querySelector("input")!;
    expect(input.classList.contains("w-20")).toBe(true);
    expect(input.classList.contains("w-full")).toBe(false);
    expect(input.classList.contains("text-right")).toBe(true);
  });

  it("keeps w-full next to a min-width class (no width conflict there)", () => {
    const { container } = render(
      <PilotInput value="" aria-label="a" className="min-w-[220px] flex-1" />,
    );
    expect(container.querySelector("input")!.classList.contains("w-full")).toBe(
      true,
    );
  });

  it("gives a date field's wrapper the caller's width and lets the input fill the wrapper", () => {
    const { container } = render(
      <PilotInput
        type="date"
        value=""
        aria-label="d"
        className="h-10 w-[150px]"
      />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.classList.contains("w-[150px]")).toBe(true);
    expect(wrapper.classList.contains("w-full")).toBe(false);
    const input = container.querySelector("input")!;
    expect(input.classList.contains("w-[150px]")).toBe(false);
    expect(input.classList.contains("h-10")).toBe(true);
  });
});
