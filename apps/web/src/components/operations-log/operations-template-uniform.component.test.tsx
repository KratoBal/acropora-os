import { fireEvent, render, screen } from "@testing-library/react";
import type { OperationsTaskTemplateDto } from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import {
  UNIFORM_RECORDING_HELP,
  UniformRecordingSwitch,
  draftOf,
  inputOf,
} from "./operations-template-editor-page";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "font-pilot" }),
}));

/*
  AZ EGYSÉGES RÖGZÍTÉS KAPCSOLÓJA A SABLON SZERKESZTŐJÉN (card d2222173, task t-20261118-egyseges-rogzites). WHAT TURNS IT RED: the switch missing, not
  showing the saved state, or editable on a retired template; a click that does not report the new value; the help sentence missing (the
  editor must say what the switch does and what stays per device); a loaded template that does not set the draft; a save payload that does not
  carry the switch (an edit that drops it would turn it off silently).
*/
const template = (uniformRecording: boolean): OperationsTaskTemplateDto => ({
  id: "t1",
  name: "Homokszűrő visszamosás",
  description: null,
  frequency: "WEEKLY",
  uniformRecording,
  target: {
    kind: "ASSETS",
    assets: [{ assetId: "a1", assetNumber: "E-1", name: "Szűrő" }],
  },
  isActive: true,
  fields: [],
  retiredFields: [],
  updatedAt: "2026-11-18T08:00:00.000Z",
});

describe("UniformRecordingSwitch", () => {
  it("shows the saved state, the label and the help sentence", () => {
    const { rerender } = render(
      <UniformRecordingSwitch
        checked={false}
        readOnly={false}
        onChange={() => undefined}
      />,
    );
    const box = screen.getByRole("checkbox", {
      name: "Egységes rögzítés",
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(UNIFORM_RECORDING_HELP)).toBeTruthy();
    rerender(
      <UniformRecordingSwitch
        checked
        readOnly={false}
        onChange={() => undefined}
      />,
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Egységes rögzítés",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("reports the new value on a click, and is not editable on a retired template", () => {
    const change = vi.fn();
    const { rerender } = render(
      <UniformRecordingSwitch
        checked={false}
        readOnly={false}
        onChange={change}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Egységes rögzítés" }),
    );
    expect(change).toHaveBeenCalledWith(true);
    rerender(<UniformRecordingSwitch checked readOnly onChange={change} />);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Egységes rögzítés",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it("the help sentence says what is shared and what stays per device", () => {
    expect(UNIFORM_RECORDING_HELP).toContain("egyszer");
    expect(UNIFORM_RECORDING_HELP).toContain("fénykép");
    expect(UNIFORM_RECORDING_HELP).toContain("rendellenesség");
  });
});

describe("the draft and the save payload carry the switch", () => {
  it("a loaded template sets the draft, both ways", () => {
    expect(draftOf(template(true)).uniformRecording).toBe(true);
    expect(draftOf(template(false)).uniformRecording).toBe(false);
  });

  it("the payload always sends the switch as a boolean, so an edit cannot drop it", () => {
    expect(inputOf(draftOf(template(true))).uniformRecording).toBe(true);
    expect(inputOf(draftOf(template(false))).uniformRecording).toBe(false);
  });
});
