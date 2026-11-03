import { render } from "@testing-library/react";
import { Select } from "@acropora/ui";
import { describe, expect, it } from "vitest";

/*
  A KÖZÖS <Select> SZÉLESSÉGE A BURKOLÓN ÁLL (2038, barracuda észrevétele). A `cn` sima összefűzés,
  nincs tailwind-merge, ezért a `w-full` és a hívó `w-48` osztálya egy elemen kettő lenne, és a
  nyertest a generált CSS sorrendje döntené. MI PIROSÍT: ha a burkoló `className` mellett is
  megtartja a `w-full`-t, vagy ha `className` nélkül elveszíti.
*/
describe("Select wrapper width", () => {
  it("is full width without a className", () => {
    const { container } = render(
      <Select aria-label="a">
        <option>x</option>
      </Select>,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.classList.contains("w-full")).toBe(true);
  });

  it("takes only the caller's width when one is given", () => {
    const { container } = render(
      <Select aria-label="a" className="w-48">
        <option>x</option>
      </Select>,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.classList.contains("w-48")).toBe(true);
    expect(wrapper.classList.contains("w-full")).toBe(false);
  });
});
