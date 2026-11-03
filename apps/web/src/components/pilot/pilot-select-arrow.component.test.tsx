import { render } from "@testing-library/react";
import { PilotSelect } from "@acropora/ui";
import { describe, expect, it } from "vitest";

/*
  A PILOT-VÁLASZTÓ ALAPBÓL NYÍLLAL RAJZOL (UI-áttekintés, 2026-11-03, acrobot 168b7cc9 fotója): a `appearance-none` elrejti a
  böngésző nyilát, és a `chevron` nélküli hívók (55 hívás, 21 fájl: köztük az új eszköz űrlap Kategória, Funkció, Bekötés,
  Kritikusság, Típus, Státusz választói) nyíl nélkül, beviteli mezőnek látszottak. Most a nyíl az alap; a régi nyilas alak
  (`chevron` kifejezetten igaz) és a nyíl nélküli (`chevron={false}`) megmarad.
  MI PIROSÍT: ha az alap megint nyíl nélküli; ha a `false` is nyilat kap; ha az alap alak nem tölti ki a szélességet (a régi
  nyíl nélküli hívók szélessége); ha a kifejezetten `true` alak szélességet kap (a hívó méretezi).
*/
const options = (
  <>
    <option value="">Válassz</option>
    <option value="a">A</option>
  </>
);

describe("PilotSelect arrow", () => {
  it("draws the arrow by default and fills the width like the old arrowless form", () => {
    const { container } = render(
      <PilotSelect aria-label="x" value="" onChange={() => undefined}>
        {options}
      </PilotSelect>,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    const wrapper = container.firstElementChild!;
    expect(wrapper.classList.contains("w-full")).toBe(true);
    expect(wrapper.querySelector("select")!.className).toContain("pr-9");
  });

  it("draws no arrow when asked not to", () => {
    const { container } = render(
      <PilotSelect
        aria-label="x"
        value=""
        chevron={false}
        onChange={() => undefined}
      >
        {options}
      </PilotSelect>,
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(container.firstElementChild!.tagName).toBe("SELECT");
  });

  it("keeps the explicit arrow form unsized, so the caller sizes it", () => {
    const { container } = render(
      <PilotSelect aria-label="x" value="" chevron onChange={() => undefined}>
        {options}
      </PilotSelect>,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.firstElementChild!.classList.contains("w-full")).toBe(
      false,
    );
  });

  it("lets a caller's class replace the default width on the wrapper", () => {
    const { container } = render(
      <PilotSelect
        aria-label="x"
        value=""
        className="w-40"
        onChange={() => undefined}
      >
        {options}
      </PilotSelect>,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.classList.contains("w-40")).toBe(true);
    expect(wrapper.classList.contains("w-full")).toBe(false);
  });
});
