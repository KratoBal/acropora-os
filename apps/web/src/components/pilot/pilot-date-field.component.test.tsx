import { PilotDateField, PilotInput } from "@acropora/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => cleanup());

/*
  A MAGYAR DÁTUMMEZŐ (UI-áttekintés, 3. csomag, 2026-11-03). MI PIROSÍT: ha a mező
  a böngésző nyelvén ír (`mm/dd/yyyy`) a magyar alak helyett; ha a hívó nem ISO
  értéket kap; ha egy félig beírt vagy nem létező dátum dátumként megy ki; ha a
  `max` felett is elfogad; ha a kívülről érkező érték nem írja át a szöveget; ha a
  naptár-gomb olvasásra szánt mezőn is ott van; ha a `PilotInput type="date"` még
  a natív mezőt rajzolja.
*/
function Tarolo({ kezdet = "", max }: { kezdet?: string; max?: string }) {
  const [ertek, setErtek] = useState(kezdet);
  return (
    <>
      <PilotDateField
        aria-label="Nap"
        value={ertek}
        onChange={setErtek}
        max={max}
      />
      <output data-testid="ertek">{ertek}</output>
      <button type="button" onClick={() => setErtek("2030-01-31")}>
        kívülről
      </button>
    </>
  );
}
const mezo = () => screen.getByLabelText("Nap") as HTMLInputElement;
const gepel = (szoveg: string) =>
  fireEvent.change(mezo(), { target: { value: szoveg } });
const ertek = () => screen.getByTestId("ertek").textContent;

describe("a magyar dátummező", () => {
  it("az ISO értéket magyar alakban mutatja", () => {
    render(<Tarolo kezdet="2026-11-03" />);
    expect(mezo().value).toBe("2026. 11. 03.");
    expect(mezo().type).toBe("text");
  });

  it("gépelés közben formáz, és a teljes dátumot ISO-ként adja ki", () => {
    render(<Tarolo />);
    gepel("20261");
    expect(mezo().value).toBe("2026. 1");
    expect(ertek()).toBe("");
    gepel("20261103");
    expect(mezo().value).toBe("2026. 11. 03.");
    expect(ertek()).toBe("2026-11-03");
  });

  it("a beillesztett ISO és pontos alak ugyanazt adja", () => {
    render(<Tarolo />);
    gepel("2026-11-03");
    expect(ertek()).toBe("2026-11-03");
    gepel("2027.01.15");
    expect(ertek()).toBe("2027-01-15");
  });

  it("a nem létező nap üres értéket ad, és jelzi a hibát", () => {
    render(<Tarolo kezdet="2026-11-03" />);
    gepel("20260230");
    expect(ertek()).toBe("");
    expect(mezo().getAttribute("aria-invalid")).toBe("true");
    gepel("20260228");
    expect(ertek()).toBe("2026-02-28");
    expect(mezo().hasAttribute("aria-invalid")).toBe(false);
  });

  it("a max feletti létező nap kimegy a hívónak (az írja rá a saját üzenetét), de a mező jelölt", () => {
    render(<Tarolo max="2026-11-03" />);
    gepel("20261104");
    expect(ertek()).toBe("2026-11-04");
    expect(mezo().getAttribute("aria-invalid")).toBe("true");
    gepel("20261103");
    expect(ertek()).toBe("2026-11-03");
    expect(mezo().hasAttribute("aria-invalid")).toBe(false);
  });

  it("a max feletti szöveg a mezőben marad, akkor is, ha a hívó értéke vált", () => {
    render(<Tarolo kezdet="2026-11-03" max="2026-11-03" />);
    gepel("20261104");
    expect(mezo().value).toBe("2026. 11. 04.");
    expect(mezo().getAttribute("aria-invalid")).toBe("true");
  });

  it("a kiürített mező üres értéket ad", () => {
    render(<Tarolo kezdet="2026-11-03" />);
    gepel("");
    expect(ertek()).toBe("");
    expect(mezo().value).toBe("");
  });

  it("a kívülről érkező érték átírja a szöveget", () => {
    render(<Tarolo />);
    fireEvent.click(screen.getByText("kívülről"));
    expect(mezo().value).toBe("2030. 01. 31.");
  });

  it("a naptár egy rejtett natív mező, aminek a választása a szöveget is átírja", () => {
    const { container } = render(<Tarolo />);
    const natív = container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    expect(natív.getAttribute("aria-hidden")).toBe("true");
    const megnyit = vi.fn();
    natív.showPicker = megnyit;
    fireEvent.click(screen.getByRole("button", { name: "Naptár megnyitása" }));
    expect(megnyit).toHaveBeenCalledTimes(1);
    fireEvent.change(natív, { target: { value: "2026-12-24" } });
    expect(mezo().value).toBe("2026. 12. 24.");
    expect(ertek()).toBe("2026-12-24");
  });

  it("showPicker nélkül (vagy ha megtagadja) a fókusz a szöveges mezőben marad", () => {
    const { container } = render(<Tarolo />);
    const natív = container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    natív.showPicker = undefined as never;
    fireEvent.click(screen.getByRole("button", { name: "Naptár megnyitása" }));
    expect(document.activeElement).toBe(mezo());
    cleanup();

    const { container: masik } = render(<Tarolo />);
    const natív2 = masik.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    natív2.showPicker = () => {
      throw new DOMException("megtagadva", "NotAllowedError");
    };
    fireEvent.click(screen.getByRole("button", { name: "Naptár megnyitása" }));
    expect(document.activeElement).toBe(mezo());
  });

  it("olvasásra szánt vagy tiltott mezőn nincs naptár-gomb", () => {
    const { rerender } = render(
      <PilotDateField aria-label="Nap" value="2026-11-03" readOnly />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<PilotDateField aria-label="Nap" value="2026-11-03" disabled />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a PilotInput type=date a magyar mezőt rajzolja, a többi típus a régit", () => {
    const { container } = render(
      <>
        <PilotInput aria-label="Nap" type="date" value="2026-11-03" />
        <PilotInput aria-label="Szám" type="number" value="5" />
      </>,
    );
    expect((screen.getByLabelText("Nap") as HTMLInputElement).value).toBe(
      "2026. 11. 03.",
    );
    expect((screen.getByLabelText("Szám") as HTMLInputElement).type).toBe(
      "number",
    );
    expect(container.querySelectorAll('input[type="date"]').length).toBe(1);
  });
});
