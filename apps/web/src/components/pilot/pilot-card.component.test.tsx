import { PilotCard } from "@acropora/ui";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

/*
  A `PilotCard` `aria-label` PROPJA (T1.3, a katalógus-műveletek panel; a dusk `Card`-on megvolt). MI PIROSÍT: ha a prop nem
  jut el a kártya elemére (a panel specje név szerint keresi), vagy ha a nélküle hívott kártya mégis kap `aria-label`
  attribútumot (a meglévő hívók DOM-ja nem változhat).
*/
afterEach(cleanup);

describe("PilotCard aria-label", () => {
  it("names the card element when given, and leaves the attribute off when not", () => {
    const { container, rerender } = render(
      <PilotCard aria-label="Katalógus-műveletek">tartalom</PilotCard>,
    );
    const named = screen.getByLabelText("Katalógus-műveletek");
    expect(named.textContent).toBe("tartalom");
    expect(named).toBe(container.firstElementChild);

    rerender(<PilotCard>tartalom</PilotCard>);
    expect(container.firstElementChild?.hasAttribute("aria-label")).toBe(false);
  });
});
