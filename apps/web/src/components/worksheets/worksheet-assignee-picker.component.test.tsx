import { fireEvent, render, screen, within } from "@testing-library/react";
import type { WorksheetAssignableUser } from "@acropora/types";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import {
  NOT_SELECTABLE_NAME,
  toggleAssignee,
  WorksheetAssigneePicker,
} from "./worksheet-assignee-picker";

/**
 * A FELELŐS-VÁLASZTÓ: KERESŐS TÖBBES VÁLASZTÓ (picasso R5, Balázs D4, card b2e74712). Eddig kilenc jelölőnégyzet egymás alatt, szűrés nélkül.
 * MI PIROSÍT: ha a keresés nem szűri a listát, vagy ékezet- és kisbetű-függő ("szabo" nem találja a "Szabó"-t); ha a kiválasztott nem jelenik
 * meg levehető címkeként (és a levétel nem a hívó állapotát váltja); ha a szűrő elrejti a kiválasztott jelölést; ha egy már kiosztott, de a
 * listán nem szereplő (gépi) fiók a nyers azonosítóval jelenik meg; ha a keresés alatt nincs "Nincs találat".
 */
const PEOPLE: WorksheetAssignableUser[] = [
  { id: "u1", name: "Szabó Gábor", role: "SERVICE" },
  { id: "u2", name: "Kelecsényi Ferenc", role: "SERVICE" },
  { id: "u3", name: "Ág Luca", role: "MANAGER" },
  { id: "u4", name: "Andrási Dávid", role: "SERVICE" },
];

function Harness({
  initial = [],
  knownNames,
}: {
  initial?: string[];
  knownNames?: Record<string, string>;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <>
      <WorksheetAssigneePicker
        candidates={PEOPLE}
        selected={selected}
        onToggle={(id) => setSelected((current) => toggleAssignee(current, id))}
        knownNames={knownNames}
      />
      <output data-testid="state">{selected.join(",")}</output>
    </>
  );
}

const state = () => screen.getByTestId("state").textContent;
const list = () => screen.getByRole("group", { name: "Felelős" });

describe("WorksheetAssigneePicker (keresős többes választó)", () => {
  it("a keresés a listát szűri, ékezet- és kisbetű-függetlenül", () => {
    render(<Harness />);
    expect(within(list()).getAllByRole("checkbox")).toHaveLength(4);
    fireEvent.change(screen.getByLabelText("Felelős keresése"), {
      target: { value: "szabo" },
    });
    expect(
      within(list())
        .getAllByRole("checkbox")
        .map((box) => (box as HTMLInputElement).closest("label")?.textContent),
    ).toEqual(["Szabó Gábor"]);
    fireEvent.change(screen.getByLabelText("Felelős keresése"), {
      target: { value: "AG LUCA" },
    });
    expect(within(list()).getAllByRole("checkbox")).toHaveLength(1);
  });

  it("találat nélkül kimondja, hogy nincs találat, és a lista nem marad üres doboz", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Felelős keresése"), {
      target: { value: "nincsilyen" },
    });
    expect(within(list()).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(list()).getByText("Nincs találat.")).toBeTruthy();
  });

  it("a kiválasztott levehető címkeként látszik, és a levétel a hívó állapotát váltja", () => {
    render(<Harness initial={["u1", "u3"]} />);
    const chips = screen.getByRole("list", { name: "Kiválasztott felelősök" });
    expect(within(chips).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(
      within(chips).getByRole("button", { name: "Szabó Gábor eltávolítása" }),
    );
    expect(state()).toBe("u3");
    expect(
      screen.queryByRole("button", { name: "Szabó Gábor eltávolítása" }),
    ).toBeNull();
  });

  it("a keresés alatt is látszik, ki van kiválasztva, és a jelölőnégyzet váltja az állapotot", () => {
    render(<Harness initial={["u2"]} />);
    fireEvent.change(screen.getByLabelText("Felelős keresése"), {
      target: { value: "kelecs" },
    });
    const box = within(list()).getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(state()).toBe("");
    fireEvent.click(box);
    expect(state()).toBe("u2");
  });

  it("a listán nem szereplő, már kiosztott fiók a nevét mutatja, nem a nyers azonosítót; név nélkül SEMLEGES szöveget (nem 'gépi': lehet inaktivált ember is)", () => {
    const first = render(
      <Harness initial={["bot-1"]} knownNames={{ "bot-1": "Acro Bot" }} />,
    );
    expect(
      screen.getByRole("button", { name: "Acro Bot eltávolítása" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "Kiválasztott felelősök" }).textContent,
    ).not.toContain("bot-1");
    first.unmount();
    render(<Harness initial={["bot-2"]} />);
    expect(
      screen.getByRole("button", { name: "Nem választható fiók eltávolítása" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "Kiválasztott felelősök" }).textContent,
    ).not.toContain("bot-2");
  });

  it("a fallback label is neutral: it does not call an unknown account a machine", () => {
    expect(NOT_SELECTABLE_NAME).toBe("Nem választható fiók");
    expect(NOT_SELECTABLE_NAME.toLowerCase()).not.toContain("gép");
  });

  // barracuda a #2892-n: ha a választót egyszer űrlapba teszik, az Enter a keresőben ne indítsa el csendben a felvitelt
  it("Enter a keresőben nem küld be űrlapot", () => {
    let submitted = false;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <Harness />
        <button type="submit">Mentés</button>
      </form>,
    );
    const box = screen.getByLabelText("Felelős keresése");
    const notPrevented = fireEvent.keyDown(box, { key: "Enter" });
    // fireEvent returns false when the event's default was prevented
    expect(notPrevented).toBe(false);
    expect(submitted).toBe(false);
    // another key is not swallowed
    expect(fireEvent.keyDown(box, { key: "a" })).toBe(true);
  });
});
