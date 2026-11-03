import { fireEvent, screen } from "@testing-library/react";
import { expect } from "vitest";

/**
 * A MAGYAR HÓNAPVÁLASZTÓ A TESZTEKBEN (`PilotMonthField`): két választó, `<címke>, év` és
 * `<címke>, hónap`. A natív `type="month"` mezőre írt `fireEvent.change(.., "2026-08")` helyett.
 */
export function pickMonth(label: string, value: string) {
  const [year, month] = value.split("-");
  fireEvent.change(screen.getByLabelText(`${label}, év`), {
    target: { value: year },
  });
  fireEvent.change(screen.getByLabelText(`${label}, hónap`), {
    target: { value: month },
  });
}

export function expectMonth(label: string, value: string) {
  const [year, month] = value.split("-");
  expect(screen.getByLabelText(`${label}, év`)).toHaveValue(year);
  expect(screen.getByLabelText(`${label}, hónap`)).toHaveValue(month);
}
