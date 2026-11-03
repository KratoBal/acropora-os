import { render, screen } from "@testing-library/react";
import { PilotSection } from "@acropora/ui";
import { describe, expect, it } from "vitest";

/*
  A KÁRTYA FEJLÉCE A SZÉLES GOMBSOR MIATT NEM NYOMHATJA ÖSSZE A CÍMET (UI-áttekintés, Single-page P1, 2026-11-03).
  A "Tételek" kártya két gombja (Termék hozzáadása, Egyedi tétel) 390 px-en nem fért a cím mellé, a cím
  a gombok alá csúszott. A fejléc most telefonon sorba tör (`max-md:flex-wrap`): a gombok a cím alá kerülnek, ha nem férnek mellé; asztalon a hosszú alcím a címblokkon belül tördelődik, a gomb marad a jobb felső sarokban (barracuda, #2057).
  A happy-dom nem számol elrendezést, ezért az állítás az osztályra szól; a tényleges nézetet a stage-fotó méri.
  MI PIROSÍT: ha a fejléc elveszti a `max-md:flex-wrap`-ot, vagy feltétel nélküli `flex-wrap`-ot kap (asztalon is a cím alá tenné a gombot), vagy a gombsor összenyomható lesz (`shrink-0` nélkül).
*/
describe("PilotSection header", () => {
  it("wraps its action under the title when they do not fit side by side", () => {
    render(
      <PilotSection
        title="Tételek"
        subtitle="Termék és egyedi tétel is hozzáadható."
        action={
          <div>
            <button type="button">Termék hozzáadása</button>
            <button type="button">Egyedi tétel</button>
          </div>
        }
      >
        <p>tartalom</p>
      </PilotSection>,
    );
    const header = screen
      .getByRole("heading", { name: "Tételek" })
      .closest("header")!;
    // Only on the phone: on a wide screen a long subtitle wraps inside the title block, the action stays at the top right.
    expect(header.classList.contains("max-md:flex-wrap")).toBe(true);
    expect(header.classList.contains("flex-wrap")).toBe(false);
    const action = screen.getByRole("button", { name: "Egyedi tétel" })
      .parentElement!.parentElement!;
    expect(action.classList.contains("shrink-0")).toBe(true);
  });

  it("keeps the title block shrinkable so a long title wraps inside its own column", () => {
    render(
      <PilotSection title="Egy nagyon hosszú kártyacím" action={<span />} />,
    );
    const titleBlock = screen.getByRole("heading").parentElement!;
    expect(titleBlock.classList.contains("min-w-0")).toBe(true);
  });
});
