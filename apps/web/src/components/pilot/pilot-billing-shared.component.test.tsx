import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  PilotDrawer,
  PilotRadioGroup,
  PilotTotals,
  PilotVariableChips,
} from "@acropora/ui";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

/*
  A SZÁMLÁZÁS DOMAINTÓL FÜGGETLEN KÖZÖS ELEMEI (Balázs Számlázás-briefje,
  2026-09-30, 4., 5., 16. és 17. pont). MI PIROSÍT: ha a rádiócsoport nem
  valódi csoport a nevével, ha a letiltott opció választható, ha a chip nem
  a változót adja vissza, ha a fiók nem párbeszédablak a nevével, nem zár
  Escape-re, vagy zártan is elérhető.
*/
describe("PilotRadioGroup", () => {
  function Harness({ onChange }: { onChange?: (value: string) => void }) {
    const [value, setValue] = useState<"INVOICE" | "PROFORMA" | "DELIVERY">(
      "INVOICE",
    );
    return (
      <PilotRadioGroup
        name="doc"
        label="Dokumentum"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        options={[
          { value: "INVOICE", label: "Számla" },
          { value: "PROFORMA", label: "Díjbekérő" },
          { value: "DELIVERY", label: "Szállítólevél", disabled: true },
        ]}
      />
    );
  }

  it("is a named group of real radios, one checked, and a click moves the choice", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Dokumentum:" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => (radio as HTMLInputElement).checked)).toEqual([
      true,
      false,
      false,
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "Díjbekérő" }));
    expect(onChange).toHaveBeenCalledWith("PROFORMA");
    expect(screen.getByRole("radio", { name: "Díjbekérő" })).toBeChecked();
  });

  it("a disabled option cannot be chosen", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const delivery = screen.getByRole("radio", { name: "Szállítólevél" });
    expect(delivery).toBeDisabled();
    fireEvent.click(delivery);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the whole group can be disabled, with a reason", () => {
    render(
      <PilotRadioGroup
        name="format"
        label="Formátum"
        value={null}
        onChange={() => undefined}
        disabled
        hint="Szállítólevélnél nem értelmezett."
        options={[
          { value: "PAPER", label: "Papír alapú" },
          { value: "ELECTRONIC", label: "E-számla" },
        ]}
      />,
    );
    for (const radio of screen.getAllByRole("radio"))
      expect(radio).toBeDisabled();
    expect(
      screen.getByText("Szállítólevélnél nem értelmezett."),
    ).toBeInTheDocument();
  });
});

describe("PilotVariableChips and PilotTotals", () => {
  it("a chip hands back its variable", () => {
    const onInsert = vi.fn();
    render(
      <PilotVariableChips
        variables={["{customer_name}", "{document_number}"]}
        onInsert={onInsert}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "{document_number} beszúrása" }),
    );
    expect(onInsert).toHaveBeenCalledWith("{document_number}");
  });

  it("the totals pair each label with its value", () => {
    render(
      <PilotTotals
        rows={[
          { label: "Nettó", value: "382 000 Ft" },
          { label: "Bruttó", value: "485 140 Ft", emphasis: true },
        ]}
      />,
    );
    expect(screen.getByText("Bruttó").nextElementSibling?.textContent).toBe(
      "485 140 Ft",
    );
  });
});

describe("PilotDrawer", () => {
  it("open: a dialog named by its title, closed by Escape and by 'Bezárás'", () => {
    const onClose = vi.fn();
    render(
      <PilotDrawer
        open
        onClose={onClose}
        title="E-számla kiküldése"
        subtitle="A levél a kiállítás előtt szerkeszthető."
        footer={<button type="button">Mégse</button>}
      >
        <p>Tartalom</p>
      </PilotDrawer>,
    );
    expect(
      screen.getByRole("dialog", { name: "E-számla kiküldése" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A levél a kiállítás előtt szerkeszthető."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mégse" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Bezárás" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closed: out of reach, and Escape does nothing", () => {
    const onClose = vi.fn();
    render(
      <PilotDrawer open={false} onClose={onClose} title="E-számla kiküldése">
        <button type="button">Belső gomb</button>
      </PilotDrawer>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Belső gomb" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  // A SZÉLESSÉG PARAMÉTER, NEM ÚJ ALAPÉRTELMEZÉS (acrobot 25226): a számlázás
  // szélesebb panelt kér, a partner-portál vízértékei a régi 448 pixelen
  // maradnak. MI PIROSÍT: ha az alapértelmezés elmozdul, vagy az új szélesség
  // nem a kért osztályt adja.
  it("width: md stays the default, lg and xl are opt-in", () => {
    const widthOf = (width?: "md" | "lg" | "xl") => {
      const { unmount } = render(
        <PilotDrawer open onClose={() => {}} title="Panel" width={width}>
          <p>Tartalom</p>
        </PilotDrawer>,
      );
      const className = screen.getByRole("dialog").className;
      unmount();
      return className.match(/max-w-\S+/)?.[0];
    };
    expect(widthOf()).toBe("max-w-md");
    expect(widthOf("md")).toBe("max-w-md");
    expect(widthOf("lg")).toBe("max-w-[520px]");
    expect(widthOf("xl")).toBe("max-w-[640px]");
  });
});
