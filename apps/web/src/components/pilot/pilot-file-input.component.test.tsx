import { PilotFileInput } from "@acropora/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => cleanup());

/*
  A MAGYAR FÁJLMEZŐ (UI-áttekintés, 3. csomag, 2026-11-03). MI PIROSÍT: ha a mező a
  böngésző nyelvén ír ("Choose File", "No file chosen") a magyar felirat helyett; ha a
  gomb nem a rejtett valódi mezőt nyitja; ha a hívó nem kapja meg a natív változás-
  eseményt (`event.target.files`); ha a már feltöltött (a hívó által kiürített) fájl
  neve ott marad; ha a rejtett mező a tab-sorban marad a gomb mellett; ha a gomb neve
  nem a mező feliratát viseli; ha a tiltott mezőn a gomb élő.
*/
const fajl = (nev: string) => new File(["x"], nev, { type: "text/plain" });
/** A natív mező viselkedése: a `files` üres, ha a `value` ki van ürítve (a böngészőben is így van). */
const valaszt = (mezo: HTMLInputElement, nevek: string[]) => {
  let ertek = `C:\\fakepath\\${nevek[0]}`;
  Object.defineProperty(mezo, "value", {
    configurable: true,
    get: () => ertek,
    set: (v: string) => {
      ertek = v;
    },
  });
  Object.defineProperty(mezo, "files", {
    configurable: true,
    get: () => (ertek === "" ? [] : nevek.map(fajl)),
  });
  fireEvent.change(mezo);
};

describe("a magyar fájlmező", () => {
  it("magyar feliratot ír, és a valódi mező rejtett és kimarad a tab-sorból", () => {
    render(<PilotFileInput aria-label="Számla PDF" />);
    expect(screen.getByText("Fájl kiválasztása")).toBeTruthy();
    expect(screen.getByText("Nincs kiválasztott fájl")).toBeTruthy();
    const mezo = screen.getByLabelText("Számla PDF") as HTMLInputElement;
    expect(mezo.type).toBe("file");
    expect(mezo.className).toContain("sr-only");
    expect(mezo.tabIndex).toBe(-1);
  });

  it("a gomb neve a mező feliratát viseli, és a valódi mezőt nyitja", () => {
    render(<PilotFileInput aria-label="Számla PDF" />);
    const mezo = screen.getByLabelText("Számla PDF") as HTMLInputElement;
    const nyit = vi.spyOn(mezo, "click");
    fireEvent.click(
      screen.getByRole("button", { name: "Számla PDF: fájl kiválasztása" }),
    );
    expect(nyit).toHaveBeenCalledTimes(1);
  });

  it("több fájlnál többes számú gomb, a név és a darabszám kiírva", () => {
    render(<PilotFileInput aria-label="Fotók" multiple />);
    expect(screen.getByText("Fájlok kiválasztása")).toBeTruthy();
    const mezo = screen.getByLabelText("Fotók") as HTMLInputElement;
    valaszt(mezo, ["a.jpg", "b.jpg"]);
    expect(screen.getByText("a.jpg, b.jpg")).toBeTruthy();
    valaszt(mezo, ["a.jpg", "b.jpg", "c.jpg"]);
    expect(screen.getByText("3 fájl")).toBeTruthy();
  });

  it("a hívó megkapja a natív eseményt, a kiválasztott fájllal", () => {
    const onChange = vi.fn(
      (event: { target: HTMLInputElement }) => event.target.files?.[0]?.name,
    );
    render(<PilotFileInput aria-label="Számla PDF" onChange={onChange} />);
    valaszt(screen.getByLabelText("Számla PDF") as HTMLInputElement, [
      "szamla.pdf",
    ]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.results[0]!.value).toBe("szamla.pdf");
    expect(screen.getByText("szamla.pdf")).toBeTruthy();
  });

  it("a hívó által kiürített (feltöltött) fájl neve nem marad ott", () => {
    render(
      <PilotFileInput
        aria-label="Számla PDF"
        onChange={(event) => {
          // A hívók a fogyasztott fájl után így ürítik a mezőt.
          event.target.value = "";
        }}
      />,
    );
    valaszt(screen.getByLabelText("Számla PDF") as HTMLInputElement, [
      "szamla.pdf",
    ]);
    expect(screen.queryByText("szamla.pdf")).toBeNull();
    expect(screen.getByText("Nincs kiválasztott fájl")).toBeTruthy();
  });

  it("a ref a valódi mezőt adja, és a programmal (eseménytelenül) kiürített mező neve is eltűnik", () => {
    const ref = createRef<HTMLInputElement>();
    const { rerender } = render(
      <PilotFileInput aria-label="Leltár" ref={ref} />,
    );
    expect(ref.current).toBe(screen.getByLabelText("Leltár"));
    valaszt(ref.current!, ["leltar.xlsx"]);
    expect(screen.getByText("leltar.xlsx")).toBeTruthy();
    // A hívó (a feltöltés után) ref-en át ürít, és újrarenderel.
    ref.current!.value = "";
    rerender(<PilotFileInput aria-label="Leltár" ref={ref} />);
    expect(screen.queryByText("leltar.xlsx")).toBeNull();
    expect(screen.getByText("Nincs kiválasztott fájl")).toBeTruthy();
  });

  it("a tiltott mezőn a gomb is tiltott, és az accept átjut", () => {
    render(<PilotFileInput aria-label="Kép" disabled accept="image/png" />);
    expect(
      (
        screen.getByRole("button", {
          name: "Kép: fájl kiválasztása",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect((screen.getByLabelText("Kép") as HTMLInputElement).accept).toBe(
      "image/png",
    );
  });
});
