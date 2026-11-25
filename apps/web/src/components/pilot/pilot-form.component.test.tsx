import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  PilotField,
  PilotFieldPair,
  PilotFormActions,
  PilotFormCard,
  PilotFormLayout,
  PilotMissingSummary,
  PILOT_FIELD_HINT_CLASS,
} from "@acropora/ui";
import { describe, expect, it, vi } from "vitest";

/**
 * AZ ŰRLAP-VÁZ (picasso leltár 3.7 terve, acrobot 2026-11-25): egy kötelező-jelölés, egy összesítő-alak, egy gombsor, egy elrendezés. MI PIROSÍT:
 * ha a kötelező mező csillag nélkül marad, vagy a nem kötelező a "(nem kötelező)" nélkül (a két jel egy szabály); ha a csillag a felolvasónak is
 * "*"-ot mond ("kötelező" helyett); ha az összesítő más alakban ír, vagy üresen is megjelenik; ha a halvány mentés gomb nem kattintható (a hívó
 * ilyenkor mutatja a hibákat), vagy foglalt állapotban mégis küld; ha az oldalkártya 1100 px alatt is látszik, vagy a szöveg alatta eltűnik.
 */
describe("PilotField: a kötelező és a nem kötelező jelölés", () => {
  it("a kötelező mező címkéje csillagot kap, a felolvasónak 'kötelező', a csillag maga rejtett", () => {
    render(
      <PilotField label="Partner" requirement="required" htmlFor="p">
        <input id="p" />
      </PilotField>,
    );
    const label = screen.getByText("Partner").closest("label")!;
    expect(label.textContent).toContain("*");
    expect(label.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
    expect(
      screen.getByRole("textbox", { name: "Partner (kötelező)" }),
    ).toBeTruthy();
    expect(screen.queryByText("(nem kötelező)")).toBeNull();
  });

  it("a nem kötelező mező címkéje után szürkén '(nem kötelező)' áll, csillag nélkül", () => {
    render(
      <PilotField label="Eszköz" requirement="optional" htmlFor="e">
        <input id="e" />
      </PilotField>,
    );
    expect(screen.getByText("(nem kötelező)")).toBeTruthy();
    expect(
      screen.getByText("Eszköz").closest("label")!.textContent,
    ).not.toContain("*");
  });

  it("a hiba a mezőnél áll egy mondattal, és a doboz jelzi (piros keret a gyerek mezőkön)", () => {
    const { container } = render(
      <PilotField
        label="Alegység"
        requirement="required"
        htmlFor="a"
        error="Válassz alegységet."
      >
        <select id="a" />
      </PilotField>,
    );
    expect(screen.getByRole("alert").textContent).toBe("Válassz alegységet.");
    expect(container.querySelector('[data-invalid="true"]')).not.toBeNull();
    expect(container.firstElementChild!.className).toContain(
      "[&_select]:ring-pilot-red-700",
    );
  });

  it("hiba nélkül nincs riasztás és nincs jelzés", () => {
    const { container } = render(
      <PilotField label="Tárgy" requirement="required" htmlFor="t">
        <input id="t" />
      </PilotField>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("[data-invalid]")).toBeNull();
  });
});

describe("PilotMissingSummary", () => {
  it("egy alakban ír: 'Hiányzik: A, B'", () => {
    render(<PilotMissingSummary missing={["Alegység", "Tárgy"]} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Hiányzik: Alegység, Tárgy",
    );
  });

  it("nincs hiányzó mező: semmi nem jelenik meg", () => {
    const { container } = render(<PilotMissingSummary missing={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("PilotFormActions", () => {
  const props = {
    submitLabel: "Mentés",
    busyLabel: "Mentés…",
    onCancel: () => {},
  };

  it("hiányzó mezőnél halvány (aria-disabled), de kattintható: a hívó dönt", () => {
    const onSubmit = vi.fn();
    render(
      <PilotFormActions
        {...props}
        missing={["Partner"]}
        busy={false}
        onSubmit={onSubmit}
      />,
    );
    const save = screen.getByRole("button", { name: "Mentés" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // the summary is on the left, in the same row
    expect(screen.getByRole("status").textContent).toBe("Hiányzik: Partner");
  });

  it("teljes űrlapnál nem halvány; foglalt állapotban a felirat változik és nem küld", () => {
    const onSubmit = vi.fn();
    const view = render(
      <PilotFormActions
        {...props}
        missing={[]}
        busy={false}
        onSubmit={onSubmit}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Mentés" })
        .getAttribute("aria-disabled"),
    ).toBe("false");
    view.rerender(
      <PilotFormActions {...props} missing={[]} busy onSubmit={onSubmit} />,
    );
    const busy = screen.getByRole("button", { name: "Mentés…" });
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(busy);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a Mégse a megadott műveletet hívja", () => {
    const onCancel = vi.fn();
    render(
      <PilotFormActions
        {...props}
        onCancel={onCancel}
        missing={[]}
        busy={false}
        onSubmit={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mégse" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("PilotFormLayout és a kártya", () => {
  it("a főoszlop legfeljebb 760 px, az oldalkártya csak 1100 px fölött áll mellette, alatta ugyanaz a szöveg sima mondat", () => {
    const { container } = render(
      <PilotFormLayout
        afterText="Mentés után megnyílik a lap."
        actions={<div data-testid="actions" />}
      >
        <PilotFormCard title="Kinek és hol?">
          <PilotFieldPair>
            <span>bal</span>
            <span>jobb</span>
          </PilotFieldPair>
        </PilotFormCard>
      </PilotFormLayout>,
    );
    expect(container.querySelector('[class*="max-w-[760px]"]')).not.toBeNull();
    const aside = screen.getByLabelText("Mi történik ezután");
    expect(aside.className).toContain("hidden");
    expect(aside.className).toContain("min-[1100px]:block");
    expect(aside.className).toContain("w-[300px]");
    const inline = screen.getByTestId("form-after-inline");
    expect(inline.className).toContain("min-[1100px]:hidden");
    expect(inline.textContent).toBe("Mentés után megnyílik a lap.");
    expect(
      within(aside).getByText("Mentés után megnyílik a lap."),
    ).toBeTruthy();
    // the button row comes after the inline sentence
    expect(
      inline.compareDocumentPosition(screen.getByTestId("actions")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // the card's title is the question
    expect(screen.getByRole("heading", { name: "Kinek és hol?" })).toBeTruthy();
  });
});

describe("a súgó stílusa és a gombsor szélessége (a stage-képről, acrobot 2026-11-25)", () => {
  it("the field help and the dependent-field sentence share one small grey class", () => {
    expect(PILOT_FIELD_HINT_CLASS).toBe("text-xs text-pilot-grey-400");
    render(
      <PilotField
        label="Partner"
        requirement="optional"
        htmlFor="p"
        help="Segítő szöveg."
      >
        <input id="p" />
      </PilotField>,
    );
    expect(screen.getByText("Segítő szöveg.").className).toBe(
      PILOT_FIELD_HINT_CLASS,
    );
  });

  it("Mégse keeps its own width and the save button takes the rest, so a long label stays on one line on a phone", () => {
    render(
      <PilotFormActions
        missing={[]}
        busy={false}
        submitLabel="Karbantartási lap megnyitása"
        busyLabel="Mentés…"
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const cancel = screen.getByRole("button", { name: "Mégse" });
    const save = screen.getByRole("button", {
      name: "Karbantartási lap megnyitása",
    });
    expect(cancel.className).toContain("flex-none");
    expect(cancel.className).not.toContain("flex-1");
    expect(save.className).toContain("flex-1");
  });
});
